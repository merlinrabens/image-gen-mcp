import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Google Gemini provider using Gemini 2.5 Flash Image for generation and editing
 * Documentation: https://ai.google.dev/gemini-api/docs/image-generation
 */
export class GeminiProvider extends ImageProvider {
  readonly name = 'GEMINI';

  constructor() {
    super();
  }

  private getApiKey(): string | undefined {
    return process.env.GEMINI_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  getRequiredEnvVars(): string[] {
    return ['GEMINI_API_KEY'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true, // Gemini 2.5 Flash Image supports advanced editing
      maxWidth: 3072,
      maxHeight: 3072,
      supportedModels: [
        'gemini-2.5-flash-image-preview', // Primary image generation model (aka nano-banana)
        'gemini-2.0-flash-exp' // Experimental version (deprecated Oct 2025)
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError('Gemini API key not configured', this.name);
    }

    const model = input.model || 'gemini-2.5-flash-image-preview';

    logger.info(`Gemini generating image`, { model, prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout(60000); // Gemini can be slower

      // Build request for Gemini 2.5 Flash Image
      // The model expects natural language prompts, not keywords
      const requestBody = {
        contents: [{
          parts: [{
            text: input.prompt // Direct prompt without prefix
          }]
        }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192
          // aspectRatio parameter removed - not supported in current API version
        }
      };

      logger.info(`Requesting Gemini image (1:1 output, aspect ratio control not available)`);

      const { statusCode, body } = await request(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `Gemini API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Extract image from response
      const candidates = response.candidates?.[0];
      const content = candidates?.content;
      const parts = content?.parts;

      if (!parts || parts.length === 0) {
        throw new ProviderError('No image generated in response', this.name, false);
      }

      // Look for image data in the response
      const images: Array<{ dataUrl: string; format: 'png' | 'jpg' | 'jpeg' | 'webp' }> = [];

      for (const part of parts) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          const format = this.extractFormat(mimeType);
          const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
          images.push({ dataUrl, format });
        } else if (part.fileData) {
          // Handle file-based responses if applicable
          logger.warn('File-based image response not yet implemented', { fileUri: part.fileData.fileUri });
        }
      }

      if (images.length === 0) {
        // If no images in response, it might be text describing the limitation
        const textResponse = parts.find((p: any) => p.text)?.text;
        logger.warn('Gemini returned text instead of image', { response: textResponse });

        throw new ProviderError(
          textResponse || 'Gemini 2.5 Flash Image requires pay-as-you-go Blaze pricing plan',
          this.name,
          false
        );
      }

      return {
        images,
        provider: this.name,
        model,
        warnings: [
          'All Gemini images include a SynthID watermark',
          'Gemini currently only supports 1:1 (square) aspect ratio'
        ]
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Gemini request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError('Gemini API key not configured', this.name);
    }

    const model = input.model || 'gemini-2.5-flash-image-preview';

    logger.info(`Gemini editing image`, { model, prompt: input.prompt.slice(0, 50) });

    try {
      const controller = this.createTimeout(60000);

      // Extract base image data (supports both data URLs and file paths)
      const baseImageData = await this.getImageBuffer(input.baseImage);

      // Build multi-modal request for image editing
      // Gemini 2.5 Flash Image can handle up to 3 images for composition/editing
      const parts: any[] = [
        {
          inlineData: {
            mimeType: baseImageData.mimeType,
            data: baseImageData.buffer.toString('base64')
          }
        }
      ];

      // Add mask if provided (Gemini treats this as a second image for guidance)
      if (input.maskImage) {
        const maskData = await this.getImageBuffer(input.maskImage);
        parts.push({
          inlineData: {
            mimeType: maskData.mimeType,
            data: maskData.buffer.toString('base64')
          }
        });

        // Add specific instructions for mask-based editing
        parts.push({
          text: `Using the second image as a mask/guide, ${input.prompt}`
        });
      } else {
        // Without mask, provide direct editing instructions
        parts.push({
          text: input.prompt
        });
      }

      const requestBody = {
        contents: [{
          parts
        }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192
        }
      };

      const { statusCode, body } = await request(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );

      const response = await body.json() as any;

      if (statusCode !== 200) {
        const message = response.error?.message || `Gemini API error: ${statusCode}`;
        const isRetryable = statusCode >= 500 || statusCode === 429;
        throw new ProviderError(message, this.name, isRetryable, response);
      }

      // Extract edited image from response
      const candidates = response.candidates?.[0];
      const content = candidates?.content;
      const responseParts = content?.parts;

      if (!responseParts || responseParts.length === 0) {
        throw new ProviderError('No edited image in response', this.name, false);
      }

      const images: Array<{ dataUrl: string; format: 'png' | 'jpg' | 'jpeg' | 'webp' }> = [];

      for (const part of responseParts) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          const format = this.extractFormat(mimeType);
          const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
          images.push({ dataUrl, format });
        }
      }

      if (images.length === 0) {
        const textResponse = responseParts.find((p: any) => p.text)?.text;
        throw new ProviderError(
          textResponse || 'Gemini did not return an edited image',
          this.name,
          false
        );
      }

      return {
        images,
        provider: this.name,
        model,
        warnings: [
          'All Gemini images include a SynthID watermark',
          ...(input.maskImage ? [] : ['Editing without mask - Gemini will intelligently detect areas to modify'])
        ]
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Gemini edit request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  // Note: calculateAspectRatio method removed as aspectRatio parameter is not supported in current Gemini API
  // The API currently only supports 1:1 (square) output regardless of requested dimensions

  /**
   * Extract format from MIME type
   */
  private extractFormat(mimeType: string): 'png' | 'jpg' | 'jpeg' | 'webp' {
    const format = mimeType.split('/')[1]?.toLowerCase();
    switch (format) {
      case 'png':
        return 'png';
      case 'jpeg':
      case 'jpg':
        return 'jpeg';
      case 'webp':
        return 'webp';
      default:
        return 'png'; // Default fallback
    }
  }
}