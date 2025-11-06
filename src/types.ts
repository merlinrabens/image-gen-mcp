import { z } from 'zod';

// Response format enum for consistent formatting across tools
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

export const GenerateInputSchema = z.object({
  prompt: z.string().min(1).max(4000).describe(
    'Text prompt describing the image to generate. ' +
    'Examples: "A serene mountain landscape at sunset", ' +
    '"Professional headshot of a business executive in modern office", ' +
    '"Logo with text \'TechStartup 2025\' in bold modern typography"'
  ),
  provider: z.string().optional().describe(
    'Provider name or "auto" for intelligent selection based on prompt content. ' +
    'Options: OPENAI (versatile, creative), STABILITY (photorealistic), ' +
    'LEONARDO (artistic, character consistency), IDEOGRAM (text rendering), ' +
    'BFL (ultra-high quality), FAL (ultra-fast), GEMINI (multimodal), ' +
    'REPLICATE (open models), CLIPDROP (post-processing). ' +
    'Default: "auto"'
  ),
  width: z.number().int().min(64).max(4096).optional().describe(
    'Image width in pixels (64-4096). Provider-specific limits apply. ' +
    'Examples: 1024 (square), 1792 (landscape), 512 (draft)'
  ),
  height: z.number().int().min(64).max(4096).optional().describe(
    'Image height in pixels (64-4096). Provider-specific limits apply. ' +
    'Examples: 1024 (square), 1024 (portrait), 512 (draft)'
  ),
  model: z.string().optional().describe(
    'Specific model name for the provider. ' +
    'Examples: "dall-e-3" (OpenAI), "stable-image-core-v1" (Stability), "V_2_TURBO" (Ideogram)'
  ),
  seed: z.number().int().optional().describe(
    'Random seed for reproducible generation (integer). ' +
    'Use same seed with same prompt for consistent results'
  ),
  guidance: z.number().min(0).max(30).optional().describe(
    'Guidance scale/CFG scale (0-30). Higher values = more prompt adherence. ' +
    'Typical range: 7-15. Not supported by all providers'
  ),
  steps: z.number().int().min(1).max(150).optional().describe(
    'Number of inference steps (1-150). More steps = higher quality but slower. ' +
    'Typical range: 20-50. Not supported by all providers'
  ),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.JSON).optional().describe(
    'Output format: "json" for structured data (default), "markdown" for human-readable text'
  )
}).strict();

export const EditInputSchema = z.object({
  prompt: z.string().min(1).max(4000).describe(
    'Text prompt describing the edit operation. ' +
    'Examples: "Add a rainbow to the sky", "Remove the background", ' +
    '"Change the shirt color to blue", "Make the image more vibrant"'
  ),
  provider: z.string().optional().describe(
    'Provider name or "auto" for intelligent selection. ' +
    'Edit-capable providers: OPENAI, STABILITY, BFL, GEMINI, CLIPDROP. ' +
    'Default: "auto"'
  ),
  baseImage: z.string().describe(
    'Image to edit. Supports three formats: ' +
    '1) Data URLs: "data:image/png;base64,..." ' +
    '2) File paths: "/path/to/image.png" ' +
    '3) File URLs: "file:///path/to/image.png"'
  ),
  maskImage: z.string().optional().describe(
    'Optional mask image indicating edit regions (white=edit, black=preserve). ' +
    'Supports data URLs, file paths, or file URLs. Not required for all providers'
  ),
  width: z.number().int().min(64).max(4096).optional().describe(
    'Output image width in pixels. Defaults to input image dimensions if not specified'
  ),
  height: z.number().int().min(64).max(4096).optional().describe(
    'Output image height in pixels. Defaults to input image dimensions if not specified'
  ),
  model: z.string().optional().describe(
    'Specific model name for the provider. ' +
    'Examples: "gpt-image-1" (OpenAI), "stable-image-core-v1" (Stability)'
  ),
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.JSON).optional().describe(
    'Output format: "json" for structured data (default), "markdown" for human-readable text'
  )
}).strict();

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

export type ProviderName = 'OPENAI' | 'STABILITY' | 'REPLICATE' | 'GEMINI' | 'IDEOGRAM' | 'BFL' | 'LEONARDO' | 'FAL' | 'CLIPDROP' | 'MOCK' | 'RECRAFT' | 'FAL_FLUX' | 'QWEN';

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