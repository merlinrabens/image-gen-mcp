import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * OpenAI DALL-E provider for image generation
 */
export class OpenAIProvider extends ImageProvider {
  readonly name = 'OPENAI';

  constructor() {
    super();
  }

  private getApiKey(): string | undefined {
    return process.env.OPENAI_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  getRequiredEnvVars(): string[] {
    return ['OPENAI_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true,
      maxWidth: 1792,
      maxHeight: 1792,
      supportedModels: ['dall-e-3', 'gpt-image-1']
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError('OpenAI API key not configured', this.name);
    }

    const model = input.model || 'dall-e-3';
    const size = this.mapSize(input.width, input.height);

    logger.info(`OpenAI generating image`, { model, size, prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout();

      const { statusCode, body } = await request('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size,
          response_format: 'b64_json',
          n: 1
        }),
        signal: controller.signal
      });

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `OpenAI API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      const images = response.data.map((img: any) => ({
        dataUrl: `data:image/png;base64,${img.b64_json}`,
        format: 'png' as const
      }));

      return {
        images,
        provider: this.name,
        model
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`OpenAI request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError('OpenAI API key not configured', this.name);
    }

    logger.info(`OpenAI editing image`, { prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout();

      // Convert base64 to blob for form data (supports both data URLs and file paths)
      let baseImageBuffer = (await this.getImageBuffer(input.baseImage)).buffer;

      // OpenAI requires RGBA format - convert if needed
      try {
        const sharp = (await import('sharp')).default;
        const metadata = await sharp(baseImageBuffer).metadata();
        if (metadata.channels === 3) {
          // RGB image - add alpha channel
          baseImageBuffer = await sharp(baseImageBuffer)
            .ensureAlpha()
            .png()
            .toBuffer();
        }
      } catch (err) {
        logger.warn('Failed to convert image to RGBA, proceeding with original', { error: err });
      }

      const maskBuffer = input.maskImage ? (await this.getImageBuffer(input.maskImage)).buffer : undefined;

      // Select model - gpt-image-1 is newer and better, dall-e-2 for fallback
      const model = input.model || 'gpt-image-1';

      // Create multipart form data manually
      const boundary = `----FormBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      // Add image part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="image.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      ));
      parts.push(baseImageBuffer);
      parts.push(Buffer.from('\r\n'));

      // Add mask if provided
      if (maskBuffer) {
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="mask"; filename="mask.png"\r\n` +
          `Content-Type: image/png\r\n\r\n`
        ));
        parts.push(maskBuffer);
        parts.push(Buffer.from('\r\n'));
      }

      // Add other fields
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${model}\r\n`
      ));

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
        `${input.prompt}\r\n`
      ));

      // response_format only supported for dall-e-2, gpt-image-1 uses output_format
      if (model === 'dall-e-2') {
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
          `b64_json\r\n`
        ));
      } else {
        // gpt-image-1 uses output_format and returns URL by default
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="output_format"\r\n\r\n` +
          `png\r\n`
        ));
      }

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="n"\r\n\r\n` +
        `1\r\n`
      ));

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const formData = Buffer.concat(parts);

      const { statusCode, body } = await request('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formData,
        signal: controller.signal
      });

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `OpenAI API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Handle response based on model
      const images = await Promise.all(response.data.map(async (img: any) => {
        if (img.b64_json) {
          // dall-e-2 returns base64
          return {
            dataUrl: `data:image/png;base64,${img.b64_json}`,
            format: 'png' as const
          };
        } else if (img.url) {
          // gpt-image-1 returns URL - download and convert to data URL
          const imageResponse = await fetch(img.url);
          const arrayBuffer = await imageResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          return {
            dataUrl: this.bufferToDataUrl(buffer, 'image/png'),
            format: 'png' as const
          };
        }
        throw new ProviderError('No image data in OpenAI response', this.name, false);
      }));

      return {
        images,
        provider: this.name,
        model
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`OpenAI request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  /**
   * Map width/height to OpenAI size strings
   * DALL-E 3 supports: 1024x1024, 1792x1024, 1024x1792
   */
  private mapSize(width?: number, height?: number): string {
    // DALL-E 3 exact sizes
    if (width && height) {
      if (width === 1024 && height === 1024) return '1024x1024';
      if (width === 1792 && height === 1024) return '1792x1024';
      if (width === 1024 && height === 1792) return '1024x1792';
    }

    // Default based on aspect ratio
    if (width && height) {
      const ratio = width / height;
      if (ratio > 1.5) return '1792x1024'; // Landscape
      if (ratio < 0.7) return '1024x1792'; // Portrait
    }

    return '1024x1024'; // Square default
  }
}