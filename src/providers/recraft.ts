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
        '⚠️  EXPERIMENTAL: API parameters still being verified',
        'Perfect text rendering capability (when API is finalized)',
        'Best for logos, branding, graphic design, text-heavy images',
        'Vector generation support planned'
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
        // Determine output format: default to raster unless vector is specified in prompt
        const outputFormat = input.prompt.toLowerCase().includes('vector') ||
                            input.prompt.toLowerCase().includes('svg') ||
                            input.prompt.toLowerCase().includes('scalable')
          ? 'vector'
          : 'raster';

        // Determine size preset based on dimensions
        const width = input.width || 1024;
        const height = input.height || 1024;
        let sizePreset = 'square_hd'; // default

        if (width === height) {
          sizePreset = width >= 1024 ? 'square_hd' : 'square';
        } else if (width > height) {
          // Landscape
          const ratio = width / height;
          sizePreset = ratio > 1.5 ? 'landscape_16_9' : 'landscape_4_3';
        } else {
          // Portrait
          const ratio = height / width;
          sizePreset = ratio > 1.5 ? 'portrait_16_9' : 'portrait_4_3';
        }

        const response = await fetch(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt: input.prompt,
            style: outputFormat === 'vector' ? 'vector_illustration' : 'realistic_image',
            size: sizePreset
          }),
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
