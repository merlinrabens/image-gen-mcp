import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { BFLGenerateResponse } from '../types/api-responses.js';
import { logger } from '../util/logger.js';

/**
 * Black Forest Labs (Flux) provider for high-quality image generation
 * Documentation: https://docs.bfl.ai/
 */
export class BFLProvider extends ImageProvider {
  readonly name = 'BFL';
  private apiKey: string | undefined;

  constructor() {
    super();
    this.apiKey = process.env.BFL_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequiredEnvVars(): string[] {
    return ['BFL_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true, // Via Flux Fill
      maxWidth: 2048,
      maxHeight: 2048,
      supportedModels: [
        'flux1.1-pro', // Standard pro model - $0.04
        'flux1.1-pro-ultra', // Ultra high-res (4MP) - $0.06
        'flux-kontext-pro', // Create and edit with text+images - $0.04
        'flux-fill-pro' // Inpainting model - $0.05
      ],
      specialFeatures: [
        'photorealistic',
        'ultra_high_resolution',
        'raw_photography',
        'inpainting',
        'aspect_ratio_control'
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // Validate API key
    if (!this.validateApiKey(this.apiKey)) {
      throw new ProviderError('BFL API key not configured or invalid', this.name, false);
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    // Check cache
    const cacheKey = this.generateCacheKey(input);
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    // Select appropriate model based on request
    const model = input.model || this.selectBestModel(input.prompt, input.width, input.height);

    logger.info(`BFL generating image`, { model, prompt: input.prompt.slice(0, 50) });

    // Execute with retry logic
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(90000); // BFL can take longer for ultra models

      try {

      // Build request body
      const requestBody: Record<string, any> = {
        prompt: input.prompt,
        width: input.width || 1024,
        height: input.height || 1024,
        // BFL uses steps for quality control
        steps: model.includes('ultra') ? 50 : 28,
        // Guidance scale for prompt adherence
        guidance: 3.5,
        // Safety tolerance
        safety_tolerance: 2,
        // Output format
        output_format: 'png'
      };

      // Add seed if specified
      if (input.seed) {
        requestBody.seed = input.seed;
      }

      // Determine endpoint based on model
      const endpoint = this.getEndpointForModel(model);

      const { statusCode, body } = await request(
        `https://api.bfl.ml/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'X-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as BFLGenerateResponse;

      if (statusCode !== 200) {
        const message = response.error?.message || `BFL API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Handle async generation (BFL returns a task ID for polling)
      if (response.id && !response.sample) {
        // Poll for result
        const polledResponse = await this.pollForResult(response.id, controller);
        const result = await this.processResult(polledResponse, model);
        this.cacheResult(cacheKey, result);
        return result;
      }

        // Direct result
        const result = await this.processResult(response, model);

        // Cache successful result
        this.cacheResult(cacheKey, result);

        return result;
      } catch (error) {
        if (error instanceof ProviderError) throw error;

        const message = error instanceof Error ? error.message : 'Unknown error';
        const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
        throw new ProviderError(`BFL request failed: ${message}`, this.name, isRetryable, error);
      } finally {
        // Cleanup controller
        this.cleanupController(controller);
      }
    });
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    // Validate API key
    if (!this.validateApiKey(this.apiKey)) {
      throw new ProviderError('BFL API key not configured or invalid', this.name, false);
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    // Choose model based on whether we have a mask
    // Flux Kontext: General editing without mask
    // Flux Fill: Inpainting with mask
    const model = input.maskImage ? 'flux-fill-pro' : 'flux-kontext-pro';
    const isKontext = !input.maskImage;

    logger.info(`BFL editing image with ${isKontext ? 'Flux Kontext' : 'Flux Fill'}`, { prompt: input.prompt.slice(0, 50) });

    // Execute with retry logic
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(60000);

      try {
        // Extract base image data with size validation
        const baseImageData = this.dataUrlToBuffer(input.baseImage);

        let endpoint: string;
        let requestBody: Record<string, any>;

        if (isKontext) {
          // Flux Kontext: General image editing without mask
          endpoint = 'https://api.bfl.ml/v1/flux-kontext-pro';
          requestBody = {
            prompt: input.prompt,
            image: baseImageData.buffer.toString('base64'),
            steps: 28,
            guidance: 3.5, // Kontext uses lower guidance
            safety_tolerance: 2,
            output_format: 'png'
          };
        } else {
          // Flux Fill: Inpainting with mask
          endpoint = 'https://api.bfl.ml/v1/flux-pro-1.0-fill';
          requestBody = {
            prompt: input.prompt,
            image: baseImageData.buffer.toString('base64'),
            steps: 28,
            guidance: 30, // Higher guidance for inpainting
            output_format: 'png'
          };

          // Add mask for Fill
          const maskData = this.dataUrlToBuffer(input.maskImage!);
          requestBody.mask = maskData.buffer.toString('base64');
        }

      const { statusCode, body } = await request(
        endpoint,
        {
          method: 'POST',
          headers: {
            'X-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as BFLGenerateResponse;

      if (statusCode !== 200) {
        const message = response.error?.message || `BFL API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Handle async result
      if (response.id && !response.sample) {
        const polledResponse = await this.pollForResult(response.id, controller);
        return await this.processResult(polledResponse, model);
      }

        return await this.processResult(response, model);
      } catch (error) {
        if (error instanceof ProviderError) throw error;

        const message = error instanceof Error ? error.message : 'Unknown error';
        const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
        throw new ProviderError(`BFL edit request failed: ${message}`, this.name, isRetryable, error);
      } finally {
        // Cleanup controller
        this.cleanupController(controller);
      }
    });
  }

  /**
   * Select the best model based on the request
   */
  private selectBestModel(prompt: string, width?: number, height?: number): string {
    const requestedSize = (width || 1024) * (height || 1024);
    const lowerPrompt = prompt.toLowerCase();

    // Use ultra for high-resolution requests (>1MP)
    if (requestedSize > 1024 * 1024) {
      return 'flux1.1-pro-ultra';
    }

    // Use kontext for character consistency or multi-image scenarios
    if (lowerPrompt.includes('character') || lowerPrompt.includes('consistent') ||
        lowerPrompt.includes('same person') || lowerPrompt.includes('series')) {
      return 'flux-kontext-pro';
    }

    // Default to standard pro model - fast and reliable
    return 'flux1.1-pro';
  }

  /**
   * Get API endpoint for model
   */
  private getEndpointForModel(model: string): string {
    const endpoints: Record<string, string> = {
      'flux1.1-pro': 'v1/flux-pro-1.1',
      'flux1.1-pro-ultra': 'v1/flux-pro-1.1-ultra',
      'flux-kontext-pro': 'v1/flux-kontext-pro',
      'flux-fill-pro': 'v1/flux-fill'
    };

    return endpoints[model] || 'v1/flux-pro-1.1';
  }

  /**
   * Poll for async result with exponential backoff
   */
  private async pollForResult(taskId: string, controller: AbortController): Promise<BFLGenerateResponse> {
    const maxAttempts = 30;
    const initialDelay = 1000; // 1 second
    const maxDelay = 10000; // 10 seconds

    for (let i = 0; i < maxAttempts; i++) {
      // Exponential backoff with jitter
      const delay = Math.min(initialDelay * Math.pow(1.5, i), maxDelay) + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, delay));

      // Use the correct API domain (.ml not .ai)
      const { statusCode, body } = await request(
        `https://api.bfl.ml/v1/get_result?id=${taskId}`,
        {
          method: 'GET',
          headers: {
            'X-Key': this.apiKey!
          },
          signal: controller.signal
        }
      );

      const result = await body.json() as BFLGenerateResponse;

      if (statusCode === 200 && result.status === 'Ready') {
        return result;
      }

      if (result.status === 'Failed') {
        throw new ProviderError('BFL generation failed', this.name, false, result);
      }

      logger.debug(`BFL polling attempt ${i + 1}/${maxAttempts}, status: ${result.status}`);
    }

    throw new ProviderError('BFL generation timeout - exceeded max polling attempts', this.name, true);
  }

  /**
   * Process result into standard format
   */
  private async processResult(response: BFLGenerateResponse, model: string): Promise<ProviderResult> {
    const images = [];

    // Get sample data - either from result.sample or direct sample
    const sampleData = response.result?.sample || response.sample;

    if (sampleData) {
      // Check if it's a URL or base64 data
      if (sampleData.startsWith('http://') || sampleData.startsWith('https://')) {
        // It's a URL - fetch the image
        const imageResponse = await fetch(sampleData);
        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        images.push({
          dataUrl: this.bufferToDataUrl(buffer, 'image/png'),
          format: 'png' as const
        });
      } else {
        // It's base64 data
        images.push({
          dataUrl: `data:image/png;base64,${sampleData}`,
          format: 'png' as const
        });
      }
    }

    if (images.length === 0) {
      throw new ProviderError('No image in BFL response', this.name, false);
    }

    return {
      images,
      provider: this.name,
      model,
      warnings: model.includes('ultra') ? ['Ultra-high resolution image generated'] : undefined
    };
  }
}