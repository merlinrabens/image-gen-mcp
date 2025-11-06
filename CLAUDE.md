# Image Gen MCP Server - Technical Reference

## Project Overview
MCP (Model Context Protocol) server providing unified image generation across 9 AI providers with intelligent selection, fallback chains, and enterprise-grade security.

## Provider Strengths & Positioning

### OPENAI (DALL-E 3)
- **Best for**: Versatile general-purpose generation, creative interpretation
- **Strengths**: Exceptional prompt understanding, composition, safety filtering
- **Quality**: High, consistent across use cases
- **Speed**: Moderate (10-30s)
- **Position**: Primary fallback - most versatile and reliable

### STABILITY (Stable Diffusion XL)
- **Best for**: Photorealism, professional photography style, controlled generation
- **Strengths**: Fine parameter control (strength, cfg_scale), mature API, img-to-img
- **Quality**: High, especially for realistic images
- **Speed**: Fast-moderate (5-15s)
- **Position**: Secondary fallback - reliable workhorse

### BFL (Black Forest Labs / Flux)
- **Best for**: Ultra-high resolution, professional photography, product shots
- **Strengths**: State-of-the-art photorealism, fine detail, texture quality
- **Quality**: Exceptional for photorealistic work
- **Speed**: Moderate-slow (20-40s, polling-based)
- **Position**: High-quality photorealism specialist

### LEONARDO
- **Best for**: Artistic renders, fantasy art, cinematic compositions, game assets, professional illustrations
- **Strengths**: Excellent artistic quality across multiple styles, character consistency, creative interpretation
- **Quality**: Exceptional for artistic and cinematic work
- **Speed**: Moderate (15-30s, polling-based)
- **Position**: Underutilized gem - not just for character consistency!

### GEMINI
- **Best for**: Multi-image composition, complex context understanding
- **Strengths**: Unique multimodal capability (multiple image inputs), Google infrastructure reliability
- **Quality**: Good general quality
- **Speed**: Fast-moderate (5-20s)
- **Position**: Unique for multi-image workflows

### IDEOGRAM
- **Best for**: Text rendering, logos, posters, typography, marketing materials
- **Strengths**: Industry-leading text-in-image quality, clean outputs
- **Quality**: Excellent for text-heavy work
- **Speed**: Fast (5-10s)
- **Position**: Text rendering specialist

### FAL
- **Best for**: Rapid iterations, drafts, real-time generation
- **Strengths**: Blazing fast (50-300ms), good quality for speed
- **Quality**: Good for rapid work
- **Speed**: Ultra-fast (sub-second to few seconds)
- **Position**: Speed specialist

### REPLICATE
- **Best for**: Specific open models, experimentation, cost-sensitive use cases
- **Strengths**: Access to many open-source models, community-driven
- **Quality**: Variable (depends on model selection)
- **Speed**: Variable (depends on model)
- **Position**: Fallback for open model access

### CLIPDROP
- **Best for**: Post-processing only (background removal, enhancement, upscaling)
- **Strengths**: Specialized editing operations
- **Quality**: Excellent for post-processing
- **Speed**: Fast for specialized operations
- **Position**: NOT in generation fallback - editing operations only

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
│   ├── mock.ts            # Testing provider (dev/test only)
│   ├── openai.ts          # DALL-E - versatile general-purpose
│   ├── stability.ts       # Stable Diffusion - photorealism
│   ├── leonardo.ts        # Artistic, cinematic, fantasy specialist
│   ├── ideogram.ts        # Text rendering specialist
│   ├── bfl.ts            # Black Forest Labs - ultra-high quality
│   ├── fal.ts            # Ultra-fast generation
│   ├── clipdrop.ts       # Post-processing only
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
- Fallback chain: OPENAI → STABILITY → BFL → LEONARDO → GEMINI → IDEOGRAM → FAL → REPLICATE
  - Prioritizes versatility (OPENAI), reliability (STABILITY), quality (BFL), artistic excellence (LEONARDO)
  - CLIPDROP excluded from generation fallback (post-processing only)
  - MOCK provider excluded from production (dev/test only or ALLOW_MOCK_PROVIDER=true)

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

### Image Input Handling
```typescript
// New: getImageBuffer() supports multiple input formats
const imageData = await this.getImageBuffer(input.baseImage);

// Supports:
// 1. Data URLs: 'data:image/png;base64,...'
// 2. File paths: '/path/to/image.png'
// 3. File URLs: 'file:///path/to/image.png'

// Automatic MIME type detection from file extension
// Built-in size validation (10MB max)
// Returns: { buffer: Buffer, mimeType: string }
```

### Dimension Detection and Preservation
```typescript
// Detect image dimensions from any input format
const dimensions = await this.detectImageDimensions(input.baseImage);
// Returns: { width: number, height: number }

// In edit operations, automatically preserve aspect ratio:
let width = input.width;
let height = input.height;
if (!width || !height) {
  const dimensions = await this.detectImageDimensions(input.baseImage);
  width = width || dimensions.width;
  height = height || dimensions.height;
}

// EditInput schema now supports optional width/height parameters
// Defaults to input image dimensions if not specified
// BFL and STABILITY providers use dimensions for aspect ratio control
// GEMINI currently only supports 1:1 (square) aspect ratio
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
- `ALLOW_MOCK_PROVIDER`: "true" to allow MOCK in production (not recommended)
- `NODE_ENV`: Set to "development" or "test" to auto-enable MOCK provider
- `LOG_LEVEL`: "debug" | "info" | "warn" | "error"

**Important**: If no real providers are configured and MOCK is not allowed, the server will throw a clear error instead of silently falling back to MOCK. This prevents accidental use of mock images in production.

## MCP Protocol Specifics

### Tool Registration
Tools are registered in `index.ts` following MCP best practices:
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'image_generate',  // Snake_case per MCP standard
      description: '...',      // Comprehensive description with examples
      inputSchema: zodToJsonSchema(GenerateInputSchema),
      annotations: {          // Tool behavior hints for LLMs
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ]
}));
```

### Tool Naming Convention
Following MCP best practices for Node/TypeScript:
- Format: `{service}_{action}_{resource}` in snake_case
- Tools: `image_health_ping`, `image_config_providers`, `image_generate`, `image_edit`
- Prevents naming conflicts with other MCP servers

### Stdio Transport
- Required for Claude Desktop integration
- No console.log/error allowed (breaks JSON-RPC)
- All logging through logger utility to stderr

### Response Format Options
Tools support dual response formats via `response_format` parameter:

**JSON Format** (default):
- Structured, machine-readable data
- File paths to saved images
- Provider and model metadata
- Warnings array

**Markdown Format**:
- Human-readable formatted text
- Headers and bullet points
- File size in KB
- Ideal for LLM consumption

**Character Limit**: Responses are truncated at 25,000 characters per MCP best practices

**Example Response**:
- Images saved to disk (not base64 in response)
- File paths returned instead of large data URLs
- Automatic cleanup of old files (>1 hour)

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

## Git Commit and PR Rules (CRITICAL)
- NEVER push directly to main branch - always create a feature branch and PR
- NEVER add "Co-Authored-By: Claude" or any co-author attribution in commits
- NEVER mention "Generated with Claude Code" or similar in commit messages
- NEVER add Claude attribution, robot emojis (🤖), or AI-generated mentions in PR descriptions
- NEVER reference Claude, AI assistance, or automated generation in any git-related text
- Write commit messages and PR descriptions as if written directly by the developer
- Always use feature branches: `git checkout -b feat/feature-name` or `fix/bug-name`
- Always create PRs for review before merging to main