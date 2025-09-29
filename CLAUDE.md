# Claude Desktop Integration Guide

This guide provides comprehensive instructions for integrating the Image Gen MCP server with Claude Desktop.

## Quick Start

### 1. Prerequisites

- Node.js 18+ installed
- Claude Desktop application
- At least one API key from supported providers

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/merlinrabens/image-gen-mcp.git
cd image-gen-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### 3. Configure Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

#### Option 1: Direct API Key Configuration (Recommended)

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

#### Option 2: Using .env File

First, create a `.env` file in the project root:

```bash
cp .env.example .env
# Edit .env with your API keys
```

Then configure Claude Desktop:

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

#### Option 3: Development Mode with TypeScript

```json
{
  "mcpServers": {
    "image-gen-mcp": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "/absolute/path/to/image-gen-mcp",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "DEFAULT_PROVIDER": "auto"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

After updating the configuration, restart Claude Desktop for changes to take effect.

### 5. Verify Connection

In Claude, type:
```
Use the health.ping tool to check if the image generation server is working
```

## Available Commands in Claude

### Check Server Health
```
Check if the image generation server is running
```

### List Available Providers
```
Show me which image generation providers are configured
```

### Generate an Image
```
Generate an image of a serene mountain landscape at sunset
```

### Generate with Specific Provider
```
Use DALL-E to create an oil painting of a robot reading a book
```

### Generate Text-Heavy Images
```
Use Ideogram to create a logo for a tech startup called "NeuralNexus"
```

### Fast Generation
```
Use Fal to quickly generate a concept art sketch
```

### Edit an Image
```
[Attach an image]
Remove the background from this image
```

## Provider Selection Guide

The server automatically selects the best provider based on your prompt:

| Use Case | Auto-Selected Provider | Keywords Detected |
|----------|----------------------|-------------------|
| Logos & Text | Ideogram | logo, text, typography, poster |
| Character Series | Leonardo | character, consistent, series |
| Fast Generation | Fal | quick, fast, rapid, draft |
| Photorealistic | BFL/Flux | photorealistic, ultra-realistic, 8k |
| Background Removal | Clipdrop | remove background, transparent |
| Creative Art | OpenAI | oil painting, artistic, creative |
| General Purpose | Stability | (default fallback) |

## Advanced Usage

### Specify Model
```
Generate an image using dall-e-3 model: a futuristic city
```

### Control Dimensions
```
Create a 1792x1024 panoramic image of a beach sunset
```

### Use Seed for Reproducibility
```
Generate an image with seed 12345: abstract geometric patterns
```

### Fallback Chain
When a provider fails, the system automatically falls back:
```
OPENAI → STABILITY → REPLICATE → GEMINI → MOCK
```

To disable fallback:
```json
"env": {
  "DISABLE_FALLBACK": "true"
}
```

## Security Features

The server includes comprehensive security measures:

- **Buffer Size Validation**: 10MB maximum image size
- **API Key Validation**: Detects and rejects placeholder keys
- **Prompt Sanitization**: 4000 character limit
- **Rate Limiting**: 10 requests per minute per provider
- **Resource Cleanup**: Proper memory management

## Performance Optimizations

- **Response Caching**: 5-minute cache for identical requests
- **Exponential Backoff**: Smart retry logic for failures
- **Connection Pooling**: Efficient resource usage
- **O(n) Provider Selection**: Optimized keyword matching

## Troubleshooting

### "Provider not configured"
- Ensure the required API key is set in your configuration
- Check that the key is not a placeholder value
- Verify the key starts with the correct prefix (e.g., `sk-` for OpenAI)

### "Rate limit exceeded"
- Wait 60 seconds before making more requests
- The server enforces 10 requests per minute per provider

### "Image size exceeds maximum"
- Images larger than 10MB are rejected for security
- Consider using external storage for large images

### Connection Issues
1. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs\`

2. Test the server directly:
   ```bash
   npm run dev
   ```

3. Verify the configuration path is absolute, not relative

### Large Image Warnings
- Images over 5MB trigger warnings
- Consider using URLs instead of base64 for large images

## Testing

The project includes comprehensive tests:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- providers.test.ts
```

All 49 tests should pass, covering:
- Security features
- Performance optimizations
- Provider functionality
- Error handling
- Resource management

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key | No | - |
| `STABILITY_API_KEY` | Stability AI key | No | - |
| `LEONARDO_API_KEY` | Leonardo.ai key | No | - |
| `IDEOGRAM_API_KEY` | Ideogram key | No | - |
| `BFL_API_KEY` | Black Forest Labs key | No | - |
| `FAL_API_KEY` | Fal.ai key | No | - |
| `CLIPDROP_API_KEY` | Clipdrop key | No | - |
| `REPLICATE_API_TOKEN` | Replicate token | No | - |
| `GEMINI_API_KEY` | Google Gemini key | No | - |
| `DEFAULT_PROVIDER` | Default provider | No | `auto` |
| `DISABLE_FALLBACK` | Disable fallback chain | No | `false` |
| `LOG_LEVEL` | Logging level | No | `info` |

## Provider Capabilities

| Provider | Best For | Speed | Max Resolution | Unique Features |
|----------|----------|-------|----------------|-----------------|
| **OpenAI** | Creative, versatile | Medium | 1792×1792 | DALL-E 3 quality |
| **Stability** | Photorealistic | Medium | 1536×1536 | Fine control |
| **Leonardo** | Character series | Medium | 1536×1536 | Consistency |
| **Ideogram** | Text & logos | Medium | 2048×2048 | Perfect text |
| **BFL/Flux** | Ultra-realistic | Slow | 2048×2048 | Highest quality |
| **Fal** | Quick drafts | Ultra-fast | 1920×1440 | 50-300ms |
| **Clipdrop** | Editing | Fast | 2048×2048 | Background removal |
| **Replicate** | Open models | Variable | 2048×2048 | Model variety |
| **Gemini** | Multimodal | Medium | 3072×3072 | Understanding |

## Examples

### Logo Design
```
Create a minimalist logo for an AI startup using Ideogram
```

### Character Consistency
```
Generate a consistent character in 3 different poses using Leonardo
```

### Quick Concept Art
```
Quickly sketch a sci-fi spaceship design using Fal
```

### Background Removal
```
[Attach image]
Remove the background and make it transparent using Clipdrop
```

### Photorealistic
```
Create an ultra-realistic 8K photo of a mountain lake using Flux
```

## Contributing

When contributing, ensure:
1. All tests pass: `npm test`
2. Types are correct: `npm run typecheck`
3. Code is built: `npm run build`

## Support

For issues or questions:
- GitHub Issues: https://github.com/merlinrabens/image-gen-mcp/issues
- Documentation: See README.md for technical details

## License

MIT