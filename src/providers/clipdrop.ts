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

  private apiKey?: string;
  private baseUrl = 'https://clipdrop-api.co';

  constructor() {
    super();
    this.apiKey = process.env.CLIPDROP_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
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
      supportsSketchToImage: true, // Unique feature
      maxWidth: 2048,
      maxHeight: 2048,
      defaultModel: 'stable-diffusion-xl',
      availableModels: [
        'stable-diffusion-xl',
        'sketch-to-image',
        'reimagine' // Their unique style transfer model
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        'CLIPDROP_API_KEY environment variable is not set',
        this.name,
        false
      );
    }

    try {
      // Determine which API to use based on the prompt
      const endpoint = this.selectEndpoint(input);

      const formData = new FormData();
      formData.append('prompt', input.prompt);

      // Add dimensions if specified
      if (input.width && input.height) {
        // Clipdrop uses specific aspect ratios
        const ratio = this.getAspectRatio(input.width, input.height);
        formData.append('aspect_ratio', ratio);
      }

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
          'x-api-key': this.apiKey
        },
        body: formData
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

      return {
        provider: this.name,
        model: input.model || 'stable-diffusion-xl',
        images: [{
          dataUrl: `data:${contentType || 'image/png'};base64,${base64}`,
          format: format as 'png' | 'webp'
        }]
      };

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
    }
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        'CLIPDROP_API_KEY environment variable is not set',
        this.name,
        false
      );
    }

    try {
      // Determine edit type from prompt
      const editType = this.determineEditType(input.prompt);
      const endpoint = this.getEditEndpoint(editType);

      const formData = new FormData();

      // Convert base64 to blob
      const base64Data = input.baseImage.split(',')[1];
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('image_file', imageBlob, 'image.png');

      // Add parameters based on edit type
      switch (editType) {
        case 'remove-background':
          // No additional params needed
          break;

        case 'remove-object':
          if (input.maskImage) {
            const maskData = input.maskImage.split(',')[1];
            const maskBuffer = Buffer.from(maskData, 'base64');
            const maskBlob = new Blob([maskBuffer], { type: 'image/png' });
            formData.append('mask_file', maskBlob, 'mask.png');
          }
          break;

        case 'replace-background':
          formData.append('prompt', input.prompt);
          break;

        case 'reimagine':
          // Style transfer
          formData.append('style', this.extractStyle(input.prompt));
          break;

        case 'upscale':
          formData.append('scale', '2'); // 2x upscale
          formData.append('model', 'real-esrgan'); // Best upscaling model
          break;

        default:
          // Standard image editing with prompt
          formData.append('prompt', input.prompt);
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey
        },
        body: formData
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
    }
  }

  private selectEndpoint(input: GenerateInput): string {
    const lower = input.prompt.toLowerCase();

    if (input.model === 'sketch-to-image' ||
        lower.includes('sketch') ||
        lower.includes('drawing')) {
      return '/sketch-to-image/v1/sketch-to-image';
    }

    if (input.model === 'reimagine' ||
        lower.includes('reimagine') ||
        lower.includes('style')) {
      return '/reimagine/v1/reimagine';
    }

    // Default to text-to-image
    return '/text-to-image/v1';
  }

  private determineEditType(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('remove background') ||
        lower.includes('transparent')) {
      return 'remove-background';
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

    if (lower.includes('reimagine') ||
        lower.includes('restyle') ||
        lower.includes('different style')) {
      return 'reimagine';
    }

    return 'standard';
  }

  private getEditEndpoint(editType: string): string {
    const endpoints: Record<string, string> = {
      'remove-background': '/remove-background/v1',
      'remove-object': '/cleanup/v1',
      'replace-background': '/replace-background/v1',
      'upscale': '/super-resolution/v1',
      'reimagine': '/reimagine/v1/reimagine',
      'standard': '/image-editing/v1'
    };

    return endpoints[editType] || endpoints.standard;
  }

  private getAspectRatio(width: number, height: number): string {
    const ratio = width / height;

    if (Math.abs(ratio - 1) < 0.1) return '1:1';
    if (Math.abs(ratio - 1.33) < 0.1) return '4:3';
    if (Math.abs(ratio - 0.75) < 0.1) return '3:4';
    if (Math.abs(ratio - 1.77) < 0.1) return '16:9';
    if (Math.abs(ratio - 0.56) < 0.1) return '9:16';
    if (Math.abs(ratio - 1.91) < 0.1) return '21:9';
    if (Math.abs(ratio - 0.52) < 0.1) return '9:21';

    // Default to closest standard ratio
    return '1:1';
  }

  private extractStyle(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('anime')) return 'anime';
    if (lower.includes('cartoon')) return 'cartoon';
    if (lower.includes('digital art')) return 'digital_art';
    if (lower.includes('fantasy')) return 'fantasy';
    if (lower.includes('neon')) return 'neon_punk';
    if (lower.includes('pixel')) return 'pixel_art';
    if (lower.includes('comic')) return 'comic_book';

    return 'enhance'; // Default style
  }
}