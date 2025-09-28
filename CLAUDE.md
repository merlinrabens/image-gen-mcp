# MCP Image Generation Server - Development Guide

This document provides context for AI assistants working on this MCP server for image generation.

## Project Overview

This is a Model Context Protocol (MCP) server that provides multi-provider image generation capabilities. It acts as a unified interface for various AI image generation services.

## Architecture

### Provider Pattern
The system uses an abstract provider pattern where each image generation service implements the `ImageProvider` base class:

```typescript
abstract class ImageProvider {
  abstract readonly name: string;
  abstract isConfigured(): boolean;
  abstract getRequiredEnvVars(): string[];
  async generate(input: GenerateInput): Promise<ProviderResult>
  async edit(input: EditInput): Promise<ProviderResult>
  getCapabilities(): ProviderCapabilities
}
```

### Intelligent Provider Selection
The system includes smart provider selection (`src/services/providerSelector.ts`) that analyzes prompts to automatically choose the best provider based on use case:

- **Text/Logos** → Ideogram (exceptional text rendering)
- **Photorealistic** → BFL/Flux (industry-leading quality)
- **Character Consistency** → Leonardo (crucial for carousels)
- **Ultra-fast** → Fal (50-300ms generation)
- **Post-processing** → Clipdrop (background removal, upscaling)

### Provider Capabilities

| Provider | Key Strengths | Response Time | Special Features |
|----------|--------------|---------------|------------------|
| **Ideogram** | Text rendering, logos, posters | 5-10s | Style presets, magic prompt |
| **BFL/Flux** | Photorealistic, professional | 8-15s | Multiple quality tiers |
| **Leonardo** | Character consistency | 10-20s | Custom training, ControlNet |
| **Fal** | Speed, iteration | 50-300ms | Serverless, cost-effective |
| **Clipdrop** | Editing, post-processing | 2-5s | Background removal, upscaling |
| **OpenAI** | Versatile, creative | 5-10s | DALL-E 3, reliable |
| **Stability** | Flexible, customizable | 3-8s | Multiple models, inpainting |
| **Gemini** | Multimodal understanding | 8-12s | Natural language editing |
| **Replicate** | Variety, cutting-edge | 5-30s | Access to latest models |

## Development Guidelines

### Adding New Providers

1. Create a new file in `src/providers/[provider-name].ts`
2. Extend the `ImageProvider` base class
3. Implement required methods:
   - `isConfigured()`: Check if API keys are set
   - `getRequiredEnvVars()`: Return required environment variables
   - `generate()`: Implement image generation
   - `edit()`: Implement image editing (optional)
   - `getCapabilities()`: Return provider capabilities

4. Register in `src/config.ts`:
   - Add to `ProviderName` type in `src/types.ts`
   - Add case in `createProvider()` method
   - Update provider arrays in Config class

5. Update provider selector in `src/services/providerSelector.ts`:
   - Add to use case mappings if provider has special strengths
   - Update fallback chains

### Error Handling

The system distinguishes between retryable and permanent errors:

```typescript
throw new ProviderError(
  message: string,
  provider: string,
  isRetryable: boolean  // true for network/temporary errors
);
```

Retryable errors trigger automatic fallback to the next provider in the chain.

### MCP Protocol Specifics

- **Transport**: Uses stdio for communication with MCP clients
- **Handshake**: Critical that stdin/stdout handlers are set AFTER `server.connect()`
- **Response Format**: Images returned as base64 data URLs for direct preview
- **Large Files**: System saves images >5MB to temp directory to avoid protocol issues

### Testing

#### Local Testing
```bash
# Run with mock provider (no API keys needed)
npm run dev

# Test specific provider
OPENAI_API_KEY=sk-... npm run dev

# Test with all providers
cp .env.example .env  # Add all API keys
npm run dev
```

#### Integration Testing
The Mock provider generates deterministic gradient PNGs for testing without API calls:
```typescript
{
  "prompt": "test image",
  "provider": "MOCK",
  "seed": 12345  // Same seed = same image
}
```

### Performance Optimization

1. **Provider Selection**: Use `provider: "auto"` to let the system choose
2. **Fast Iteration**: Use Fal provider for rapid prototyping
3. **Batch Processing**: Leonardo for consistent character series
4. **Post-processing Pipeline**: Generate with any provider, edit with Clipdrop

### Common Tasks

#### Running Tests
```bash
npm test
```

#### Type Checking
```bash
npm run typecheck
```

#### Building for Production
```bash
npm run build
```

#### Checking Provider Status
Use the `config.providers` tool to see which providers are configured:
```javascript
// In MCP client
await tools.use('config.providers');
```

## Code Style

- TypeScript with strict mode
- Zod for runtime validation
- Abstract classes for extensibility
- Async/await for all provider operations
- Comprehensive error messages with context

## Environment Variables

Required for each provider:
- `OPENAI_API_KEY`: OpenAI DALL-E access
- `STABILITY_API_KEY`: Stability AI access
- `REPLICATE_API_TOKEN`: Replicate access
- `GEMINI_API_KEY`: Google Gemini access
- `IDEOGRAM_API_KEY`: Ideogram access
- `BFL_API_KEY`: Black Forest Labs (Flux) access
- `LEONARDO_API_KEY`: Leonardo.AI access
- `FAL_API_KEY`: Fal.ai access
- `CLIPDROP_API_KEY`: Clipdrop access

Configuration options:
- `DEFAULT_PROVIDER`: Override fallback chain
- `DISABLE_FALLBACK`: Prevent automatic fallback
- `LOG_LEVEL`: Set to 'debug' for verbose output

## Debugging

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

Check temp file creation:
```bash
ls -la /tmp/mcp-image-*
```

Monitor MCP communication:
```bash
# Log file location
tail -f /tmp/image-gen-mcp.log
```

## Known Issues

1. **Gemini aspectRatio**: Currently ignores aspect ratio parameter (API bug)
2. **Large Images**: Base64 encoding can exceed MCP message limits
3. **Provider Timeouts**: Some providers (Replicate) can be slow with complex models

## Future Enhancements

- [ ] Streaming support for real-time generation progress
- [ ] Image-to-image translation across providers
- [ ] Batch generation for multiple images
- [ ] Provider cost tracking and optimization
- [ ] Caching layer for repeated prompts
- [ ] WebSocket transport option for persistent connections

## Contributing

When contributing:
1. Maintain backward compatibility
2. Add tests for new providers
3. Update this documentation
4. Follow existing code patterns
5. Test with multiple MCP clients