import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Fal.ai Provider
 *
 * Key features:
 * - Ultra-fast generation (50-300ms) - fastest in the industry
 * - Serverless architecture with automatic scaling
 * - Wide variety of open-source models
 * - Real-time generation capabilities
 * - Extremely cost-effective
 *
 * Excellent for:
 * - Rapid prototyping and iteration
 * - Real-time applications
 * - High-volume generation needs
 * - Cost-sensitive projects
 */
export class FalProvider extends ImageProvider {
  readonly name = 'FAL';

  private apiKey?: string;
  private baseUrl = 'https://fal.run';

  constructor() {
    super();
    this.apiKey = process.env.FAL_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequiredEnvVars(): string[] {
    return ['FAL_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: false,
      supportsVariations: true,
      supportsUpscale: true,
      supportsControlNet: true,
      supportsCharacterConsistency: false,
      supportsCustomModels: false,
      maxWidth: 1536,
      maxHeight: 1536,
      defaultModel: 'fast-sdxl',
      availableModels: [
        'fast-sdxl', // 50-100ms generation!
        'fast-lightning-sdxl', // Even faster!
        'flux-pro', // High quality
        'flux-realism', // Photorealistic
        'stable-diffusion-v3', // Latest SD
        'animagine-xl', // Anime style
        'playground-v2', // Creative
        'realvisxl-v4' // Ultra-realistic
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        'FAL_API_KEY environment variable is not set',
        this.name,
        false
      );
    }

    try {
      const model = this.getModelEndpoint(input.model);
      const requestBody = this.buildRequestBody(input, model);

      // Fal.ai uses a queue system for async generation
      const queueResponse = await fetch(`${this.baseUrl}/${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!queueResponse.ok) {
        const error = await queueResponse.text();
        throw new ProviderError(
          `Fal.ai API error: ${error}`,
          this.name,
          queueResponse.status >= 500
        );
      }

      const result: any = await queueResponse.json();

      // Fal.ai can return results immediately for fast models
      if (result.images) {
        return this.processResult(result, input);
      }

      // For slower models, poll the request ID
      if (result.request_id) {
        return await this.pollForResult(result.request_id, model, input);
      }

      throw new ProviderError(
        'Unexpected response format from Fal.ai',
        this.name,
        false
      );

    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Fal.ai generation failed: ${message}`);
      throw new ProviderError(
        `Fal.ai generation failed: ${message}`,
        this.name,
        true,
        error
      );
    }
  }

  async edit(_input: EditInput): Promise<ProviderResult> {
    throw new ProviderError(
      'Fal.ai does not currently support image editing',
      this.name,
      false
    );
  }

  private getModelEndpoint(modelName?: string): string {
    // Map to Fal.ai model endpoints
    const modelMap: Record<string, string> = {
      'fast-sdxl': 'fal-ai/fast-sdxl',
      'fast-lightning-sdxl': 'fal-ai/fast-lightning-sdxl',
      'flux-pro': 'fal-ai/flux-pro',
      'flux-realism': 'fal-ai/flux-realism',
      'stable-diffusion-v3': 'fal-ai/stable-diffusion-v3-medium',
      'animagine-xl': 'fal-ai/animagine-xl-v31',
      'playground-v2': 'fal-ai/playground-v25',
      'realvisxl-v4': 'fal-ai/realvisxl-v4'
    };

    if (modelName && modelMap[modelName]) {
      return modelMap[modelName];
    }

    // Default to fast-sdxl for speed
    return modelMap['fast-sdxl'];
  }

  private buildRequestBody(input: GenerateInput, model: string): any {
    const body: any = {
      prompt: input.prompt,
      num_inference_steps: input.steps || (model.includes('fast') ? 4 : 25),
      guidance_scale: input.guidance || 3.5,
      num_images: 1,
      enable_safety_checker: true,
      expand_prompt: true, // Use Fal's prompt enhancement
      format: 'png'
    };

    // Handle dimensions based on model
    if (model.includes('flux')) {
      // Flux models support flexible dimensions
      body.image_size = {
        width: input.width || 1024,
        height: input.height || 1024
      };
    } else {
      // SDXL models use preset sizes
      body.image_size = this.mapToPresetSize(input.width, input.height);
    }

    if (input.seed !== undefined) {
      body.seed = input.seed;
    }

    // Model-specific parameters
    if (model.includes('fast')) {
      body.enable_lcm = true; // Enable LCM for even faster generation
      body.num_inference_steps = Math.min(input.steps || 4, 8); // Max 8 for fast models
    }

    return body;
  }

  private mapToPresetSize(width?: number, height?: number): string {
    // Map to closest SDXL preset size
    const targetWidth = width || 1024;
    const targetHeight = height || 1024;
    const aspectRatio = targetWidth / targetHeight;

    if (aspectRatio > 1.7) {
      return 'landscape_16_9';
    } else if (aspectRatio > 1.3) {
      return 'landscape_4_3';
    } else if (aspectRatio < 0.6) {
      return 'portrait_9_16';
    } else if (aspectRatio < 0.8) {
      return 'portrait_3_4';
    } else {
      return 'square';
    }
  }

  private async pollForResult(
    requestId: string,
    model: string,
    input: GenerateInput
  ): Promise<ProviderResult> {
    const maxAttempts = 30; // 30 seconds max
    let attempts = 0;

    while (attempts < maxAttempts) {
      const statusResponse = await fetch(
        `${this.baseUrl}/${model}/requests/${requestId}`,
        {
          headers: {
            'Authorization': `Key ${this.apiKey}`
          }
        }
      );

      if (!statusResponse.ok) {
        throw new ProviderError(
          'Failed to check generation status',
          this.name,
          true
        );
      }

      const status: any = await statusResponse.json();

      if (status.status === 'COMPLETED' && status.images) {
        return this.processResult(status, input);
      } else if (status.status === 'FAILED') {
        throw new ProviderError(
          status.error || 'Generation failed',
          this.name,
          true
        );
      }

      // Wait before next poll (shorter for fast models)
      const delay = model.includes('fast') ? 100 : 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempts++;
    }

    throw new ProviderError(
      'Generation timed out',
      this.name,
      true
    );
  }

  private async processResult(
    result: any,
    input: GenerateInput
  ): Promise<ProviderResult> {
    const images = result.images || [];

    if (images.length === 0) {
      throw new ProviderError(
        'No images returned',
        this.name,
        false
      );
    }

    // Download and convert images
    const imagePromises = images.map(async (img: any) => {
      const url = img.url || img;
      const response = await fetch(url);

      if (!response.ok) {
        throw new ProviderError(
          'Failed to download generated image',
          this.name,
          true
        );
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const format = url.includes('.webp') ? 'webp' : 'png';

      return {
        dataUrl: `data:image/${format};base64,${base64}`,
        format: format as 'png' | 'webp'
      };
    });

    const downloadedImages = await Promise.all(imagePromises);

    const warnings = [];
    if (result.has_nsfw_concepts?.[0]) {
      warnings.push('Content may be NSFW');
    }
    if (result.timings) {
      const time = result.timings.inference || result.timings.total;
      if (time) {
        warnings.push(`Generated in ${time.toFixed(0)}ms`);
      }
    }

    return {
      provider: this.name,
      model: input.model || 'fast-sdxl',
      images: downloadedImages,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}