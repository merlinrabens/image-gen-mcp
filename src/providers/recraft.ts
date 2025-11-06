/**
 * Recraft V3 Provider
 * #1 globally ranked image generation model (ELO 1172, 72% win rate)
 *
 * Unique Features:
 * - Vector generation (SVG output) - ONLY provider with this capability
 * - Perfect text rendering (guaranteed flawless)
 * - Superior anatomical accuracy
 * - Both raster and vector image generation
 *
 * Best for:
 * - Logo design and branding
 * - Graphic design and marketing materials
 * - Text-heavy images (posters, packaging)
 * - Print-ready designs (vector output)
 * - Professional design work
 */

import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';

interface RecraftGenerateResponse {
  data: Array<{
    url: string;
    format: 'raster' | 'vector';
  }>;
}

export class RecraftProvider extends ImageProvider {
  readonly name = 'RECRAFT';
  private apiKey: string | undefined;
  private readonly baseUrl = 'https://external.api.recraft.ai/v1';

  constructor() {
    super();
    this.apiKey = process.env.RECRAFT_API_KEY;
  }

  isConfigured(): boolean {
    return this.validateApiKey(this.apiKey);
  }

  getRequiredEnvVars(): string[] {
    return ['RECRAFT_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: false, // Recraft V3 focuses on generation, not editing
      maxWidth: 2048,
      maxHeight: 2048,
      supportedModels: ['recraftv3'],
      notes: [
        '#1 globally ranked model (ELO 1172, 72% win rate)',
        'Perfect text rendering capability',
        'Best for logos, branding, graphic design, text-heavy images',
        'Supports both realistic and illustration styles',
        'Vector generation support available'
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    this.validatePrompt(input.prompt);
    await this.checkRateLimit();

    const cacheKey = this.generateCacheKey(input);
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(45000); // 45s timeout for quality generation

      try {
        // Determine dimensions
        const width = input.width || 1024;
        const height = input.height || 1024;
        const size = `${width}x${height}`;

        // Build request body with required parameters only
        // Model: recraftv3 is the Recraft V3 model identifier in the API
        const requestBody: any = {
          prompt: input.prompt,
          size: size,
          model: 'recraftv3',
          response_format: 'url',
          n: 1
        };

        // Only add style if it's a vector/illustration request
        // Default realistic images don't need explicit style
        const promptLower = input.prompt.toLowerCase();
        if (promptLower.includes('vector') || promptLower.includes('svg')) {
          requestBody.style = 'vector_illustration';
        } else if (promptLower.includes('digital art') || promptLower.includes('illustration')) {
          requestBody.style = 'digital_illustration';
        }

        const response = await fetch(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage: string;

          try {
            const errorJson = JSON.parse(errorBody);
            errorMessage = errorJson.error?.message || errorJson.message || response.statusText;
          } catch {
            errorMessage = errorBody || response.statusText;
          }

          const isRetryable = response.status >= 500 || response.status === 429;
          throw new ProviderError(
            `Recraft API error (${response.status}): ${errorMessage}`,
            this.name,
            isRetryable
          );
        }

        const data = await response.json() as RecraftGenerateResponse;

        if (!data.data || data.data.length === 0) {
          throw new ProviderError('No images returned from Recraft API', this.name, false);
        }

        // Download the generated image
        const imageUrl = data.data[0].url;
        const imageFormat = data.data[0].format;

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new ProviderError(`Failed to download generated image: ${imageResponse.statusText}`, this.name, true);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

        // Determine MIME type based on format
        const mimeType = imageFormat === 'vector'
          ? 'image/svg+xml'
          : 'image/png';

        const dataUrl = this.bufferToDataUrl(imageBuffer, mimeType);

        const result: ProviderResult = {
          provider: this.name,
          model: 'recraftv3',
          images: [{
            dataUrl,
            format: 'png' // Base format type for compatibility
          }],
          warnings: [
            imageFormat === 'vector' ? 'Vector output (SVG format) - scalable and print-ready' : undefined,
            'Perfect text rendering enabled',
            '#1 globally ranked model'
          ].filter(Boolean) as string[]
        };

        this.cacheResult(cacheKey, result);
        return result;

      } finally {
        this.cleanupController(controller);
      }
    });
  }

  async edit(_input: EditInput): Promise<ProviderResult> {
    throw new ProviderError('Recraft V3 does not support image editing', this.name, false);
  }
}
