import { GenerateInput, EditInput, ProviderResult, NotImplementedError } from '../types.js';

/**
 * Abstract base class for image generation providers
 */
export abstract class ImageProvider {
  /**
   * Provider name for identification
   */
  abstract readonly name: string;

  /**
   * Check if the provider is configured and ready to use
   */
  abstract isConfigured(): boolean;

  /**
   * Generate images from text prompt
   * @param input Generation parameters
   * @returns Promise resolving to generated images
   */
  async generate(_input: GenerateInput): Promise<ProviderResult> {
    throw new NotImplementedError(`${this.name} provider does not implement generate()`);
  }

  /**
   * Edit existing image with text prompt
   * @param input Edit parameters including base image
   * @returns Promise resolving to edited images
   */
  async edit(_input: EditInput): Promise<ProviderResult> {
    throw new NotImplementedError(`${this.name} provider does not implement edit()`);
  }

  /**
   * Get required environment variables for this provider
   */
  abstract getRequiredEnvVars(): string[];

  /**
   * Get provider-specific capabilities
   */
  getCapabilities(): {
    supportsGenerate: boolean;
    supportsEdit: boolean;
    maxWidth?: number;
    maxHeight?: number;
    supportedModels?: string[];
  } {
    return {
      supportsGenerate: true,
      supportsEdit: false
    };
  }

  /**
   * Helper to convert image buffer to data URL
   */
  protected bufferToDataUrl(buffer: Buffer, mimeType: string): string {
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  /**
   * Helper to extract buffer from data URL
   */
  protected dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URL format');
    }

    return {
      mimeType: matches[1],
      buffer: Buffer.from(matches[2], 'base64')
    };
  }

  /**
   * Helper to create timeout with AbortController
   */
  protected createTimeout(ms: number = 30000): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller;
  }
}