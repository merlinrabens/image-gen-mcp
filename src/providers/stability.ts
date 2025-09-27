import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Stability AI provider for Stable Diffusion models
 */
export class StabilityProvider extends ImageProvider {
  readonly name = 'STABILITY';
  private apiKey: string | undefined;

  constructor() {
    super();
    this.apiKey = process.env.STABILITY_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequiredEnvVars(): string[] {
    return ['STABILITY_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true,
      maxWidth: 1536,
      maxHeight: 1536,
      supportedModels: ['stable-diffusion-3.5-large', 'stable-diffusion-3.5-medium', 'stable-image-core-v1']
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError('Stability API key not configured', this.name);
    }

    const model = input.model || 'stable-image-core-v1';
    const width = input.width || 1024;
    const height = input.height || 1024;

    logger.info(`Stability generating image`, { model, width, height, prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout();

      const body: any = {
        prompt: input.prompt,
        output_format: 'png',
        aspect_ratio: this.getAspectRatio(width, height)
      };

      if (input.seed !== undefined) body.seed = input.seed;

      const { statusCode, body: responseBody } = await request(`https://api.stability.ai/v2beta/stable-image/generate/core`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'image/*'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (statusCode === 200) {
        const buffer = await responseBody.arrayBuffer();
        const dataUrl = this.bufferToDataUrl(Buffer.from(buffer), 'image/png');

        return {
          images: [{
            dataUrl,
            format: 'png'
          }],
          provider: this.name,
          model
        };
      } else {
        const errorText = await responseBody.text();
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(`Stability API error: ${statusCode} - ${errorText}`, this.name, isRetryable);
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Stability request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new ProviderError('Stability API key not configured', this.name);
    }

    logger.info(`Stability editing image`, { prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout();

      // Extract base64 data from data URL
      const baseImageData = this.dataUrlToBuffer(input.baseImage);

      // Create multipart form data
      const boundary = `----FormBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      // Add image part
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="image.png"\r\n` +
        `Content-Type: ${baseImageData.mimeType}\r\n\r\n`
      ));
      parts.push(baseImageData.buffer);
      parts.push(Buffer.from('\r\n'));

      // Add prompt
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
        `${input.prompt}\r\n`
      ));

      // Add mode
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="mode"\r\n\r\n` +
        `image-to-image\r\n`
      ));

      // Add output format
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="output_format"\r\n\r\n` +
        `png\r\n`
      ));

      // Add strength (how much to change the image)
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="strength"\r\n\r\n` +
        `0.7\r\n`
      ));

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const formData = Buffer.concat(parts);

      const { statusCode, body: responseBody } = await request(`https://api.stability.ai/v2beta/stable-image/generate/sd3`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Accept': 'image/*'
        },
        body: formData,
        signal: controller.signal
      });

      if (statusCode === 200) {
        const buffer = await responseBody.arrayBuffer();
        const dataUrl = this.bufferToDataUrl(Buffer.from(buffer), 'image/png');

        return {
          images: [{
            dataUrl,
            format: 'png'
          }],
          provider: this.name,
          model: 'stable-diffusion-3'
        };
      } else {
        const errorText = await responseBody.text();
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(`Stability API error: ${statusCode} - ${errorText}`, this.name, isRetryable);
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Stability request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  /**
   * Get aspect ratio string for Stability API
   */
  private getAspectRatio(width: number, height: number): string {
    const ratio = width / height;

    // Common aspect ratios supported by Stability
    if (Math.abs(ratio - 1) < 0.1) return '1:1';
    if (Math.abs(ratio - 16/9) < 0.1) return '16:9';
    if (Math.abs(ratio - 9/16) < 0.1) return '9:16';
    if (Math.abs(ratio - 21/9) < 0.1) return '21:9';
    if (Math.abs(ratio - 9/21) < 0.1) return '9:21';
    if (Math.abs(ratio - 4/3) < 0.1) return '4:3';
    if (Math.abs(ratio - 3/4) < 0.1) return '3:4';
    if (Math.abs(ratio - 3/2) < 0.1) return '3:2';
    if (Math.abs(ratio - 2/3) < 0.1) return '2:3';

    // Default to closest standard ratio
    if (ratio > 1.5) return '16:9';
    if (ratio < 0.7) return '9:16';
    return '1:1';
  }
}