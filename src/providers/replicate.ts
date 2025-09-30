import { request } from 'undici';
import { ImageProvider } from './base.js';
import { GenerateInput, EditInput, ProviderResult, ProviderError } from '../types.js';
import { logger } from '../util/logger.js';

/**
 * Replicate provider for various image models
 */
export class ReplicateProvider extends ImageProvider {
  readonly name = 'REPLICATE';

  constructor() {
    super();
  }

  private getApiToken(): string | undefined {
    return process.env.REPLICATE_API_TOKEN;
  }

  isConfigured(): boolean {
    return !!this.getApiToken();
  }

  getRequiredEnvVars(): string[] {
    return ['REPLICATE_API_TOKEN'];
  }

  getCapabilities() {
    return {
      supportsGenerate: true,
      supportsEdit: false, // Most Replicate models don't support direct editing
      maxWidth: 2048,
      maxHeight: 2048,
      supportedModels: [
        'black-forest-labs/flux-schnell',
        'black-forest-labs/flux-dev',
        'stability-ai/sdxl',
        'lucataco/sdxl-lightning-4step'
      ]
    };
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const apiToken = this.getApiToken();
    if (!apiToken) {
      throw new ProviderError('Replicate API token not configured', this.name);
    }

    // Default to flux-schnell for fast generation
    const model = input.model || 'black-forest-labs/flux-schnell';
    const width = input.width || 1024;
    const height = input.height || 1024;

    logger.info(`Replicate generating image`, { model, width, height, prompt: input.prompt.slice(0, 50) });

    try {
      // Create prediction
      const prediction = await this.createPrediction(model, {
        prompt: input.prompt,
        width,
        height,
        num_outputs: 1,
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(input.guidance !== undefined && { guidance_scale: input.guidance }),
        ...(input.steps !== undefined && { num_inference_steps: input.steps })
      }, apiToken);

      // Poll for completion
      const result = await this.pollPrediction(prediction.id, apiToken);

      if (result.status === 'failed') {
        throw new ProviderError(`Replicate model failed: ${result.error}`, this.name, false);
      }

      // Download and convert images
      const images = await Promise.all(
        result.output.map(async (url: string) => {
          const dataUrl = await this.downloadImage(url);
          return {
            dataUrl,
            format: 'png' as const
          };
        })
      );

      return {
        images,
        provider: this.name,
        model
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = message.includes('timeout') || message.includes('ECONNREFUSED');
      throw new ProviderError(`Replicate request failed: ${message}`, this.name, isRetryable, error);
    }
  }

  async edit(_input: EditInput): Promise<ProviderResult> {
    throw new ProviderError(
      'Replicate provider does not support direct image editing. Please use generate with an img2img model instead.',
      this.name,
      false
    );
  }

  /**
   * Create a new prediction
   */
  private async createPrediction(model: string, input: any, apiToken: string): Promise<any> {
    const controller = this.createTimeout();

    const { statusCode, body } = await request('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: await this.getModelVersion(model, apiToken),
        input
      }),
      signal: controller.signal
    });

    const response = await body.json() as any;

    if (statusCode !== 201) {
      const message = response.detail || `Replicate API error: ${statusCode}`;
      const isRetryable = statusCode >= 500 || statusCode === 429;
      throw new ProviderError(message, this.name, isRetryable, response);
    }

    return response;
  }

  /**
   * Poll prediction status until complete
   */
  private async pollPrediction(id: string, apiToken: string, maxAttempts = 60): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const controller = this.createTimeout(10000);

      const { statusCode, body } = await request(`https://api.replicate.com/v1/predictions/${id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        },
        signal: controller.signal
      });

      const response = await body.json() as any;

      if (statusCode !== 200) {
        throw new ProviderError(`Failed to get prediction status: ${statusCode}`, this.name, true);
      }

      if (response.status === 'succeeded' || response.status === 'failed') {
        return response;
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new ProviderError('Prediction timed out after 60 seconds', this.name, true);
  }

  /**
   * Get the latest version ID for a model
   */
  private async getModelVersion(model: string, apiToken: string): Promise<string> {
    // Hardcoded versions for common models to avoid extra API calls
    // Updated 2025-09-29 via fetch-replicate-versions.js
    const knownVersions: Record<string, string> = {
      'black-forest-labs/flux-schnell': 'c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e',
      'black-forest-labs/flux-dev': '6e4a938f85952bdabcc15aa329178c4d681c52bf25a0342403287dc26944661d',
      'stability-ai/sdxl': '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
      'lucataco/sdxl-lightning-4step': '6f7a773af6fc3e8de9d5a3c00be77c17308914bf67772726aff83496ba1e3bbe'
    };

    if (knownVersions[model]) {
      return knownVersions[model];
    }

    // For unknown models, try to get the latest version
    const controller = this.createTimeout();
    const [owner, name] = model.split('/');

    const { statusCode, body } = await request(`https://api.replicate.com/v1/models/${owner}/${name}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      },
      signal: controller.signal
    });

    if (statusCode !== 200) {
      throw new ProviderError(`Failed to get model info for ${model}`, this.name, false);
    }

    const response = await body.json() as any;
    return response.latest_version?.id || response.default_version?.id;
  }

  /**
   * Download image from URL and convert to data URL
   */
  private async downloadImage(url: string): Promise<string> {
    const controller = this.createTimeout(30000);

    const { statusCode, body } = await request(url, {
      method: 'GET',
      signal: controller.signal
    });

    if (statusCode !== 200) {
      throw new ProviderError(`Failed to download image: ${statusCode}`, this.name, true);
    }

    const buffer = await body.arrayBuffer();
    return this.bufferToDataUrl(Buffer.from(buffer), 'image/png');
  }
}