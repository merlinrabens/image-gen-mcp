import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Leonardo.AI Provider
 *
 * Key features:
 * - Character consistency across multiple images (crucial for carousels)
 * - Custom model training API
 * - Multiple fine-tuned models (DreamShaper, RPG, PhotoReal, etc.)
 * - ControlNet for precise pose control
 * - Elements system for style mixing
 *
 * Excellent for:
 * - Social media carousels with consistent characters
 * - Game assets and concept art
 * - Custom branded content with trained models
 * - Artistic illustrations with consistent style
 */
export class LeonardoProvider extends ImageProvider {
  readonly name = 'LEONARDO';

  private apiKey?: string;
  private baseUrl = 'https://cloud.leonardo.ai/api/rest/v1';

  constructor() {
    super();
    this.apiKey = process.env.LEONARDO_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequiredEnvVars(): string[] {
    return ['LEONARDO_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: false, // Coming soon in their API
      supportsVariations: true,
      supportsUpscale: true,
      supportsControlNet: true,
      supportsCharacterConsistency: true, // Key differentiator!
      supportsCustomModels: true,
      maxWidth: 1024,
      maxHeight: 1024,
      defaultModel: 'leonardo-diffusion-xl',
      availableModels: [
        'leonardo-diffusion-xl',
        'dreamshaper-v7',
        'rpg-v5',
        'photoreal-v2',
        'anime-pastel-dream',
        'leonardo-vision-xl'
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // Validate API key
    if (!this.validateApiKey(this.apiKey)) {
      throw new ProviderError(
        'LEONARDO_API_KEY not configured or invalid',
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
      const controller = this.createTimeout(60000);

      try {
        // Create generation job
        const isPhotoReal = input.prompt.toLowerCase().includes('photo') ||
                            input.prompt.toLowerCase().includes('realistic');

        const requestBody: any = {
          prompt: input.prompt,
          negative_prompt: '',
          modelId: this.getModelId(input.model),
          width: input.width || 768,
          height: input.height || 768,
          num_images: 1,
          num_inference_steps: input.steps || 30,
          guidance_scale: input.guidance || 7.0,
          seed: input.seed,
          public: false,
          tiling: false,
          scheduler: 'LEONARDO',
          presetStyle: this.mapToPresetStyle(input.prompt),
          alchemy: true, // Enable Alchemy V2 for better quality
          expandedDomain: true,
          highResolution: true
        };

        // Only add PhotoReal settings when enabled
        if (isPhotoReal) {
          requestBody.photoReal = true;
          requestBody.photoRealVersion = 'v2';
          requestBody.photoRealStrength = 0.5;
        }

        const createResponse = await fetch(`${this.baseUrl}/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new ProviderError(
          `Leonardo API error: ${error}`,
          this.name,
          createResponse.status >= 500
        );
      }

      const createData: any = await createResponse.json();
      const generationId = createData.sdGenerationJob?.generationId;

      if (!generationId) {
        throw new ProviderError(
          'Failed to start generation job',
          this.name,
          false
        );
      }

        // Poll for completion with exponential backoff
        let attempts = 0;
        const maxAttempts = 30;
        const initialDelay = 1000;
        const maxDelay = 5000;

        while (attempts < maxAttempts) {
        const statusResponse = await fetch(
          `${this.baseUrl}/generations/${generationId}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`
            }
          }
        );

        if (!statusResponse.ok) {
          throw new ProviderError(
            `Failed to check generation status`,
            this.name,
            true
          );
        }

        const statusData: any = await statusResponse.json();
        const generation = statusData.generations_by_pk;

        if (generation?.status === 'COMPLETE') {
          const images = generation.generated_images || [];

          if (images.length === 0) {
            throw new ProviderError(
              'Generation completed but no images returned',
              this.name,
              false
            );
          }

          // Download images and convert to base64
          const imagePromises = images.map(async (img: any) => {
            const response = await fetch(img.url);
            if (!response.ok) {
              throw new ProviderError(
                'Failed to download generated image',
                this.name,
                true
              );
            }

            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const format = img.url.includes('.webp') ? 'webp' : 'png';

            return {
              dataUrl: `data:image/${format};base64,${base64}`,
              format: format as 'png' | 'webp'
            };
          });

          const downloadedImages = await Promise.all(imagePromises);

          const result = {
            provider: this.name,
            model: input.model || 'leonardo-diffusion-xl',
            images: downloadedImages,
            warnings: generation.nsfw ? ['Content may be NSFW'] : undefined
          };

          // Cache successful result
          this.cacheResult(cacheKey, result);

          return result;
        } else if (generation?.status === 'FAILED') {
          throw new ProviderError(
            'Generation failed',
            this.name,
            true
          );
        }

          // Exponential backoff with jitter
          const delay = Math.min(initialDelay * Math.pow(1.5, attempts), maxDelay) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          attempts++;
      }

        throw new ProviderError(
          'Generation timed out',
          this.name,
          true
        );
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Leonardo generation failed: ${message}`);
        throw new ProviderError(
          `Leonardo generation failed: ${message}`,
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

  async edit(_input: EditInput): Promise<ProviderResult> {
    throw new ProviderError(
      'Leonardo.AI does not yet support image editing through their API',
      this.name,
      false
    );
  }

  private getModelId(modelName?: string): string | undefined {
    // Map friendly names to Leonardo model IDs
    const modelMap: Record<string, string> = {
      'leonardo-diffusion-xl': '1e60896f-3c26-4296-8ecc-53e2afecc132',
      'dreamshaper-v7': 'e71a1c2f-4f80-4800-934f-2c68979d8cc8',
      'rpg-v5': 'f1929ea2-b099-4d8c-a95a-b8a28d3f5b49',
      'photoreal-v2': 'b24e16ff-06e3-43eb-9f82-6fcd85431356',
      'anime-pastel-dream': 'e9b8c9f0-d8e0-4f16-8e2d-8cd1b3e7c0c0',
      'leonardo-vision-xl': 'b63f7119-31dc-4540-969b-2a9df997e173'
    };

    if (modelName && modelMap[modelName]) {
      return modelMap[modelName];
    }

    // Default to Leonardo Diffusion XL
    return modelMap['leonardo-diffusion-xl'];
  }

  private mapToPresetStyle(prompt: string): string | undefined {
    const lower = prompt.toLowerCase();

    if (lower.includes('anime') || lower.includes('manga')) {
      return 'ANIME';
    }
    if (lower.includes('photo') || lower.includes('realistic')) {
      return 'PHOTOREALISTIC';
    }
    if (lower.includes('cinematic') || lower.includes('film')) {
      return 'CINEMATIC';
    }
    if (lower.includes('concept') || lower.includes('game')) {
      return 'CONCEPT_ART';
    }
    if (lower.includes('illustration') || lower.includes('art')) {
      return 'ILLUSTRATION';
    }

    return undefined;
  }
}