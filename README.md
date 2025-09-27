# Image Gen MCP Server

A Model Context Protocol (MCP) server for multi-provider image generation, supporting OpenAI DALL-E, Stability AI, Replicate, Google Gemini, and a Mock provider for testing.

## Features

- **Multiple Providers**: Seamlessly switch between OpenAI, Stability, Replicate, Gemini, or Mock providers
- **Automatic Fallback**: Intelligent fallback chain when providers fail or aren't configured
- **Type Safety**: Full TypeScript with Zod validation
- **MCP Compliant**: Works directly with Claude Desktop via stdio transport
- **Mock Provider**: Test immediately without API keys using gradient PNG generation
- **Smart Error Handling**: Distinguishes between retryable and permanent errors

## Quick Start

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your keys:
```env
OPENAI_API_KEY=sk-...
STABILITY_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
GEMINI_API_KEY=AIza...
DEFAULT_PROVIDER=OPENAI
```

### 3. Run Development Server

```bash
npm run dev
```

### 4. Add to Claude Desktop

Edit your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

#### Option 1: Using .env file (simple)

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/image-gen-mcp"
    }
  }
}
```

#### Option 2: Injecting API keys directly (recommended)

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/image-gen-mcp",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "STABILITY_API_KEY": "sk-...",
        "REPLICATE_API_TOKEN": "r8_...",
        "GEMINI_API_KEY": "AIza...",
        "DEFAULT_PROVIDER": "OPENAI",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### Option 3: Development with TypeScript
```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "/absolute/path/to/image-gen-mcp",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "GEMINI_API_KEY": "AIza..."
      }
    }
  }
}
```

**Security Note**: When using the `env` field, your API keys are stored in your Claude Desktop config. This is convenient but ensure the config file has appropriate permissions.

## Available Tools

### `health.ping`
Check server status - no configuration required.

```
Request: health.ping()
Response: "ok"
```

### `config.providers`
List all providers and their configuration status.

```
Response: [
  {
    "name": "OPENAI",
    "configured": true,
    "requiredEnvVars": ["OPENAI_API_KEY"],
    "capabilities": {
      "supportsGenerate": true,
      "supportsEdit": true,
      "supportedModels": ["dall-e-3", "dall-e-2"]
    }
  },
  ...
]
```

### `image.generate`
Generate images from text prompts.

```
Request: {
  "prompt": "A serene mountain landscape at sunset",
  "provider": "OPENAI",  // Optional
  "width": 1024,          // Optional
  "height": 1024,         // Optional
  "model": "dall-e-3",    // Optional
  "seed": 12345          // Optional
}

Response: {
  "images": [{
    "dataUrl": "data:image/png;base64,...",
    "format": "png"
  }],
  "provider": "OPENAI",
  "model": "dall-e-3"
}
```

### `image.edit`
Edit existing images with text prompts (OpenAI and Stability only).

```
Request: {
  "prompt": "Add a rainbow to the sky",
  "baseImage": "data:image/png;base64,...",
  "maskImage": "data:image/png;base64,...",  // Optional
  "provider": "OPENAI"                       // Optional
}
```

## Provider Examples

### Mock Provider (No API Key Required)

Perfect for testing:
```javascript
{
  "prompt": "test image",
  "provider": "MOCK"
}
```

### OpenAI DALL-E

Best for high-quality, creative images:
```javascript
{
  "prompt": "An oil painting of a robot reading a book",
  "provider": "OPENAI",
  "model": "dall-e-3",
  "width": 1792,
  "height": 1024
}
```

### Stability AI

Great for photorealistic and artistic styles:
```javascript
{
  "prompt": "A photorealistic portrait of a cyberpunk character",
  "provider": "STABILITY",
  "model": "stable-image-core-v1",
  "seed": 42
}
```

### Replicate

Access to cutting-edge models like Flux:
```javascript
{
  "prompt": "A futuristic cityscape with flying cars",
  "provider": "REPLICATE",
  "model": "black-forest-labs/flux-schnell",
  "guidance": 7.5,
  "steps": 4
}
```

### Google Gemini 2.5 Flash Image

Advanced image generation and editing with natural language:
```javascript
{
  "prompt": "A serene landscape with mountains reflected in a crystal-clear lake at sunset",
  "provider": "GEMINI",
  "model": "gemini-2.5-flash-image-preview"
}
```

For editing:
```javascript
{
  "prompt": "Remove the person in the background and add a rainbow",
  "baseImage": "data:image/png;base64,...",
  "provider": "GEMINI"
}
```

## Provider Capabilities

| Provider | Generate | Edit | Max Size | Models |
|----------|----------|------|----------|---------|
| Mock | ✅ | ✅ | 256×256 | mock-v1 |
| OpenAI | ✅ | ✅ | 1792×1792 | dall-e-3, dall-e-2 |
| Stability | ✅ | ✅ | 1536×1536 | SD3.5, SD-XL, Image Core |
| Replicate | ✅ | ❌ | 2048×2048 | Flux, SDXL variants |
| Gemini | ✅ | ✅ | 3072×3072 | Gemini 2.5 Flash Image |

Note: All Gemini images include a SynthID watermark. Requires Blaze pricing plan.

## Fallback Chain

When a provider fails or isn't configured, the system automatically falls back:

```
OPENAI → STABILITY → REPLICATE → GEMINI → MOCK
```

You can override this with the `DEFAULT_PROVIDER` environment variable.

To disable fallback completely and only use the specified provider, set `DISABLE_FALLBACK=true`. This ensures the system will fail if the requested provider is unavailable rather than falling back to another provider.

## Development

### Build
```bash
npm run build
```

### Type Check
```bash
npm run typecheck
```

### Project Structure
```
image-gen-mcp/
├── src/
│   ├── index.ts           # MCP server entry
│   ├── config.ts          # Provider management
│   ├── types.ts           # TypeScript types & Zod schemas
│   ├── util/
│   │   └── logger.ts      # Logging utility
│   └── providers/
│       ├── base.ts        # Abstract provider class
│       ├── mock.ts        # Mock provider
│       ├── openai.ts      # OpenAI DALL-E
│       ├── stability.ts   # Stability AI
│       ├── replicate.ts   # Replicate
│       └── gemini.ts      # Google Gemini
```

## Architecture Notes

- **Stdio Transport**: Required by MCP spec for Claude Desktop integration
- **Data URLs**: Images returned as base64 for direct Claude preview (warning for >5MB)
- **Circuit Breaker**: Intelligent error categorization for fallback decisions
- **Provider Pattern**: Pluggable adapters with abstract base class
- **Minimal Dependencies**: Only essential packages for lean deployment

## Troubleshooting

### "Provider not configured"
Add the required API key to your `.env` file.

### Large image warnings
Images over 5MB trigger warnings. For production, consider external storage (S3/CDN).

### Timeout errors
Default timeout is 30s (60s for Gemini). Slow providers may need adjustment.

### Mock provider returns small images
Mock is limited to 256×256 for testing. Use real providers for full resolution.

## License

MIT

## Next Steps

1. Copy `.env.example` to `.env`
2. Add at least one API key (or use MOCK provider)
3. Run `npm install && npm run dev`
4. Add to Claude Desktop config
5. Test with `health.ping` in Claude
6. Generate your first image!