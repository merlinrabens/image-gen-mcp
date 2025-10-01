import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Clipdrop Provider (by Stability AI)
 *
 * Key features:
 * - Advanced image editing and post-processing
 * - Background removal and replacement
 * - Image upscaling and enhancement
 * - Object removal and cleanup
 * - Sketch to image conversion
 *
 * Excellent for:
 * - Post-processing generated images
 * - Creating product shots with transparent backgrounds
 * - Enhancing and upscaling images
 * - Quick edits and cleanup
 */
export class ClipdropProvider extends ImageProvider {
  readonly name = 'CLIPDROP';

  private baseUrl = 'https://clipdrop-api.co';

  constructor() {
    super();
  }

  private getApiKey(): string | undefined {
    return process.env.CLIPDROP_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  getRequiredEnvVars(): string[] {
    return ['CLIPDROP_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true, // Primary strength!
      supportsVariations: false,
      supportsUpscale: true,
      supportsControlNet: false,
      supportsCharacterConsistency: false,
      supportsCustomModels: false,
      supportsBackgroundRemoval: true, // Unique feature
      supportsObjectRemoval: true, // Unique feature
      supportsTextRemoval: true, // Unique feature
      supportsUncrop: true, // Unique feature
      maxWidth: 1024, // text-to-image generates 1024x1024
      maxHeight: 1024,
      defaultModel: 'stable-diffusion',
      availableModels: [
        'text-to-image'
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // Validate API key
    const apiKey = this.getApiKey();
    if (!this.validateApiKey(apiKey)) {
      throw new ProviderError(
        'CLIPDROP_API_KEY not configured or invalid',
        this.name,
        false
      );
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    // Check cache
    const cacheKey = this.generateCacheKey(input);
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    // Execute with retry logic
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(30000);

      try {
      // Determine which API to use based on the prompt
      const endpoint = this.selectEndpoint(input);

      const formData = new FormData();
      formData.append('prompt', input.prompt);

      // Note: Clipdrop API does not support width/height or aspect_ratio parameters
      // Images are generated at default resolution

      // Add other parameters
      if (input.seed !== undefined) {
        formData.append('seed', input.seed.toString());
      }
      if (input.guidance !== undefined) {
        formData.append('guidance_scale', input.guidance.toString());
      }
      if (input.steps !== undefined) {
        formData.append('num_inference_steps', input.steps.toString());
      }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey!
          },
          body: formData,
          signal: controller.signal
        });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `Clipdrop API error: ${error}`,
          this.name,
          response.status >= 500
        );
      }

      // Clipdrop returns the image directly as binary
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const contentType = response.headers.get('content-type');
      const format = contentType?.includes('webp') ? 'webp' : 'png';

        const result = {
          provider: this.name,
          model: input.model || 'stable-diffusion-xl',
          images: [{
          dataUrl: `data:${contentType || 'image/png'};base64,${base64}`,
          format: format as 'png' | 'webp'
          }]
        };

        // Cache successful result
        this.cacheResult(cacheKey, result);
        return result;

      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Clipdrop generation failed: ${message}`);
        throw new ProviderError(
          `Clipdrop generation failed: ${message}`,
          this.name,
          true,
          error
        );
      } finally {
        // Cleanup controller
        this.cleanupController(controller);
      }
    });
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    // Validate API key
    const apiKey = this.getApiKey();
    if (!this.validateApiKey(apiKey)) {
      throw new ProviderError(
        'CLIPDROP_API_KEY not configured or invalid',
        this.name,
        false
      );
    }

    // Validate prompt
    this.validatePrompt(input.prompt);

    // Check rate limit
    await this.checkRateLimit();

    // Execute with retry logic
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(30000);

      try {
      // Determine edit type from prompt
      const editType = this.determineEditType(input.prompt);
      const endpoint = this.getEditEndpoint(editType);

      const formData = new FormData();

        // Extract and validate base image (supports both data URLs and file paths)
        const imageData = await this.getImageBuffer(input.baseImage);
        const imageBuffer = imageData.buffer;
      const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('image_file', imageBlob, 'image.png');

      // Add parameters based on edit type
      switch (editType) {
        case 'remove-background':
        case 'remove-text':
          // No additional params needed - just image_file
          break;

        case 'remove-object':
          if (input.maskImage) {
            const maskData = await this.getImageBuffer(input.maskImage);
            const maskBuffer = maskData.buffer;
            const maskBlob = new Blob([maskBuffer], { type: 'image/png' });
            formData.append('mask_file', maskBlob, 'mask.png');
          }
          break;

        case 'replace-background':
          formData.append('prompt', input.prompt);
          break;

        case 'upscale':
          // ClipDrop's upscaling API has different parameters
          // target_width and target_height can be specified
          if (input.width) formData.append('target_width', input.width.toString());
          if (input.height) formData.append('target_height', input.height.toString());
          break;

        case 'uncrop':
          // Uncrop requires aspect_ratio or extend parameters
          formData.append('prompt', input.prompt);
          break;

        default:
          // Default to replace-background with prompt
          formData.append('prompt', input.prompt);
      }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey!
          },
          body: formData,
          signal: controller.signal
        });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderError(
          `Clipdrop edit error: ${error}`,
          this.name,
          response.status >= 500
        );
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const contentType = response.headers.get('content-type');
      const format = contentType?.includes('webp') ? 'webp' : 'png';

      return {
        provider: this.name,
        model: `clipdrop-${editType}`,
        images: [{
          dataUrl: `data:${contentType || 'image/png'};base64,${base64}`,
          format: format as 'png' | 'webp'
        }],
        warnings: editType === 'remove-background'
          ? ['Background removed - image has transparency']
          : undefined
        };

      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Clipdrop edit failed: ${message}`);
        throw new ProviderError(
          `Clipdrop edit failed: ${message}`,
          this.name,
          true,
          error
        );
      } finally {
        // Cleanup controller
        this.cleanupController(controller);
      }
    });
  }

  private selectEndpoint(_input: GenerateInput): string {
    // ClipDrop only supports text-to-image for generation
    // Other features like sketch-to-image and reimagine may be deprecated or unavailable
    return '/text-to-image/v1';
  }

  private determineEditType(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('remove background') ||
        lower.includes('transparent')) {
      return 'remove-background';
    }

    if (lower.includes('remove text') ||
        lower.includes('delete text')) {
      return 'remove-text';
    }

    if (lower.includes('remove object') ||
        lower.includes('erase') ||
        lower.includes('delete')) {
      return 'remove-object';
    }

    if (lower.includes('replace background') ||
        lower.includes('change background')) {
      return 'replace-background';
    }

    if (lower.includes('upscale') ||
        lower.includes('enhance') ||
        lower.includes('higher resolution')) {
      return 'upscale';
    }

    if (lower.includes('uncrop') ||
        lower.includes('expand') ||
        lower.includes('extend')) {
      return 'uncrop';
    }

    return 'replace-background';
  }

  private getEditEndpoint(editType: string): string {
    const endpoints: Record<string, string> = {
      'remove-background': '/remove-background/v1',
      'remove-object': '/cleanup/v1',
      'remove-text': '/remove-text/v1',
      'replace-background': '/replace-background/v1',
      'upscale': '/image-upscaling/v1',
      'uncrop': '/uncrop/v1'
    };

    // Default to replace-background as the most general editing operation
    return endpoints[editType] || endpoints['replace-background'];
  }

}