# Image Gen MCP Server - Technical Reference

## Project Overview
MCP (Model Context Protocol) server providing unified image generation across 9 AI providers with intelligent selection, fallback chains, and enterprise-grade security.

## Architecture

### Core Design Principles
1. **Provider Abstraction**: All providers inherit from `ImageProvider` base class
2. **Fail-Safe Operation**: Automatic fallback chain when providers fail
3. **Security First**: Input validation, rate limiting, resource cleanup
4. **Performance Optimized**: Caching, connection pooling, O(n) algorithms
5. **Type Safety**: Full TypeScript with Zod runtime validation

### Directory Structure
```
src/
├── index.ts                 # MCP server entry, tool registration
├── config.ts               # Provider management, lazy initialization
├── types.ts                # TypeScript types & Zod schemas
├── providers/
│   ├── base.ts            # Abstract base class with security/performance
│   ├── mock.ts            # Testing provider (no API needed)
│   ├── openai.ts          # DALL-E integration
│   ├── stability.ts       # Stable Diffusion
│   ├── leonardo.ts        # Character consistency
│   ├── ideogram.ts        # Text rendering specialist
│   ├── bfl.ts            # Black Forest Labs (Flux)
│   ├── fal.ts            # Ultra-fast generation
│   ├── clipdrop.ts       # Post-processing
│   ├── replicate.ts      # Open model access
│   └── gemini.ts         # Google multimodal
├── services/
│   └── providerSelector.ts # O(n) intelligent selection
├── types/
│   └── api-responses.ts   # Provider API response types
└── util/
    └── logger.ts          # Structured logging
```

## Provider Implementation Guide

### Adding a New Provider

1. **Create Provider Class** (`src/providers/newprovider.ts`):
```typescript
import { ImageProvider } from './base.js';

export class NewProvider extends ImageProvider {
  readonly name = 'NEWPROVIDER';
  private apiKey: string | undefined;

  constructor() {
    super();
    this.apiKey = process.env.NEWPROVIDER_API_KEY;
  }

  isConfigured(): boolean {
    return this.validateApiKey(this.apiKey);
  }

  getRequiredEnvVars(): string[] {
    return ['NEWPROVIDER_API_KEY'];
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // 1. Validate inputs
    this.validatePrompt(input.prompt);

    // 2. Check rate limit
    await this.checkRateLimit();

    // 3. Check cache
    const cacheKey = this.generateCacheKey(input);
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    // 4. Execute with retry
    return this.executeWithRetry(async () => {
      const controller = this.createTimeout(30000);
      try {
        // API call here
        const result = { /* ... */ };
        this.cacheResult(cacheKey, result);
        return result;
      } finally {
        this.cleanupController(controller);
      }
    });
  }
}
```

2. **Register in Config** (`src/config.ts`):
```typescript
// Add to imports
const providers = {
  // ...existing
  NEWPROVIDER: () => new NewProvider()
};
```

3. **Add API Response Types** (`src/types/api-responses.ts`):
```typescript
export interface NewProviderResponse {
  // Define the API response structure
}
```

4. **Add Tests** (`tests/providers.test.ts`):
```typescript
describe('NewProvider', () => {
  // Test configuration, generation, error handling
});
```

5. **Update Provider Selector** if it has special capabilities

## Critical Security Patterns

### Always Validate Input
```typescript
// Buffer size check (10MB max)
if (buffer.length > MAX_IMAGE_SIZE) {
  throw new ProviderError('Image too large', this.name, false);
}

// API key validation
if (!this.validateApiKey(this.apiKey)) {
  throw new ProviderError('Invalid API key', this.name, false);
}

// Prompt validation
this.validatePrompt(input.prompt);
```

### Resource Management
```typescript
// Always use try/finally for cleanup
const controller = this.createTimeout(30000);
try {
  // Do work
} finally {
  this.cleanupController(controller);
}
```

### Error Categorization
```typescript
// Mark errors as retryable or permanent
throw new ProviderError(message, this.name, isRetryable);
```

## Performance Patterns

### Caching Strategy
- Cache key: JSON stringify of prompt + provider + dimensions
- TTL: 5 minutes
- Auto-cleanup when cache > 100 entries

### Rate Limiting
- 10 requests per minute per provider
- Tracked in memory with sliding window
- Returns 429-like error when exceeded

### Retry Logic
```typescript
// Exponential backoff with jitter
const delay = Math.min(INITIAL_DELAY * Math.pow(2, attempt), 10000);
await new Promise(r => setTimeout(r, delay + Math.random() * 500));
```

### Provider Selection Optimization
- Pre-built keyword index for O(n) complexity
- Cached provider instances (lazy initialization)
- Fallback chain: OPENAI → STABILITY → REPLICATE → GEMINI → MOCK

## Testing Strategy

### Test Environment
- Use `.env.test` for test configuration
- All API calls must be mocked (no real requests)
- Test keys start with "test-" prefix

### Mock Patterns
```typescript
// Mock fetch
global.fetch = vi.fn().mockResolvedValueOnce({
  ok: true,
  json: async () => mockResponse
});

// Mock undici
vi.mock('undici', () => ({
  request: vi.fn().mockResolvedValueOnce({
    statusCode: 200,
    body: { json: async () => mockResponse }
  })
}));
```

### Test Coverage Requirements
- Security features (buffer validation, API keys)
- Performance features (caching, rate limiting)
- Error handling (retries, fallbacks)
- Provider-specific features

## Common Patterns

### Async Polling (BFL, Leonardo, Fal)
```typescript
// Submit job
const { id } = await submitGeneration();

// Poll with exponential backoff
while (true) {
  const status = await checkStatus(id);
  if (status === 'COMPLETE') return result;
  if (status === 'FAILED') throw error;
  await sleep(delay);
  delay = Math.min(delay * 1.5, maxDelay);
}
```

### Image Download Pattern
```typescript
// Download from URL and convert to data URL
const response = await fetch(imageUrl);
const buffer = Buffer.from(await response.arrayBuffer());
return this.bufferToDataUrl(buffer, 'image/png');
```

### Provider-Specific Headers
```typescript
// Each provider has different auth patterns
headers: {
  'Authorization': `Bearer ${apiKey}`,      // OpenAI, Replicate
  'X-Api-Key': apiKey,                      // Stability
  'Api-Key': apiKey,                        // Ideogram
  'X-Key': apiKey,                          // BFL
  'api-key': apiKey                         // Leonardo
}
```

## Environment Variables

### Required for Each Provider
- `OPENAI_API_KEY`: sk-... format
- `STABILITY_API_KEY`: sk-... format
- `LEONARDO_API_KEY`: custom format
- `IDEOGRAM_API_KEY`: custom format
- `BFL_API_KEY`: custom format
- `FAL_API_KEY`: custom format
- `CLIPDROP_API_KEY`: custom format
- `REPLICATE_API_TOKEN`: r8_... format
- `GEMINI_API_KEY`: AIza... format

### Configuration Options
- `DEFAULT_PROVIDER`: Provider name or "auto" (default: "auto")
- `DISABLE_FALLBACK`: "true" to disable fallback chain
- `LOG_LEVEL`: "debug" | "info" | "warn" | "error"

## MCP Protocol Specifics

### Tool Registration
Tools are registered in `index.ts`:
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'image.generate',
      description: 'Generate images from text prompts',
      inputSchema: zodToJsonSchema(GenerateInputSchema)
    }
  ]
}));
```

### Stdio Transport
- Required for Claude Desktop integration
- No console.log/error allowed (breaks JSON-RPC)
- All logging through logger utility to stderr

### Response Format
- Images returned as data URLs (base64)
- Warning for images > 5MB
- Include provider and model in response

## Known Issues & Gotchas

1. **Undici vs Fetch**: Some providers use undici for better performance
2. **Test Environment**: Must set VITEST env var for test key validation
3. **Async Generation**: BFL, Leonardo, Fal require polling
4. **Rate Limits**: Each provider has different limits (not standardized)
5. **Image Formats**: Most providers return PNG, some JPEG
6. **Timeout Variance**: Gemini needs 60s, others 30s

## Debugging Tips

1. **Enable Debug Logging**: Set `LOG_LEVEL=debug`
2. **Test Single Provider**: Set `DEFAULT_PROVIDER` and `DISABLE_FALLBACK=true`
3. **Check Claude Logs**: `~/Library/Logs/Claude/` (macOS)
4. **Test Directly**: `npm run dev` then use the MCP inspector

## Performance Profiling

### Bottlenecks to Watch
- Provider selection: Now O(n) after optimization
- Image encoding: Base64 is memory intensive
- Polling intervals: Balance speed vs API limits
- Cache size: Monitor memory usage

### Optimization Opportunities
- Stream large images instead of base64
- Implement provider health checks
- Add request queuing for rate limits
- Consider Redis for distributed caching

## Future Enhancements

### Potential Features
- [ ] Batch generation support
- [ ] Image-to-image for all providers
- [ ] Webhook support for async generation
- [ ] Provider health monitoring dashboard
- [ ] Cost tracking and optimization
- [ ] Custom model fine-tuning support
- [ ] Distributed rate limiting
- [ ] S3/CDN integration for large images

### Architecture Improvements
- [ ] Event-driven architecture for async ops
- [ ] Provider plugin system
- [ ] GraphQL API alongside MCP
- [ ] Kubernetes deployment ready
- [ ] Prometheus metrics export

## Release Process

1. Run full test suite: `npm test`
2. Type check: `npm run typecheck`
3. Build: `npm run build`
4. Update version in package.json
5. Update README.md with changes
6. Tag release: `git tag v1.x.x`
7. Push: `git push --tags`

## Code Review Checklist

- [ ] Input validation implemented
- [ ] Rate limiting checked
- [ ] Caching utilized
- [ ] Retry logic with backoff
- [ ] Resource cleanup (AbortController)
- [ ] Error categorization (retryable)
- [ ] Tests written and passing
- [ ] Types properly defined
- [ ] No console.log statements
- [ ] Documentation updated