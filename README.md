# Image Gen MCP Server

A Model Context Protocol (MCP) server for multi-provider AI image generation with intelligent provider selection. Supports 9 providers including OpenAI DALL-E, Stability AI, Leonardo.AI, Fal.ai, Ideogram, Flux/BFL, Clipdrop, Google Gemini, and Replicate.

## Features

- **9 Image Providers**: OpenAI, Stability, Leonardo, Fal, Ideogram, BFL/Flux, Clipdrop, Gemini, Replicate
- **Intelligent Selection**: Automatic provider selection based on use case (text, photorealistic, speed, etc.)
- **Character Consistency**: Leonardo.AI for consistent characters across multiple images (carousels)
- **Ultra-Fast Generation**: Fal.ai delivers images in 50-300ms
- **Post-Processing**: Clipdrop for background removal, upscaling, and editing
- **Automatic Fallback**: Smart fallback chain when providers fail or aren't configured
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
# Core providers
OPENAI_API_KEY=sk-...
STABILITY_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
GEMINI_API_KEY=AIza...

# New cutting-edge providers
IDEOGRAM_API_KEY=...
BFL_API_KEY=...
LEONARDO_API_KEY=...
FAL_API_KEY=...
CLIPDROP_API_KEY=...

# Configuration
DEFAULT_PROVIDER=auto  # Enable intelligent selection
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
  "provider": "auto",     // Or specify: OPENAI, LEONARDO, FAL, etc.
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

### Automatic Provider Selection

Let the system choose the best provider for your use case:
```javascript
{
  "prompt": "Create a logo with the text 'TechStartup 2025'",
  "provider": "auto"  // Will select Ideogram for text rendering
}
```

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

### Ideogram

Best-in-class text rendering for logos and posters:
```javascript
{
  "prompt": "A vintage poster with the text 'SUMMER FESTIVAL 2025' in bold retro typography",
  "provider": "IDEOGRAM",
  "model": "V_2_TURBO"
}
```

### Leonardo.AI

Character consistency for carousels and series:
```javascript
{
  "prompt": "A friendly robot mascot waving hello, consistent character design",
  "provider": "LEONARDO",
  "model": "leonardo-diffusion-xl"
}
```

### Fal.ai

Ultra-fast generation for rapid iteration:
```javascript
{
  "prompt": "Quick sketch of a product mockup",
  "provider": "FAL",
  "model": "fast-sdxl"  // 50-100ms generation!
}
```

### BFL/Flux

Industry-leading photorealistic quality:
```javascript
{
  "prompt": "Professional headshot of a business executive in modern office",
  "provider": "BFL",
  "model": "flux-pro"
}
```

### Clipdrop

Advanced editing and post-processing:
```javascript
{
  "prompt": "Remove background",
  "baseImage": "data:image/png;base64,...",
  "provider": "CLIPDROP"
}
```

## Provider Capabilities

| Provider | Generate | Edit | Max Size | Special Features | Speed |
|----------|----------|------|----------|------------------|-------|
| Mock | ✅ | ✅ | 256×256 | Testing only | Instant |
| OpenAI | ✅ | ✅ | 1792×1792 | Creative, reliable | 5-10s |
| Stability | ✅ | ✅ | 1536×1536 | Flexible, customizable | 3-8s |
| Replicate | ✅ | ❌ | 2048×2048 | Latest models | 5-30s |
| Gemini | ✅ | ✅ | 3072×3072 | Natural language | 8-12s |
| **Ideogram** | ✅ | ❌ | 1280×1280 | **Best text rendering** | 5-10s |
| **Leonardo** | ✅ | ❌ | 1024×1024 | **Character consistency** | 10-20s |
| **Fal** | ✅ | ❌ | 1536×1536 | **Ultra-fast (50-300ms)** | <1s |
| **BFL/Flux** | ✅ | ✅ | 2048×2048 | **Photorealistic** | 8-15s |
| **Clipdrop** | ✅ | ✅ | 2048×2048 | **Background removal** | 2-5s |

Note: Gemini images include SynthID watermark. Leonardo excels at consistent characters across multiple images.

## Fallback Chain

When a provider fails or isn't configured, the system automatically falls back:

```
IDEOGRAM → BFL → LEONARDO → FAL → OPENAI → STABILITY → REPLICATE → GEMINI → MOCK
```

Or use `provider: "auto"` for intelligent selection based on your prompt content.

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
│   ├── services/
│   │   └── providerSelector.ts  # Intelligent provider selection
│   ├── util/
│   │   └── logger.ts      # Logging utility
│   └── providers/
│       ├── base.ts        # Abstract provider class
│       ├── mock.ts        # Mock provider
│       ├── openai.ts      # OpenAI DALL-E
│       ├── stability.ts   # Stability AI
│       ├── replicate.ts   # Replicate
│       ├── gemini.ts      # Google Gemini
│       ├── ideogram.ts    # Ideogram (text rendering)
│       ├── leonardo.ts    # Leonardo.AI (consistency)
│       ├── fal.ts         # Fal.ai (ultra-fast)
│       ├── bfl.ts         # Black Forest Labs Flux
│       └── clipdrop.ts    # Clipdrop (post-processing)
```

## Architecture Notes

- **Stdio Transport**: Required by MCP spec for desktop integration
- **Intelligent Selection**: Analyzes prompts to automatically choose optimal provider
- **Use Case Mapping**: Recognizes logos, photorealistic, carousels, infographics, etc.
- **Data URLs**: Images returned as base64 for direct preview (warning for >5MB)
- **Circuit Breaker**: Smart error categorization for fallback decisions
- **Provider Pattern**: Pluggable adapters with abstract base class
- **Character Consistency**: Leonardo.AI maintains consistent characters across images
- **Ultra-Fast Mode**: Fal.ai delivers in 50-300ms for rapid iteration
- **Minimal Dependencies**: Only essential packages for lean deployment

## Use Case Examples

### Social Media Carousels
```javascript
// Generate consistent character across multiple slides
const mascot1 = await generate({
  prompt: "Friendly robot mascot introducing a product",
  provider: "LEONARDO"
});
const mascot2 = await generate({
  prompt: "Same friendly robot mascot explaining features",
  provider: "LEONARDO"
});
```

### Marketing Materials
```javascript
// Logo with text
await generate({
  prompt: "Modern tech startup logo with text 'InnovateCo'",
  provider: "IDEOGRAM"
});

// Product shots
await generate({
  prompt: "Professional product photography of smartphone",
  provider: "BFL"
});
```

### Rapid Prototyping
```javascript
// Ultra-fast iteration
await generate({
  prompt: "Quick wireframe sketch of mobile app",
  provider: "FAL"  // Returns in 50-300ms!
});
```

### Post-Processing Pipeline
```javascript
// Generate then edit
const image = await generate({
  prompt: "Product on white background",
  provider: "auto"
});

const transparent = await edit({
  prompt: "Remove background",
  baseImage: image.dataUrl,
  provider: "CLIPDROP"
});
```

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