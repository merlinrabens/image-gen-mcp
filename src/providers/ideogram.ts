import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Ideogram provider for image generation with exceptional text rendering
 * Documentation: https://developer.ideogram.ai/
 */
export class IdeogramProvider extends ImageProvider {
  readonly name = 'IDEOGRAM';
  private apiKey: string | undefined;

  constructor() {
    super();
    this.apiKey = process.env.IDEOGRAM_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequiredEnvVars(): string[] {
    return ['IDEOGRAM_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true,
      maxWidth: 2048,
      maxHeight: 2048,
      supportedModels: [
        'V_2', // Latest version with best text rendering
        'V_2_TURBO', // Faster generation
        'V_1' // Legacy version
      ],
      specialFeatures: [
        'text_rendering', // Exceptional text clarity
        'style_presets', // Logo, poster, etc.
        'magic_prompt' // AI-enhanced prompts
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // Validate API key
    if (!this.validateApiKey(this.apiKey)) {
      throw new ProviderError('Ideogram API key not configured or invalid', this.name, false);
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    // Check cache
    const cacheKey = this.generateCacheKey(input);
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    const model = input.model || 'V_2';

    logger.info(`Ideogram generating image`, { model, prompt: input.prompt.slice(0, 50) });

    // Execute with retry logic
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(60000); // Ideogram can take longer

      try {

      // Detect if this is a text-heavy request
      const isTextHeavy = this.detectTextRequest(input.prompt);

      // Build request body
      const requestBody: any = {
        image_request: {
          prompt: input.prompt,
          model,
          aspect_ratio: this.calculateAspectRatio(input.width, input.height),
          // Magic prompt enhances the prompt automatically
          magic_prompt_option: isTextHeavy ? 'OFF' : 'AUTO'
        }
      };

      // Add style preset for logos/posters if detected
      const stylePreset = this.detectStylePreset(input.prompt);
      if (stylePreset) {
        requestBody.image_request.style_type = stylePreset;
      }

      const { statusCode, body } = await request(
        'https://api.ideogram.ai/generate',
        {
          method: 'POST',
          headers: {
            'Api-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `Ideogram API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Extract images from response
      const images = response.data.map((item: any) => ({
        dataUrl: item.url ? item.url : `data:image/png;base64,${item.base64}`,
        format: 'png' as const,
        seed: item.seed // Ideogram returns seed for reproducibility
      }));

        const result = {
          images,
          provider: this.name,
          model,
          warnings: isTextHeavy ? ['Optimized for text rendering'] : undefined
        };

        // Cache successful result
        this.cacheResult(cacheKey, result);
        return result;
      } catch (error) {
        if (error instanceof ProviderError) throw error;

        const message = error instanceof Error ? error.message : 'Unknown error';
        const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
        throw new ProviderError(`Ideogram request failed: ${message}`, this.name, isRetryable, error);
      } finally {
        // Cleanup controller
        this.cleanupController(controller);
      }
    });
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    // Validate API key
    if (!this.validateApiKey(this.apiKey)) {
      throw new ProviderError('Ideogram API key not configured or invalid', this.name, false);
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    logger.info(`Ideogram editing image`, { prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout(60000);

      // Extract base image data
      const baseImageData = this.dataUrlToBuffer(input.baseImage);

      const requestBody: any = {
        edit_request: {
          prompt: input.prompt,
          image_file: baseImageData.buffer.toString('base64'),
          model: input.model || 'V_2'
        }
      };

      // Add mask if provided
      if (input.maskImage) {
        const maskData = this.dataUrlToBuffer(input.maskImage);
        requestBody.edit_request.mask_file = maskData.buffer.toString('base64');
      }

      const { statusCode, body } = await request(
        'https://api.ideogram.ai/edit',
        {
          method: 'POST',
          headers: {
            'Api-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `Ideogram API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      const images = response.data.map((item: any) => ({
        dataUrl: item.url ? item.url : `data:image/png;base64,${item.base64}`,
        format: 'png' as const
      }));

      return {
        images,
        provider: this.name,
        model: input.model || 'V_2'
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Ideogram edit request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  /**
   * Calculate aspect ratio from dimensions
   */
  private calculateAspectRatio(width?: number, height?: number): string {
    if (!width || !height) {
      return 'ASPECT_1_1'; // Default square
    }

    const ratio = width / height;

    // Ideogram supported ratios
    const ratios = [
      { name: 'ASPECT_1_1', value: 1.0 },
      { name: 'ASPECT_16_9', value: 1.778 },
      { name: 'ASPECT_9_16', value: 0.5625 },
      { name: 'ASPECT_4_3', value: 1.333 },
      { name: 'ASPECT_3_4', value: 0.75 },
      { name: 'ASPECT_10_16', value: 0.625 },
      { name: 'ASPECT_16_10', value: 1.6 }
    ];

    // Find closest ratio
    let closest = ratios[0];
    let minDiff = Math.abs(ratio - closest.value);

    for (const r of ratios) {
      const diff = Math.abs(ratio - r.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }

    logger.debug(`Mapped ${width}x${height} to Ideogram aspect ratio ${closest.name}`);
    return closest.name;
  }

  /**
   * Detect if prompt is text-heavy (logos, posters, etc.)
   */
  private detectTextRequest(prompt: string): boolean {
    const textKeywords = [
      'text', 'logo', 'poster', 'banner', 'sign', 'quote',
      'typography', 'lettering', 'word', 'title', 'headline',
      'label', 'badge', 'sticker'
    ];

    const lower = prompt.toLowerCase();
    return textKeywords.some(keyword => lower.includes(keyword));
  }

  /**
   * Detect style preset based on prompt
   */
  private detectStylePreset(prompt: string): string | undefined {
    const lower = prompt.toLowerCase();

    if (lower.includes('logo') || lower.includes('brand')) {
      return 'DESIGN';
    }
    if (lower.includes('poster') || lower.includes('flyer')) {
      return 'DESIGN';
    }
    if (lower.includes('photo') || lower.includes('realistic')) {
      return 'REALISTIC';
    }
    if (lower.includes('anime') || lower.includes('manga')) {
      return 'ANIME';
    }
    if (lower.includes('3d') || lower.includes('render')) {
      return '3D';
    }

    return undefined;
  }
}