import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
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
        'flux1.1-pro-ultra', // Ultra high-res - $0.06
        'flux1.1-pro-raw', // Candid photography feel - $0.06
        'flux-kontext-pro', // Create and edit with text+images - $0.04
        'flux-kontext-max', // Maximum quality - $0.08
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
    if (!this.apiKey) {
      throw new ProviderError('BFL API key not configured', this.name);
    }

    // Select appropriate model based on request
    const model = input.model || this.selectBestModel(input.prompt, input.width, input.height);

    logger.info(`BFL generating image`, { model, prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout(90000); // BFL can take longer for ultra models

      // Build request body
      const requestBody: any = {
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
        `https://api.bfl.ai/${endpoint}`,
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

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `BFL API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Handle async generation (BFL returns a task ID for polling)
      if (response.id && !response.sample) {
        // Poll for result
        const result = await this.pollForResult(response.id, controller);
        return this.processResult(result, model);
      }

      // Direct result
      return this.processResult(response, model);
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`BFL request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError('BFL API key not configured', this.name);
    }

    // Use Flux Fill for editing/inpainting
    const model = 'flux-fill-pro';

    logger.info(`BFL editing image with Flux Fill`, { prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout(60000);

      // Extract base image data
      const baseImageData = this.dataUrlToBuffer(input.baseImage);

      const requestBody: any = {
        prompt: input.prompt,
        image: baseImageData.buffer.toString('base64'),
        steps: 28,
        guidance: 30, // Higher guidance for inpainting
        output_format: 'png'
      };

      // Add mask if provided
      if (input.maskImage) {
        const maskData = this.dataUrlToBuffer(input.maskImage);
        requestBody.mask = maskData.buffer.toString('base64');
      }

      const { statusCode, body } = await request(
        'https://api.bfl.ai/v1/flux-fill',
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

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `BFL API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Handle async result
      if (response.id && !response.sample) {
        const result = await this.pollForResult(response.id, controller);
        return this.processResult(result, model);
      }

      return this.processResult(response, model);
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`BFL edit request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  /**
   * Select the best model based on the request
   */
  private selectBestModel(prompt: string, width?: number, height?: number): string {
    const lower = prompt.toLowerCase();

    // Check for ultra high resolution needs
    if (width && height && (width > 1536 || height > 1536)) {
      return 'flux1.1-pro-ultra';
    }

    // Check for photorealistic/raw photography keywords
    if (lower.includes('photo') || lower.includes('realistic') || lower.includes('candid')) {
      return 'flux1.1-pro-raw';
    }

    // Check for editing/composition keywords
    if (lower.includes('edit') || lower.includes('compose') || lower.includes('combine')) {
      return 'flux-kontext-pro';
    }

    // Default to standard pro
    return 'flux1.1-pro';
  }

  /**
   * Get API endpoint for model
   */
  private getEndpointForModel(model: string): string {
    const endpoints: Record<string, string> = {
      'flux1.1-pro': 'v1/flux-pro-1.1',
      'flux1.1-pro-ultra': 'v1/flux-pro-1.1-ultra',
      'flux1.1-pro-raw': 'v1/flux-pro-1.1-raw',
      'flux-kontext-pro': 'v1/flux-kontext',
      'flux-kontext-max': 'v1/flux-kontext-max',
      'flux-fill-pro': 'v1/flux-fill'
    };

    return endpoints[model] || 'v1/flux-pro-1.1';
  }

  /**
   * Poll for async result
   */
  private async pollForResult(taskId: string, controller: AbortController): Promise<any> {
    const maxAttempts = 30;
    const pollInterval = 2000; // 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const { statusCode, body } = await request(
        `https://api.bfl.ai/v1/get_result?id=${taskId}`,
        {
          method: 'GET',
          headers: {
            'X-Key': this.apiKey!
          },
          signal: controller.signal
        }
      );

      const result = await body.json() as any;

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
  private processResult(response: any, model: string): ProviderResult {
    const images = [];

    if (response.sample) {
      images.push({
        dataUrl: `data:image/png;base64,${response.sample}`,
        format: 'png' as const
      });
    } else if (response.result && response.result.sample) {
      images.push({
        dataUrl: `data:image/png;base64,${response.result.sample}`,
        format: 'png' as const
      });
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