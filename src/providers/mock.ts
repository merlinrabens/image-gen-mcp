import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Mock provider for testing without API keys
 * Returns small gradient PNG images
 */
export class MockProvider extends ImageProvider {
  readonly name = 'MOCK';

  isConfigured(): boolean {
    return true; // Always available
  }

  getRequiredEnvVars(): string[] {
    return []; // No env vars needed
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: true,
      maxWidth: 256,
      maxHeight: 256,
      supportedModels: ['mock-v1']
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    logger.info(`Mock provider generating image`, { prompt: input.prompt });

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create a simple gradient PNG
    const width = Math.min(input.width || 256, 256);
    const height = Math.min(input.height || 256, 256);
    const png = this.createGradientPNG(width, height, input.prompt);

    return {
      images: [{
        dataUrl: this.bufferToDataUrl(png, 'image/png'),
        format: 'png'
      }],
      provider: this.name,
      model: 'mock-v1',
      warnings: [
        'This is a mock image for testing. Configure real providers for actual generation.',
        `Requested size ${input.width || 256}x${input.height || 256} was clamped to ${width}x${height}`
      ]
    };
  }

  async edit(input: EditInput): Promise<ProviderResult> {
    logger.info(`Mock provider editing image`, { prompt: input.prompt });

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create a different gradient for edit
    const png = this.createGradientPNG(256, 256, input.prompt, true);

    return {
      images: [{
        dataUrl: this.bufferToDataUrl(png, 'image/png'),
        format: 'png'
      }],
      provider: this.name,
      model: 'mock-v1',
      warnings: [
        'This is a mock edited image for testing. Configure real providers for actual editing.'
      ]
    };
  }

  /**
   * Create a simple PNG with gradient based on prompt hash
   */
  private createGradientPNG(width: number, height: number, prompt: string, inverted = false): Buffer {
    // Simple hash function for color generation
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    // Generate colors from hash
    const r1 = (Math.abs(hash) % 256);
    const g1 = (Math.abs(hash >> 8) % 256);
    const b1 = (Math.abs(hash >> 16) % 256);

    const r2 = inverted ? 255 - r1 : (r1 + 128) % 256;
    const g2 = inverted ? 255 - g1 : (g1 + 128) % 256;
    const b2 = inverted ? 255 - b1 : (b1 + 128) % 256;

    // Create minimal PNG header and data
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0); // Length
    ihdr.write('IHDR', 4);
    ihdr.writeUInt32BE(width, 8);
    ihdr.writeUInt32BE(height, 12);
    ihdr[16] = 8; // Bit depth
    ihdr[17] = 2; // Color type (RGB)
    ihdr[18] = 0; // Compression
    ihdr[19] = 0; // Filter
    ihdr[20] = 0; // Interlace

    // Simple CRC for IHDR (simplified, not accurate but works for mock)
    ihdr.writeUInt32BE(0x12345678, 21);

    // Create pixel data with gradient
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      pixels.push(0); // Filter type
      for (let x = 0; x < width; x++) {
        const t = (x + y) / (width + height);
        pixels.push(Math.floor(r1 * (1 - t) + r2 * t)); // R
        pixels.push(Math.floor(g1 * (1 - t) + g2 * t)); // G
        pixels.push(Math.floor(b1 * (1 - t) + b2 * t)); // B
      }
    }

    const pixelBuffer = Buffer.from(pixels);

    // IDAT chunk (simplified)
    const idat = Buffer.alloc(pixelBuffer.length + 12);
    idat.writeUInt32BE(pixelBuffer.length, 0);
    idat.write('IDAT', 4);
    pixelBuffer.copy(idat, 8);
    idat.writeUInt32BE(0x87654321, pixelBuffer.length + 8); // CRC

    // IEND chunk
    const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

    return Buffer.concat([pngSignature, ihdr, idat, iend]);
  }
}