import { z } from 'zod';

export const GenerateInputSchema = z.object({
  prompt: z.string().min(1).describe('Text prompt for image generation'),
  provider: z.string().optional().describe('Provider name (OPENAI, STABILITY, REPLICATE, GEMINI, MOCK)'),
  width: z.number().int().min(64).max(4096).optional().describe('Image width in pixels'),
  height: z.number().int().min(64).max(4096).optional().describe('Image height in pixels'),
  model: z.string().optional().describe('Model name for the provider'),
  seed: z.number().int().optional().describe('Random seed for reproducible generation'),
  guidance: z.number().min(0).max(30).optional().describe('Guidance scale (CFG) for generation'),
  steps: z.number().int().min(1).max(150).optional().describe('Number of inference steps')
});

export const EditInputSchema = z.object({
  prompt: z.string().min(1).describe('Text prompt for image editing'),
  provider: z.string().optional().describe('Provider name (OPENAI, STABILITY, REPLICATE, GEMINI, MOCK)'),
  baseImage: z.string().describe('Base64 data URL or URL of the image to edit'),
  maskImage: z.string().optional().describe('Base64 data URL or URL of the mask image'),
  model: z.string().optional().describe('Model name for the provider')
});

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type EditInput = z.infer<typeof EditInputSchema>;

export interface ProviderResult {
  images: Array<{
    dataUrl: string;
    format: 'png' | 'jpg' | 'jpeg' | 'webp';
  }>;
  provider: string;
  model?: string;
  warnings?: string[];
}

export type ProviderName = 'OPENAI' | 'STABILITY' | 'REPLICATE' | 'GEMINI' | 'MOCK';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly isRetryable: boolean = false,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class NotImplementedError extends Error {
  constructor(message: string = 'Method not implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}