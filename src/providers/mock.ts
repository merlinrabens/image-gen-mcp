import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult } from '../types.js';
import { logger } from '../util/logger.js';
import { deflateSync } from 'zlib';

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
   * Create a valid PNG with gradient based on prompt hash
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

    // Create PNG signature
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // Bit depth
    ihdrData[9] = 2; // Color type (RGB)
    ihdrData[10] = 0; // Compression
    ihdrData[11] = 0; // Filter
    ihdrData[12] = 0; // Interlace
    const ihdr = this.createChunk('IHDR', ihdrData);

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

    // Compress pixel data with zlib
    const pixelBuffer = Buffer.from(pixels);
    const compressedPixels = deflateSync(pixelBuffer);

    // IDAT chunk
    const idat = this.createChunk('IDAT', compressedPixels);

    // IEND chunk
    const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

    return Buffer.concat([pngSignature, ihdr, idat, iend]);
  }

  /**
   * Create a PNG chunk with proper CRC
   */
  private createChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type, 'ascii');
    const crcBuffer = Buffer.concat([typeBuffer, data]);
    const crcValue = this.crc32(crcBuffer);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcValue >>> 0, 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
  }

  /**
   * Calculate CRC32 checksum (PNG standard)
   */
  private crc32(buffer: Buffer): number {
    const table = this.makeCRCTable();
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < buffer.length; i++) {
      crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Generate CRC32 lookup table
   */
  private makeCRCTable(): number[] {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }
}