# Image Gen MCP Server

A production-ready Model Context Protocol (MCP) server for multi-provider image generation with intelligent provider selection, enterprise-grade security, and comprehensive testing.

## Features

### 🎨 **9 Leading AI Image Providers**
- **OpenAI DALL-E 3** - Versatile, high-quality generation
- **Stability AI** - Stable Diffusion XL with fine control
- **Leonardo.AI** - Character consistency for carousels
- **Ideogram** - Exceptional text rendering for logos/posters
- **Black Forest Labs (Flux)** - Ultra-high resolution photorealism
- **Fal.ai** - Ultra-fast generation (50-300ms)
- **Clipdrop** - Advanced post-processing and background removal
- **Google Gemini** - Multimodal understanding
- **Replicate** - Access to diverse open models

### 🧠 **Intelligent Provider Selection**
- **Use-case detection**: Automatically selects best provider based on prompt analysis
- **Automatic fallback**: Smart fallback chain when providers fail
- **Performance optimization**: O(n) complexity keyword matching
- **Context-aware**: Detects logos, text-heavy, photorealistic, carousel needs

### 🔒 **Enterprise Security**
- **Input validation**: Buffer size limits (10MB max)
- **API key validation**: Detects placeholders and invalid keys
- **Prompt sanitization**: Length limits and content validation
- **Rate limiting**: Prevents API throttling (10 req/min)
- **Resource cleanup**: Proper AbortController management

### ⚡ **Performance & Reliability**
- **Response caching**: 5-minute TTL cache
- **Exponential backoff**: Smart retry logic
- **Connection pooling**: Efficient resource usage
- **Timeout management**: Configurable per-provider timeouts
- **Error recovery**: Distinguishes retryable vs permanent errors

### ✅ **Quality Assurance**
- **100% test coverage**: 49 comprehensive tests
- **Type safety**: Full TypeScript with strict typing
- **No `any` types**: Proper type definitions throughout
- **Zod validation**: Runtime schema validation
- **Mock testing**: No real API calls needed for tests

## Quick Start

### Installation

The easiest way to use this MCP server is via NPM:

```bash
npx @merlinrabens/image-gen-mcp
```

Or install globally:

```bash
npm install -g @merlinrabens/image-gen-mcp
```

### Configuration

Add the MCP server to your MCP client configuration. The exact location depends on which client you're using.

#### MCP Client Configuration Files

**Claude Desktop**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Claude Code**:
- macOS/Linux: `~/.claude.json`
- Windows: `%USERPROFILE%\.claude.json`

**Cursor** and other MCP clients: Check your client's documentation for the config file location.

#### Recommended Setup (NPM Package)

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "npx",
      "args": ["-y", "@merlinrabens/image-gen-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "STABILITY_API_KEY": "sk-...",
        "REPLICATE_API_TOKEN": "r8_...",
        "GEMINI_API_KEY": "AIza...",
        "LEONARDO_API_KEY": "...",
        "IDEOGRAM_API_KEY": "...",
        "BFL_API_KEY": "...",
        "FAL_API_KEY": "...",
        "CLIPDROP_API_KEY": "...",
        "DEFAULT_PROVIDER": "auto",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Environment Variables**:
- Add at least one provider API key (or use `MOCK` provider for testing)
- `DEFAULT_PROVIDER`: Set to `"auto"` for intelligent selection or specify a provider name
- `LOG_LEVEL`: `"debug"` | `"info"` | `"warn"` | `"error"`
- `DISABLE_FALLBACK`: Set to `"true"` to prevent fallback to other providers
- `IMAGE_OUTPUT_DIR`: Where to save generated images (see [Image Storage](#image-storage) section)

### API Keys

Get your API keys from:
- **OpenAI**: https://platform.openai.com/api-keys
- **Stability AI**: https://platform.stability.ai/account/keys
- **Replicate**: https://replicate.com/account/api-tokens
- **Google Gemini**: https://aistudio.google.com/apikey
- **Leonardo**: https://app.leonardo.ai/settings
- **Ideogram**: https://ideogram.ai/api
- **Black Forest Labs**: https://api.bfl.ml/
- **Fal**: https://fal.ai/dashboard/keys
- **Clipdrop**: https://clipdrop.co/apis

### Testing

After configuration, restart your MCP client and test:

1. Check server status: "Check image-gen-mcp status with health.ping"
2. List configured providers: "List available image-gen-mcp providers"
3. Generate your first image: "Generate a serene mountain landscape"

## Development Setup

For contributors or local development:

### 1. Clone Repository

```bash
git clone https://github.com/merlinrabens/image-gen-mcp.git
cd image-gen-mcp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

### 4. Build & Run

```bash
npm run build
npm start
```

### 5. Local Development Config

For development with hot reload:

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/image-gen-mcp/src/index.ts"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "DEFAULT_PROVIDER": "auto"
      }
    }
  }
}
```

**Security Note**: API keys in the config file are stored in plain text. Ensure proper file permissions.

## Image Storage

By default, generated images are saved to `.image-gen-mcp/` in your current working directory. This keeps images organized with your project and persists them across system restarts.

### Storage Options

Configure where images are saved using the `IMAGE_OUTPUT_DIR` environment variable:

| Value | Description | Example |
|-------|-------------|---------|
| Not set | **Default**: `.image-gen-mcp/` in current working directory | `./image-gen-mcp/` |
| `"cwd"` | Explicitly use `.image-gen-mcp/` in current directory | `./image-gen-mcp/` |
| `"temp"` | Use system temp directory (old behavior) | `/tmp/` or `%TEMP%` |
| `/absolute/path` | Save to specific directory | `/Users/me/images/` |

### Configuration Example

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "npx",
      "args": ["-y", "@merlinrabens/image-gen-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        // Optional: Change image storage location
        "IMAGE_OUTPUT_DIR": "temp"  // or "/custom/path" or leave unset for default
      }
    }
  }
}
```

### .gitignore

If using the default `.image-gen-mcp/` directory, add it to your `.gitignore`:

```gitignore
# MCP generated images
.image-gen-mcp/
```

### Automatic Cleanup

Old images (>1 hour) are automatically cleaned up to prevent disk space issues. The cleanup runs every 30 minutes.

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
Edit existing images with text prompts. Supports multiple providers including OpenAI, Stability, Ideogram, BFL, Gemini, and Clipdrop.

The `baseImage` and `maskImage` fields support:
- **Data URLs**: `data:image/png;base64,...`
- **File paths**: `/path/to/image.png`
- **File URLs**: `file:///path/to/image.png`

```
Request: {
  "prompt": "Add a rainbow to the sky",
  "baseImage": "/path/to/image.png",         // Can be file path or data URL
  "maskImage": "/path/to/mask.png",          // Optional (file path or data URL)
  "provider": "OPENAI"                       // Optional (auto-selects if not specified)
}
```

## Provider Examples

### Image Editing with File Paths

Edit generated images directly using file paths:
```javascript
// After generating an image saved to disk
{
  "prompt": "Add a sunset background",
  "baseImage": "/path/to/generated-image.png",  // Direct file path
  "provider": "OPENAI"
}

// Or using a data URL (still supported)
{
  "prompt": "Make it more colorful",
  "baseImage": "data:image/png;base64,iVBORw0...",
  "provider": "STABILITY"
}

// With a mask for selective editing
{
  "prompt": "Replace the background with mountains",
  "baseImage": "/path/to/image.png",
  "maskImage": "/path/to/mask.png",  // Both support file paths
  "provider": "BFL"
}
```

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

| Provider | Generate | Edit | Max Size | Models | Special Features |
|----------|----------|------|----------|---------|-----------------|
| Mock | ✅ | ✅ | 256×256 | mock-v1 | Testing only |
| OpenAI | ✅ | ✅ | 1792×1792 | dall-e-3, dall-e-2 | High quality, creative |
| Stability | ✅ | ✅ | 1536×1536 | SD3.5, SD-XL, Image Core | Photorealistic, artistic |
| Leonardo | ✅ | ❌ | 1536×1536 | Leonardo models | Character consistency |
| Ideogram | ✅ | ✅ | 2048×2048 | V_2, V_2_TURBO | Exceptional text rendering |
| BFL/Flux | ✅ | ❌ | 2048×2048 | Flux Pro, Dev, Schnell | Ultra-high resolution |
| Fal | ✅ | ❌ | 1920×1440 | Fast SDXL variants | Ultra-fast (50-300ms) |
| Clipdrop | ✅ | ✅ | 2048×2048 | Various | Background/object removal |
| Replicate | ✅ | ❌ | 2048×2048 | Flux, SDXL variants | Open model access |
| Gemini | ✅ | ✅ | 3072×3072 | Gemini 2.5 Flash Image | Multimodal understanding |

Note: All Gemini images include a SynthID watermark. Requires Blaze pricing plan.

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

### Run Tests
```bash
npm test
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

- **Stdio Transport**: Uses MCP stdio protocol for maximum client compatibility
- **Intelligent Selection**: Analyzes prompts to automatically choose optimal provider
- **Data URLs**: Images returned as base64 data URLs for direct preview (warning for >5MB)
- **Circuit Breaker**: Intelligent error categorization for fallback decisions
- **Provider Pattern**: Pluggable adapters with abstract base class
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

1. Get API keys from your preferred providers (see [API Keys](#api-keys) section)
2. Add the MCP server to your MCP client config (see [Configuration](#configuration) section)
3. Add your API keys to the `env` field in the config
4. Restart your MCP client (Claude Desktop, Claude Code, Cursor, etc.)
5. Test the server: "Check image-gen-mcp status with health.ping"
6. Generate your first image: "Generate a serene mountain landscape"

For local development or contributions, see the [Development Setup](#development-setup) section.