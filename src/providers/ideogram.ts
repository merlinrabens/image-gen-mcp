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
      const images = await Promise.all(response.data.map(async (item: any) => {
        let dataUrl: string;
        if (item.url) {
          // If URL is provided, fetch the image and convert to base64
          const imageResponse = await fetch(item.url);
          const arrayBuffer = await imageResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          dataUrl = this.bufferToDataUrl(buffer, 'image/png');
        } else if (item.base64) {
          // Check if base64 already includes the data URL prefix
          if (item.base64.startsWith('data:')) {
            dataUrl = item.base64;
          } else {
            dataUrl = `data:image/png;base64,${item.base64}`;
          }
        } else {
          throw new ProviderError('No image data in response', this.name, false);
        }

        return {
          dataUrl,
          format: 'png' as const,
          seed: item.seed // Ideogram returns seed for reproducibility
        };
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

      // Create white mask if not provided (edit entire image)
      let maskBuffer: Buffer;
      if (input.maskImage) {
        maskBuffer = this.dataUrlToBuffer(input.maskImage).buffer;
      } else {
        // Create a proper-sized mask matching the image dimensions
        try {
          const sharp = (await import('sharp')).default;
          const metadata = await sharp(baseImageData.buffer).metadata();
          const width = metadata.width || 1024;
          const height = metadata.height || 1024;

          // Create RGB mask with white center and thin black border
          // Ideogram requires BOTH black and white pixels (validation checks for mixed content)
          // White = edit area, Black = preserve area
          // We use 99% white (edit most of image) with 1% black border to satisfy validation
          const maskPixels = Buffer.alloc(width * height * 3);
          const borderSize = Math.max(1, Math.floor(width * 0.005)); // 0.5% border

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = y * width + x;
              // White in center (editable), thin black border (preserved)
              const isEditable = x >= borderSize && x < width - borderSize &&
                                 y >= borderSize && y < height - borderSize;
              const value = isEditable ? 255 : 0;
              maskPixels[i * 3] = value;     // R
              maskPixels[i * 3 + 1] = value; // G
              maskPixels[i * 3 + 2] = value; // B
            }
          }

          maskBuffer = await sharp(maskPixels, {
            raw: { width, height, channels: 3 }
          }).png({ compressionLevel: 6, palette: false }).toBuffer();
        } catch (err) {
          logger.warn('Failed to create proper-sized mask, using 1x1 fallback', { error: err });
          // Fallback to 1x1 white mask
          maskBuffer = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B, 0x55,
            0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54,
            0x08, 0x1D, 0x01, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
          ]);
        }
      }

      // Create multipart form data
      const boundary = '----IdeogramFormBoundary' + Math.random().toString(36).substring(2);
      const formParts: Buffer[] = [];

      // Add image file
      formParts.push(Buffer.from(`--${boundary}\r\n`));
      formParts.push(Buffer.from(`Content-Disposition: form-data; name="image"; filename="image.png"\r\n`));
      formParts.push(Buffer.from(`Content-Type: image/png\r\n\r\n`));
      formParts.push(baseImageData.buffer);
      formParts.push(Buffer.from(`\r\n`));

      // Add mask file
      formParts.push(Buffer.from(`--${boundary}\r\n`));
      formParts.push(Buffer.from(`Content-Disposition: form-data; name="mask"; filename="mask.png"\r\n`));
      formParts.push(Buffer.from(`Content-Type: image/png\r\n\r\n`));
      formParts.push(maskBuffer);
      formParts.push(Buffer.from(`\r\n`));

      // Add prompt
      formParts.push(Buffer.from(`--${boundary}\r\n`));
      formParts.push(Buffer.from(`Content-Disposition: form-data; name="prompt"\r\n\r\n`));
      formParts.push(Buffer.from(input.prompt));
      formParts.push(Buffer.from(`\r\n`));

      // Note: V3 edit endpoint doesn't support model parameter

      // End boundary
      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const formData = Buffer.concat(formParts);

      const { statusCode, body } = await request(
        'https://api.ideogram.ai/v1/ideogram-v3/edit',
        {
          method: 'POST',
          headers: {
            'Api-Key': this.apiKey,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': formData.length.toString()
          },
          body: formData,
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