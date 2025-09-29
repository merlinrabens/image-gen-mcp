/**
 * Type definitions for provider API responses
 */

// BFL/Flux API Response Types
export interface BFLGenerateResponse {
  id?: string;
  sample?: string;
  status?: 'Ready' | 'Failed' | 'Pending';
  result?: {
    sample: string;
  };
  error?: {
    message: string;
  };
}

// Leonardo API Response Types
export interface LeonardoGenerationJob {
  sdGenerationJob?: {
    generationId: string;
  };
}

export interface LeonardoGenerationStatus {
  generations_by_pk: {
    status: 'COMPLETE' | 'FAILED' | 'PENDING';
    generated_images?: Array<{
      url: string;
    }>;
    nsfw?: boolean;
  };
}

// Fal.ai API Response Types
export interface FalGenerateResponse {
  request_id?: string;
  images?: Array<string | { url: string }>;
  status?: 'COMPLETED' | 'FAILED' | 'PENDING';
  error?: string;
  has_nsfw_concepts?: boolean[];
  timings?: {
    inference?: number;
    total?: number;
  };
}

// Ideogram API Response Types
export interface IdeogramGenerateResponse {
  data: Array<{
    url?: string;
    base64?: string;
    seed?: number;
  }>;
  error?: {
    message: string;
  };
}

// Clipdrop API Response Types
export interface ClipdropResponse {
  // Clipdrop returns raw image data directly
  buffer?: Buffer;
  error?: {
    message: string;
  };
}

// Generic error response
export interface APIErrorResponse {
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  message?: string;
  statusCode?: number;
}