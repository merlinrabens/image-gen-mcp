import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImageProvider } from '../src/providers/base.js';
import { BFLProvider } from '../src/providers/bfl.js';
import { LeonardoProvider } from '../src/providers/leonardo.js';
import { FalProvider } from '../src/providers/fal.js';
import { IdeogramProvider } from '../src/providers/ideogram.js';
import { ClipdropProvider } from '../src/providers/clipdrop.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { StabilityProvider } from '../src/providers/stability.js';
import { ReplicateProvider } from '../src/providers/replicate.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { ProviderError } from '../src/types.js';

// Mock fetch globally
global.fetch = vi.fn();

// Mock undici request
vi.mock('undici', () => ({
  request: vi.fn()
}));

describe('Provider Base Class', () => {
  let provider: ImageProvider;

  beforeEach(() => {
    // Create a test provider instance
    class TestProvider extends ImageProvider {
      name = 'TEST';
      isConfigured() { return true; }
      getRequiredEnvVars() { return []; }
    }
    provider = new TestProvider();
  });

  describe('Security Features', () => {
    it('should validate buffer size in dataUrlToBuffer', () => {
      // Create a fake large buffer (simulate > 10MB)
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
      const dataUrl = `data:image/png;base64,${largeBuffer.toString('base64')}`;

      expect(() => provider.dataUrlToBuffer(dataUrl)).toThrow(ProviderError);
    });

    it('should validate API key properly', () => {
      expect(provider.validateApiKey(undefined)).toBe(false);
      expect(provider.validateApiKey('')).toBe(false);
      expect(provider.validateApiKey('short')).toBe(false);
      expect(provider.validateApiKey('your-api-key-here')).toBe(false);
      expect(provider.validateApiKey('placeholder')).toBe(false);
      expect(provider.validateApiKey('valid-api-key-12345')).toBe(true);
    });

    it('should validate prompt input', () => {
      expect(() => provider.validatePrompt('')).toThrow(ProviderError);
      expect(() => provider.validatePrompt('   ')).toThrow(ProviderError);

      const longPrompt = 'a'.repeat(5000);
      expect(() => provider.validatePrompt(longPrompt)).toThrow(ProviderError);

      expect(() => provider.validatePrompt('valid prompt')).not.toThrow();
    });
  });

  describe('Performance Features', () => {
    it('should implement rate limiting', async () => {
      // First 10 requests should succeed
      for (let i = 0; i < 10; i++) {
        await expect(provider.checkRateLimit()).resolves.not.toThrow();
      }

      // 11th request should be rate limited
      await expect(provider.checkRateLimit()).rejects.toThrow(ProviderError);
    });

    it('should cache results properly', () => {
      const cacheKey = 'test-key';
      const result = {
        provider: 'TEST',
        images: [{ dataUrl: 'data:image/png;base64,test', format: 'png' as const }]
      };

      // Should not have cached result initially
      expect(provider.getCachedResult(cacheKey)).toBeNull();

      // Cache the result
      provider.cacheResult(cacheKey, result);

      // Should retrieve cached result
      expect(provider.getCachedResult(cacheKey)).toEqual(result);
    });

    it('should implement exponential backoff in retry logic', async () => {
      let attempts = 0;
      const failingFn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new ProviderError('Temporary error', 'TEST', true);
        }
        return 'success';
      });

      const result = await provider.executeWithRetry(failingFn, 3);

      expect(result).toBe('success');
      expect(failingFn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const failingFn = vi.fn().mockImplementation(async () => {
        throw new ProviderError('Permanent error', 'TEST', false);
      });

      await expect(provider.executeWithRetry(failingFn, 3)).rejects.toThrow('Permanent error');
      expect(failingFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resource Management', () => {
    it('should create timeout with AbortController', () => {
      const controller = provider.createTimeout(1000);

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);

      // Cleanup should exist
      expect((controller as any).cleanup).toBeDefined();
    });

    it('should cleanup AbortController', () => {
      const controller = provider.createTimeout(1000);
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      provider.cleanupController(controller);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});

describe('BFL Provider', () => {
  let provider: BFLProvider;

  beforeEach(() => {
    process.env.BFL_API_KEY = 'test-bfl-key-123456789';
    provider = new BFLProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.BFL_API_KEY;
  });

  it('should validate configuration', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.BFL_API_KEY;
    const provider2 = new BFLProvider();
    expect(provider2.isConfigured()).toBe(false);
  });

  it('should handle generation with proper validation', async () => {
    // Re-create provider to pick up env vars
    provider = new BFLProvider();
    const mockResponse = {
      sample: 'base64-image-data',
      status: 'Ready'
    };

    // Mock the undici request function
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        json: async () => mockResponse
      }
    });

    const result = await provider.generate({
      prompt: 'test image',
      width: 1024,
      height: 1024
    });

    expect(result.provider).toBe('BFL');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].dataUrl).toContain('base64');

    // Verify the request was called with correct parameters
    const undiciModule = await import('undici');
    expect(undiciModule.request).toHaveBeenCalledWith(
      expect.stringContaining('api.bfl.ml'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Key': 'test-bfl-key-123456789'
        })
      })
    );
  });

  it('should handle API errors properly', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Server error' } })
    });

    await expect(provider.generate({ prompt: 'test' }))
      .rejects.toThrow(ProviderError);
  });

  it('should poll for async results with exponential backoff', async () => {
    // Re-create provider to pick up env vars
    provider = new BFLProvider();
    const mockQueueResponse = { id: 'task-123' };
    const mockStatusResponse = {
      status: 'Ready',
      sample: 'base64-image-data'
    };

    // Mock the undici request function
    const undici = await import('undici');
    (undici.request as any)
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => mockQueueResponse
        }
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => ({ status: 'Pending' })
        }
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => mockStatusResponse
        }
      });

    const result = await provider.generate({ prompt: 'test' });

    expect(result.images).toHaveLength(1);

    const undiciModule2 = await import('undici');
    expect(undiciModule2.request).toHaveBeenCalledTimes(3); // Initial + 1 poll + final
  });
});

describe('Leonardo Provider', () => {
  let provider: LeonardoProvider;

  beforeEach(() => {
    process.env.LEONARDO_API_KEY = 'test-leonardo-key-123456789';
    provider = new LeonardoProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.LEONARDO_API_KEY;
  });

  it('should support character consistency', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsCharacterConsistency).toBe(true);
  });

  it('should map prompt to preset style', async () => {
    // Re-create provider to pick up env vars
    provider = new LeonardoProvider();
    const mockResponse = {
      sdGenerationJob: { generationId: 'gen-123' }
    };

    const mockStatusResponse = {
      generations_by_pk: {
        status: 'COMPLETE',
        generated_images: [{ url: 'https://example.com/image.png' }]
      }
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('image-data')
      } as any);

    const result = await provider.generate({
      prompt: 'anime character portrait'
    });

    // Check that the request included anime preset
    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.presetStyle).toBe('ANIME');
  });
});

describe('Fal Provider', () => {
  let provider: FalProvider;

  beforeEach(() => {
    process.env.FAL_API_KEY = 'test-fal-key-123456789';
    provider = new FalProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.FAL_API_KEY;
  });

  it('should be optimized for speed', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.availableModels).toContain('fast-sdxl');
    expect(capabilities.availableModels).toContain('fast-lightning-sdxl');
  });

  it('should handle immediate results for fast models', async () => {
    // Re-create provider to pick up env vars
    provider = new FalProvider();
    const mockResponse = {
      images: ['https://example.com/image.png']
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('image-data')
      } as any);

    const result = await provider.generate({
      prompt: 'quick test image',
      model: 'fast-sdxl'
    });

    expect(result.images).toHaveLength(1);
    expect((global.fetch as any)).toHaveBeenCalledTimes(2); // Initial request + download
  });

  it('should use shorter delays for fast models', async () => {
    // Re-create provider to pick up env vars
    provider = new FalProvider();
    const mockQueueResponse = { request_id: 'req-123' };
    const mockStatusResponse = {
      status: 'COMPLETED',
      images: ['https://example.com/image.png']
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockQueueResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'PENDING' })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatusResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('image-data')
      } as any);

    const startTime = Date.now();
    await provider.generate({
      prompt: 'test',
      model: 'fast-sdxl'
    });
    const endTime = Date.now();

    // Fast models should use shorter polling intervals
    expect(endTime - startTime).toBeLessThan(3000);
  });
});

describe('Ideogram Provider', () => {
  let provider: IdeogramProvider;

  beforeEach(() => {
    process.env.IDEOGRAM_API_KEY = 'test-ideogram-key-123456789';
    provider = new IdeogramProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.IDEOGRAM_API_KEY;
  });

  it('should excel at text rendering', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.specialFeatures).toContain('text_rendering');
  });

  it('should detect text-heavy requests', async () => {
    // Re-create provider to pick up env vars
    provider = new IdeogramProvider();
    const mockResponse = {
      data: [{
        base64: 'base64-image-data'
      }]
    };

    // Mock undici request for Ideogram
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        json: async () => mockResponse
      }
    });

    const result = await provider.generate({
      prompt: 'logo for tech startup with text'
    });

    expect(result.warnings).toContain('Optimized for text rendering');
  });
});

describe('Clipdrop Provider', () => {
  let provider: ClipdropProvider;

  beforeEach(() => {
    process.env.CLIPDROP_API_KEY = 'test-clipdrop-key-123456789';
    provider = new ClipdropProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CLIPDROP_API_KEY;
  });

  it('should support unique post-processing features', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsBackgroundRemoval).toBe(true);
    expect(capabilities.supportsObjectRemoval).toBe(true);
    expect(capabilities.supportsSketchToImage).toBe(true);
  });

  it('should determine edit type from prompt', async () => {
    // Re-create provider to pick up env vars
    provider = new ClipdropProvider();
    const mockImage = Buffer.from('image-data');

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockImage,
      headers: {
        get: (key: string) => key === 'content-type' ? 'image/png' : null
      }
    } as any);

    const result = await provider.edit({
      prompt: 'remove background',
      baseImage: 'data:image/png;base64,dGVzdA==',
      provider: 'CLIPDROP'
    });

    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain('/remove-background/v1');
    expect(result.warnings).toContain('Background removed - image has transparency');
  });
});

describe('OpenAI Provider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-openai-key-123456789';
    provider = new OpenAIProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('should be configured with valid API key', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.OPENAI_API_KEY;
    const provider2 = new OpenAIProvider();
    expect(provider2.isConfigured()).toBe(false);
  });

  it('should handle generation with DALL-E 3', async () => {
    provider = new OpenAIProvider();
    const mockResponse = {
      data: [{ url: 'https://example.com/image.png' }]
    };

    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        json: async () => mockResponse
      }
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from('image-data')
    } as any);

    const result = await provider.generate({
      prompt: 'test image',
      model: 'dall-e-3'
    });

    expect(result.provider).toBe('OPENAI');
    expect(result.model).toBe('dall-e-3');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].dataUrl).toContain('base64');
  });

  it('should handle API errors properly', async () => {
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 400,
      body: {
        json: async () => ({ error: { message: 'Invalid request' } })
      }
    });

    await expect(provider.generate({ prompt: 'test' })).rejects.toThrow();
  });
});

describe('Stability Provider', () => {
  let provider: StabilityProvider;

  beforeEach(() => {
    process.env.STABILITY_API_KEY = 'sk-test-stability-key-123456789';
    provider = new StabilityProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.STABILITY_API_KEY;
  });

  it('should be configured with valid API key', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.STABILITY_API_KEY;
    const provider2 = new StabilityProvider();
    expect(provider2.isConfigured()).toBe(false);
  });

  it('should handle generation with proper validation', async () => {
    provider = new StabilityProvider();
    const mockImage = Buffer.from('fake-png-data');

    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        arrayBuffer: async () => mockImage.buffer
      }
    });

    const result = await provider.generate({
      prompt: 'test image',
      width: 1024,
      height: 1024
    });

    expect(result.provider).toBe('STABILITY');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].dataUrl).toContain('base64');

    const undiciModule = await import('undici');
    expect(undiciModule.request).toHaveBeenCalledWith(
      expect.stringContaining('api.stability.ai'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-test-stability-key-123456789'
        })
      })
    );
  });

  it('should handle API errors properly', async () => {
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 400,
      body: {
        json: async () => ({ message: 'Invalid parameters' })
      }
    });

    await expect(provider.generate({ prompt: 'test' })).rejects.toThrow();
  });
});

describe('Replicate Provider', () => {
  let provider: ReplicateProvider;

  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'r8_test-replicate-key-123456789';
    provider = new ReplicateProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.REPLICATE_API_TOKEN;
  });

  it('should be configured with valid API key', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.REPLICATE_API_TOKEN;
    const provider2 = new ReplicateProvider();
    expect(provider2.isConfigured()).toBe(false);
  });

  it.skip('should handle async generation with polling', async () => {
    provider = new ReplicateProvider();
    const mockCreateResponse = {
      id: 'pred-123',
      status: 'processing'
    };

    const mockCompleteResponse = {
      id: 'pred-123',
      status: 'succeeded',
      output: ['https://example.com/image.png']
    };

    // Mock the undici request function - matches BFL pattern
    const undici = await import('undici');
    (undici.request as any)
      .mockResolvedValueOnce({
        statusCode: 201,
        body: {
          json: async () => mockCreateResponse
        }
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: async () => mockCompleteResponse
        }
      });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from('image-data')
    } as any);

    const result = await provider.generate({
      prompt: 'test image'
    });

    expect(result.provider).toBe('REPLICATE');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].dataUrl).toContain('base64');

    const undiciModule2 = await import('undici');
    expect(undiciModule2.request).toHaveBeenCalledWith(
      expect.stringContaining('api.replicate.com'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer r8_test-replicate-key-123456789'
        })
      })
    );
  });

  it('should handle API errors properly', async () => {
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 400,
      body: {
        json: async () => ({ detail: 'Invalid input' })
      }
    });

    await expect(provider.generate({ prompt: 'test' })).rejects.toThrow();
  });
});

describe('Gemini Provider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'AIza-test-gemini-key-123456789';
    provider = new GeminiProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('should be configured with valid API key', () => {
    expect(provider.isConfigured()).toBe(true);

    delete process.env.GEMINI_API_KEY;
    const provider2 = new GeminiProvider();
    expect(provider2.isConfigured()).toBe(false);
  });

  it('should handle generation with proper validation', async () => {
    provider = new GeminiProvider();
    const mockResponse = {
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/png',
              data: Buffer.from('image-data').toString('base64')
            }
          }]
        }
      }]
    };

    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 200,
      body: {
        json: async () => mockResponse
      }
    });

    const result = await provider.generate({
      prompt: 'test image',
      width: 1024,
      height: 1024
    });

    expect(result.provider).toBe('GEMINI');
    expect(result.model).toBe('gemini-2.5-flash-image-preview');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].dataUrl).toContain('base64');

    const undiciModule = await import('undici');
    expect(undiciModule.request).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('should handle API errors properly', async () => {
    const undici = await import('undici');
    (undici.request as any).mockResolvedValueOnce({
      statusCode: 400,
      body: {
        json: async () => ({ error: { message: 'Invalid prompt' } })
      }
    });

    await expect(provider.generate({ prompt: 'test' })).rejects.toThrow();
  });
});