#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import * as os from 'os';

import { Config } from './config.js';
import { GenerateInputSchema, EditInputSchema, ProviderError, ResponseFormat } from './types.js';
import { logger } from './util/logger.js';

// Character limit for responses (MCP best practice)
const CHARACTER_LIMIT = 25000;

/**
 * Truncate text with informative message if it exceeds character limit
 */
function truncateIfNeeded(text: string, context: string): string {
  if (text.length <= CHARACTER_LIMIT) {
    return text;
  }

  const truncated = text.slice(0, CHARACTER_LIMIT);
  const truncationMessage = `\n\n[Response truncated at ${CHARACTER_LIMIT} characters]\n` +
    `Original length: ${text.length} characters\n` +
    `${context}`;

  return truncated + truncationMessage;
}

/**
 * Format image generation result as markdown
 */
function formatGenerateResultMarkdown(data: {
  images: Array<{ path: string; format: string; size: number }>;
  provider: string;
  model?: string;
  warnings?: string[];
  note?: string;
}): string {
  const lines: string[] = ['# Image Generation Result', ''];

  lines.push(`**Provider**: ${data.provider}`);
  if (data.model) {
    lines.push(`**Model**: ${data.model}`);
  }
  lines.push('');

  lines.push(`## Generated Images (${data.images.length})`);
  lines.push('');

  data.images.forEach((img, idx) => {
    lines.push(`### Image ${idx + 1}`);
    lines.push(`- **Path**: \`${img.path}\``);
    lines.push(`- **Format**: ${img.format}`);
    lines.push(`- **Size**: ${(img.size / 1024).toFixed(2)} KB`);
    lines.push('');
  });

  if (data.warnings && data.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    data.warnings.forEach(warning => {
      lines.push(`- ${warning}`);
    });
    lines.push('');
  }

  if (data.note) {
    lines.push(`**Note**: ${data.note}`);
  }

  return lines.join('\n');
}

/**
 * Format image edit result as markdown
 */
function formatEditResultMarkdown(data: {
  images: Array<{ path: string; format: string; size: number }>;
  provider: string;
  model?: string;
  warnings?: string[];
  note?: string;
}): string {
  const lines: string[] = ['# Image Edit Result', ''];

  lines.push(`**Provider**: ${data.provider}`);
  if (data.model) {
    lines.push(`**Model**: ${data.model}`);
  }
  lines.push('');

  lines.push(`## Edited Images (${data.images.length})`);
  lines.push('');

  data.images.forEach((img, idx) => {
    lines.push(`### Image ${idx + 1}`);
    lines.push(`- **Path**: \`${img.path}\``);
    lines.push(`- **Format**: ${img.format}`);
    lines.push(`- **Size**: ${(img.size / 1024).toFixed(2)} KB`);
    lines.push('');
  });

  if (data.warnings && data.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    data.warnings.forEach(warning => {
      lines.push(`- ${warning}`);
    });
    lines.push('');
  }

  if (data.note) {
    lines.push(`**Note**: ${data.note}`);
  }

  return lines.join('\n');
}

// Cleanup temp files older than 1 hour
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
// Make temp files unique per process to avoid collisions
const SESSION_ID = process.env.MCP_SESSION_ID || randomUUID();
const TEMP_FILE_PREFIX = `mcp-image-${process.pid}-${SESSION_ID.slice(0, 8)}-`;

// Debug logging
const DEBUG_FILE = '/tmp/image-gen-mcp.log';
async function debugLog(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] PID=${process.pid} ${msg}\n`;
  await fs.appendFile(DEBUG_FILE, line).catch(() => {});
}

/**
 * Determine the output directory for generated images
 * Default: .image-gen-mcp in current working directory
 */
async function getOutputDirectory(): Promise<string> {
  const configuredDir = process.env.IMAGE_OUTPUT_DIR;

  if (!configuredDir || configuredDir === 'cwd') {
    // DEFAULT: Use .image-gen-mcp in current working directory
    const dir = path.join(process.cwd(), '.image-gen-mcp');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  } else if (configuredDir === 'temp') {
    // Explicitly use temp directory (backward compatibility)
    return os.tmpdir();
  } else {
    // Use absolute path provided
    await fs.mkdir(configuredDir, { recursive: true });
    return configuredDir;
  }
}

// DO NOT touch stdin/stdout before handshake!

/**
 * Convert Zod schema to JSON Schema for MCP
 */
function zodToJsonSchema(schema: z.ZodType): any {
  // Simplified conversion - in production you'd use a library like zod-to-json-schema
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: any = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      properties[key] = getFieldSchema(zodField);

      // Check if required
      if (!(zodField instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  return { type: 'object' };
}

function getFieldSchema(field: z.ZodType): any {
  if (field instanceof z.ZodOptional) {
    return getFieldSchema(field._def.innerType);
  }

  if (field instanceof z.ZodString) {
    const schema: any = { type: 'string' };
    if (field.description) {
      schema.description = field.description;
    }
    return schema;
  }

  if (field instanceof z.ZodNumber) {
    const schema: any = { type: 'number' };
    if (field.description) {
      schema.description = field.description;
    }
    return schema;
  }

  return { type: 'string' };
}

async function cleanupOldTempFiles(): Promise<void> {
  try {
    // Get the current output directory
    const outputDir = await getOutputDirectory().catch(() => null);

    // Clean up files in both possible locations
    const dirsToClean = Array.from(new Set([
      os.tmpdir(),  // Always check temp dir for backward compatibility
      outputDir    // Check configured output directory
    ].filter(dir => dir !== null))); // Remove nulls and duplicates

    const now = Date.now();

    for (const dir of dirsToClean) {
      try {
        const files = await fs.readdir(dir);

        for (const file of files) {
          if (file.startsWith(TEMP_FILE_PREFIX)) {
            const filepath = path.join(dir, file);
            try {
              const stats = await fs.stat(filepath);
              const age = now - stats.mtimeMs;
              if (age > TEMP_FILE_MAX_AGE_MS) {
                await fs.unlink(filepath);
                logger.debug(`Cleaned up old file: ${file} from ${dir}`);
              }
            } catch (error) {
              // File might already be deleted, ignore
            }
          }
        }
      } catch (error) {
        // Directory might not exist yet, ignore
      }
    }
  } catch (error) {
    logger.warn('Failed to cleanup old files', error);
  }
}

function startTempFileCleanup(): void {
  // Run cleanup immediately on start
  cleanupOldTempFiles();

  // Then run every 30 minutes (unref to not keep process alive)
  const interval = setInterval(() => {
    cleanupOldTempFiles();
  }, 30 * 60 * 1000);
  interval.unref();
}

// Create server directly like playwright-proxy
const server = new Server(
  {
    name: 'image-gen-mcp-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'image_health_ping',
        description: 'Check if the image generation server is running and responsive.\n\n' +
          'This is a simple health check tool that verifies the MCP server is operational. ' +
          'It performs no external API calls and always succeeds if the server is running.\n\n' +
          'Args: None\n\n' +
          'Returns:\n' +
          '  Simple "ok" status message\n\n' +
          'Examples:\n' +
          '  - Use when: Testing MCP server connectivity\n' +
          '  - Use when: Verifying server is responsive before making requests\n\n' +
          'Error Handling:\n' +
          '  This tool does not fail under normal circumstances',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        annotations: {
          title: 'Health Check',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      {
        name: 'image_config_providers',
        description: 'List all available image generation providers and their configuration status.\n\n' +
          'This tool returns detailed information about each provider (OpenAI, Stability, Leonardo, etc.), ' +
          'including whether they are properly configured with API keys, what capabilities they support ' +
          '(generation, editing, max dimensions), and which environment variables are required.\n\n' +
          'Args: None\n\n' +
          'Returns:\n' +
          '  JSON array with schema:\n' +
          '  [\n' +
          '    {\n' +
          '      "name": string,              // Provider name (e.g., "OPENAI")\n' +
          '      "configured": boolean,       // Whether provider has valid API key\n' +
          '      "requiredEnvVars": string[], // Environment variables needed\n' +
          '      "capabilities": {\n' +
          '        "supportsGenerate": boolean,\n' +
          '        "supportsEdit": boolean,\n' +
          '        "maxWidth": number,        // Maximum image width\n' +
          '        "maxHeight": number,       // Maximum image height\n' +
          '        "supportedModels": string[]\n' +
          '      }\n' +
          '    }\n' +
          '  ]\n\n' +
          'Examples:\n' +
          '  - Use when: Checking which providers are available for use\n' +
          '  - Use when: Diagnosing why a specific provider is not working\n' +
          '  - Use when: Seeing provider capabilities before making a request\n' +
          '  - Don\'t use when: You need to actually generate or edit images\n\n' +
          'Error Handling:\n' +
          '  This tool does not fail - it reports current configuration state',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        annotations: {
          title: 'List Provider Configuration',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      {
        name: 'image_generate',
        description: 'Generate images from text prompts using AI image generation providers.\n\n' +
          'This tool creates new images from textual descriptions using various AI providers ' +
          '(OpenAI DALL-E, Stability AI, Leonardo, Ideogram, BFL Flux, Fal, Gemini, Replicate, Clipdrop). ' +
          'It automatically selects the best provider based on your prompt content when provider="auto", ' +
          'or you can specify a provider explicitly. The tool handles provider fallback if the primary ' +
          'provider fails.\n\n' +
          'Args:\n' +
          '  - prompt (string, required): Text description of image to generate\n' +
          '      Examples: "A serene mountain landscape at sunset", \n' +
          '                "Professional headshot of business executive", \n' +
          '                "Logo with text \'TechCo 2025\'"\n' +
          '  - provider (string, optional): Provider name or "auto" (default)\n' +
          '      Options: OPENAI, STABILITY, LEONARDO, IDEOGRAM, BFL, FAL, GEMINI, REPLICATE, CLIPDROP\n' +
          '  - width (number, optional): Image width in pixels (64-4096)\n' +
          '  - height (number, optional): Image height in pixels (64-4096)\n' +
          '  - model (string, optional): Specific model name for the provider\n' +
          '  - seed (number, optional): Random seed for reproducible results\n' +
          '  - guidance (number, optional): Guidance scale 0-30 (not supported by all providers)\n' +
          '  - steps (number, optional): Inference steps 1-150 (not supported by all providers)\n' +
          '  - response_format (string, optional): "json" (default) or "markdown"\n\n' +
          'Returns:\n' +
          '  For JSON format (default):\n' +
          '  {\n' +
          '    "images": [{\n' +
          '      "path": string,      // File path where image is saved\n' +
          '      "format": string,    // Image format (png, jpg, webp)\n' +
          '      "size": number       // File size in bytes\n' +
          '    }],\n' +
          '    "provider": string,    // Provider used (e.g., "OPENAI")\n' +
          '    "model": string,       // Model used\n' +
          '    "warnings": string[],  // Optional warnings (fallback, large file, etc.)\n' +
          '    "note": string         // Info about where images are saved\n' +
          '  }\n\n' +
          '  For Markdown format:\n' +
          '  Human-readable summary with provider, model, image locations, and any warnings\n\n' +
          'Examples:\n' +
          '  - Use when: Creating marketing images, product mockups, social media content\n' +
          '  - Use when: Generating logos, posters, or artwork\n' +
          '  - Use when: Creating visual assets for presentations or websites\n' +
          '  - Don\'t use when: Editing existing images (use image_edit instead)\n' +
          '  - Don\'t use when: You need to modify or enhance a specific image\n\n' +
          'Provider Selection Tips:\n' +
          '  - IDEOGRAM: Best for text rendering, logos, posters\n' +
          '  - BFL: Best for ultra-high quality photorealism\n' +
          '  - LEONARDO: Best for artistic style, character consistency\n' +
          '  - OPENAI: Best for versatile, creative generation\n' +
          '  - FAL: Best for ultra-fast generation (drafts, iterations)\n' +
          '  - STABILITY: Best for photorealistic images\n\n' +
          'Error Handling:\n' +
          '  - "No providers configured": Set at least one provider API key in environment\n' +
          '      Solution: Configure OPENAI_API_KEY, STABILITY_API_KEY, or other provider keys\n' +
          '  - "No providers support dimensions": Reduce image size or specify different provider\n' +
          '      Solution: Use smaller width/height or check provider capabilities with image_config_providers\n' +
          '  - "Provider X failed": Automatic fallback to next provider (unless DISABLE_FALLBACK=true)\n' +
          '      Solution: Check provider API key is valid or use different provider\n' +
          '  - "Rate limit exceeded": Wait before making more requests\n' +
          '      Solution: Built-in rate limiting (10 req/min), wait and retry',
        inputSchema: zodToJsonSchema(GenerateInputSchema),
        annotations: {
          title: 'Generate Image from Prompt',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true
        }
      },
      {
        name: 'image_edit',
        description: 'Edit existing images with text prompts using AI image editing providers.\n\n' +
          'This tool modifies existing images based on textual descriptions using AI providers ' +
          '(OpenAI, Stability AI, BFL, Gemini, Clipdrop). It supports operations like adding elements, ' +
          'removing backgrounds, changing colors, and general image transformations. The tool can work ' +
          'with or without mask images depending on the provider and edit type.\n\n' +
          'Args:\n' +
          '  - prompt (string, required): Text description of the edit operation\n' +
          '      Examples: "Add a rainbow to the sky", \n' +
          '                "Remove the background", \n' +
          '                "Change shirt color to blue"\n' +
          '  - baseImage (string, required): Image to edit\n' +
          '      Formats: data:image/png;base64,... OR /path/to/image.png OR file:///path/to/image.png\n' +
          '  - maskImage (string, optional): Mask indicating edit regions (white=edit, black=preserve)\n' +
          '      Formats: Same as baseImage. Not required for all providers/operations\n' +
          '  - provider (string, optional): Provider name or "auto" (default)\n' +
          '      Edit-capable providers: OPENAI, STABILITY, BFL, GEMINI, CLIPDROP\n' +
          '  - width (number, optional): Output width (defaults to input image dimensions)\n' +
          '  - height (number, optional): Output height (defaults to input image dimensions)\n' +
          '  - model (string, optional): Specific model name\n' +
          '  - response_format (string, optional): "json" (default) or "markdown"\n\n' +
          'Returns:\n' +
          '  For JSON format (default):\n' +
          '  {\n' +
          '    "images": [{\n' +
          '      "path": string,      // File path where edited image is saved\n' +
          '      "format": string,    // Image format (png, jpg, webp)\n' +
          '      "size": number       // File size in bytes\n' +
          '    }],\n' +
          '    "provider": string,    // Provider used\n' +
          '    "model": string,       // Model used\n' +
          '    "warnings": string[]   // Optional warnings\n' +
          '  }\n\n' +
          '  For Markdown format:\n' +
          '  Human-readable summary with provider, model, image locations, and any warnings\n\n' +
          'Examples:\n' +
          '  - Use when: Modifying existing generated images\n' +
          '  - Use when: Removing or adding elements to images\n' +
          '  - Use when: Changing colors, styles, or attributes\n' +
          '  - Use when: Background removal or replacement\n' +
          '  - Don\'t use when: Creating new images from scratch (use image_generate instead)\n' +
          '  - Don\'t use when: No base image is available\n\n' +
          'Provider Selection Tips:\n' +
          '  - CLIPDROP: Best for background removal, object removal\n' +
          '  - OPENAI: Best for versatile image editing with good understanding\n' +
          '  - STABILITY: Best for photorealistic edits and inpainting\n' +
          '  - GEMINI: Good for complex multi-step edits (currently 1:1 aspect ratio only)\n' +
          '  - BFL: Good for high-quality edits (works best with square images)\n\n' +
          'Important Notes:\n' +
          '  - BFL Kontext works best with square (1:1) aspect ratio images\n' +
          '  - Gemini currently only supports 1:1 (square) aspect ratio\n' +
          '  - Auto-selection avoids BFL for non-square images to preserve aspect ratio\n' +
          '  - File paths from image_generate can be used directly as baseImage\n\n' +
          'Error Handling:\n' +
          '  - "No providers configured that support image editing":\n' +
          '      Solution: Configure at least one of: OPENAI_API_KEY, STABILITY_API_KEY, ' +
          'BFL_API_KEY, GEMINI_API_KEY, CLIPDROP_API_KEY\n' +
          '  - "Provider X does not support image editing":\n' +
          '      Solution: Use a different provider that supports editing (OPENAI, STABILITY, BFL, GEMINI, CLIPDROP)\n' +
          '  - "Failed to load image from path":\n' +
          '      Solution: Ensure file path is correct and file exists\n' +
          '  - "Image size exceeds maximum":\n' +
          '      Solution: Input images must be under 10MB, resize before editing',
        inputSchema: zodToJsonSchema(EditInputSchema),
        annotations: {
          title: 'Edit Image with Prompt',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'image_health_ping':
        return {
          content: [
            {
              type: 'text',
              text: 'ok'
            }
          ]
        };

      case 'image_config_providers':
        const status = Config.getProviderStatus();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }
          ]
        };

      case 'image_generate': {
        const input = GenerateInputSchema.parse(args);

        // For auto-selection, filter providers by dimension constraints
        let provider;
        if (input.provider === 'auto' || !input.provider) {
          const allConfigured = Config.getConfiguredProviders();

          // Filter providers that support the requested dimensions
          const compatibleProviders = allConfigured.filter(name => {
            const p = Config.getProvider(name);
            if (!p) return false;
            const caps = p.getCapabilities();

            // Check width constraint
            if (input.width && caps.maxWidth && input.width > caps.maxWidth) {
              return false;
            }
            // Check height constraint
            if (input.height && caps.maxHeight && input.height > caps.maxHeight) {
              return false;
            }
            return true;
          });

          if (compatibleProviders.length === 0) {
            throw new Error(
              `No providers support the requested dimensions (${input.width || 'default'}x${input.height || 'default'}).\n\n` +
              `Action required:\n` +
              `  1. Reduce image dimensions to 1024x1024 or smaller, OR\n` +
              `  2. Check provider capabilities with image_config_providers tool, OR\n` +
              `  3. Specify a provider explicitly that supports larger dimensions (e.g., BFL supports up to 2048x2048)\n\n` +
              `Example: Use width=1024, height=1024 for maximum compatibility.`
            );
          }

          const { selectProvider } = await import('./services/providerSelector.js');
          const selectedName = selectProvider(input.prompt, compatibleProviders);
          provider = selectedName ? Config.getProvider(selectedName)! : Config.getProviderWithFallback(undefined, input.prompt);
        } else {
          provider = Config.getProviderWithFallback(input.provider, input.prompt);

          // Validate explicit provider supports dimensions
          const capabilities = provider.getCapabilities();
          if (input.width && capabilities.maxWidth && input.width > capabilities.maxWidth) {
            throw new Error(
              `Width ${input.width} exceeds provider ${provider.name} maximum (${capabilities.maxWidth}).\n\n` +
              `Action required:\n` +
              `  1. Reduce width to ${capabilities.maxWidth} or less, OR\n` +
              `  2. Use a different provider that supports larger dimensions\n\n` +
              `Tip: Use image_config_providers tool to see maximum dimensions for all providers.`
            );
          }
          if (input.height && capabilities.maxHeight && input.height > capabilities.maxHeight) {
            throw new Error(
              `Height ${input.height} exceeds provider ${provider.name} maximum (${capabilities.maxHeight}).\n\n` +
              `Action required:\n` +
              `  1. Reduce height to ${capabilities.maxHeight} or less, OR\n` +
              `  2. Use a different provider that supports larger dimensions\n\n` +
              `Tip: Use image_config_providers tool to see maximum dimensions for all providers.`
            );
          }
        }

        logger.info(`Generating image with ${provider.name}`, {
          prompt: input.prompt.slice(0, 50)
        });

        try {
          const result = await provider.generate(input);

          // Check for large images and warn
          const imageSizes = result.images.map(img => {
            const base64Length = img.dataUrl.split(',')[1]?.length || 0;
            return Math.round(base64Length * 0.75 / 1024); // KB
          });

          const warnings = [...(result.warnings || [])];
          imageSizes.forEach((size, i) => {
            if (size > 5120) { // 5MB
              warnings.push(`Image ${i + 1} is large (${size}KB). Consider external storage for production use.`);
            }
          });

          // Save images to configured directory
          const outputDir = await getOutputDirectory();
          const savedImages = await Promise.all(result.images.map(async (img, idx) => {
            const base64Data = img.dataUrl.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const hash = createHash('md5').update(buffer).digest('hex');
            const filename = `${TEMP_FILE_PREFIX}${result.provider.toLowerCase()}-${hash}-${Date.now()}-${idx}.${img.format || 'png'}`;
            const filepath = path.join(outputDir, filename);
            await fs.writeFile(filepath, buffer);
            return {
              path: filepath,
              format: img.format,
              size: buffer.length
            };
          }));

          const responseData = {
            images: savedImages,
            provider: result.provider,
            model: result.model,
            warnings: warnings.length > 0 ? warnings : undefined,
            note: 'Images saved to disk due to size. Original base64 data available in files.'
          };

          // Format response based on requested format
          let responseText = input.response_format === ResponseFormat.MARKDOWN
            ? formatGenerateResultMarkdown(responseData)
            : JSON.stringify(responseData, null, 2);

          // Apply character limit truncation
          responseText = truncateIfNeeded(
            responseText,
            'Tip: Response was truncated due to size. Images are saved to disk and accessible via file paths.'
          );

          return {
            content: [
              {
                type: 'text',
                text: responseText
              }
            ]
          };
        } catch (error) {
          if (error instanceof ProviderError && error.isRetryable && process.env.DISABLE_FALLBACK !== 'true') {
            // Try fallback provider
            logger.warn(`Provider ${provider.name} failed, attempting fallback`, { error });

            const fallback = Config.getDefaultProvider();
            if (fallback.name !== provider.name) {
              const result = await fallback.generate(input);

              // Save fallback images
              const outputDir = await getOutputDirectory();
              const savedImages = await Promise.all(result.images.map(async (img, idx) => {
                const base64Data = img.dataUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const hash = createHash('md5').update(buffer).digest('hex');
                const filename = `${TEMP_FILE_PREFIX}${result.provider.toLowerCase()}-${hash}-${Date.now()}-${idx}.${img.format || 'png'}`;
                const filepath = path.join(outputDir, filename);
                await fs.writeFile(filepath, buffer);
                return {
                  path: filepath,
                  format: img.format,
                  size: buffer.length
                };
              }));

              const responseData = {
                images: savedImages,
                provider: result.provider,
                model: result.model,
                warnings: [
                  `Original provider ${provider.name} failed: ${error.message}`,
                  `Fell back to ${fallback.name}`,
                  ...(result.warnings || [])
                ],
                note: 'Images saved to disk. Fallback provider was used.'
              };

              let responseText = input.response_format === ResponseFormat.MARKDOWN
                ? formatGenerateResultMarkdown(responseData)
                : JSON.stringify(responseData, null, 2);

              responseText = truncateIfNeeded(
                responseText,
                'Tip: Response was truncated. Images are saved to disk. Fallback provider was used.'
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: responseText
                  }
                ]
              };
            }
          }
          throw error;
        }
      }

      case 'image_edit': {
        const input = EditInputSchema.parse(args);

        // For auto-selection, only consider providers that support editing
        let provider;
        if (input.provider === 'auto' || !input.provider) {
          const editCapableProviders = Config.getConfiguredEditProviders();
          if (editCapableProviders.length === 0) {
            throw new Error(
              'No providers configured that support image editing.\n\n' +
              'Action required - Configure at least one of these providers:\n' +
              '  1. OpenAI: Set OPENAI_API_KEY environment variable\n' +
              '     Get API key: https://platform.openai.com/api-keys\n' +
              '  2. Stability AI: Set STABILITY_API_KEY environment variable\n' +
              '     Get API key: https://platform.stability.ai/account/keys\n' +
              '  3. BFL: Set BFL_API_KEY environment variable\n' +
              '     Get API key: https://api.bfl.ml/\n' +
              '  4. Gemini: Set GEMINI_API_KEY environment variable\n' +
              '     Get API key: https://aistudio.google.com/apikey\n' +
              '  5. Clipdrop: Set CLIPDROP_API_KEY environment variable\n' +
              '     Get API key: https://clipdrop.co/apis\n\n' +
              'After setting the API key, restart your MCP client.'
            );
          }
          // Use selectProvider with only edit-capable providers
          const { selectProvider } = await import('./services/providerSelector.js');
          const selectedName = selectProvider(input.prompt, editCapableProviders);
          provider = selectedName ? Config.getProvider(selectedName) : Config.getProviderWithFallback(undefined, input.prompt);
        } else {
          provider = Config.getProviderWithFallback(input.provider, input.prompt);
        }

        if (!provider) {
          throw new Error('No provider available for image editing');
        }

        logger.info(`Editing image with ${provider.name}`, {
          prompt: input.prompt.slice(0, 50)
        });

        if (!provider.getCapabilities().supportsEdit) {
          throw new Error(
            `Provider ${provider.name} does not support image editing.\n\n` +
            `Action required - Use one of these edit-capable providers:\n` +
            `  - OPENAI: Best for versatile image editing\n` +
            `  - STABILITY: Best for photorealistic edits and inpainting\n` +
            `  - BFL: Good for high-quality edits (square images recommended)\n` +
            `  - GEMINI: Good for complex edits (1:1 aspect ratio only)\n` +
            `  - CLIPDROP: Best for background removal and object removal\n\n` +
            `Example: Set provider="OPENAI" or provider="STABILITY" in your request.`
          );
        }

        // BFL Kontext has issues preserving non-square aspect ratios - exclude it for non-1:1 images
        if (provider.name === 'BFL' && (input.provider === 'auto' || !input.provider)) {
          // Detect input image dimensions
          const sharp = await import('sharp');
          const imageBuffer = input.baseImage.startsWith('data:')
            ? Buffer.from(input.baseImage.split(',')[1], 'base64')
            : await fs.readFile(input.baseImage.replace('file://', ''));
          const metadata = await sharp.default(imageBuffer).metadata();
          const ratio = (metadata.width || 1) / (metadata.height || 1);

          // If aspect ratio is not close to 1:1 (square), use a different provider
          if (Math.abs(ratio - 1) > 0.05) {
            logger.info(`BFL selected but input is non-square (${metadata.width}x${metadata.height}), using fallback`);
            // Get alternative edit providers excluding BFL
            const alternatives = Config.getConfiguredEditProviders().filter(name => name !== 'BFL');
            if (alternatives.length > 0) {
              const { selectProvider } = await import('./services/providerSelector.js');
              const altName = selectProvider(input.prompt, alternatives);
              provider = altName ? Config.getProvider(altName)! : Config.getProvider(alternatives[0])!;
              logger.info(`Using ${provider.name} instead for aspect ratio preservation`);
            }
          }
        }

        const result = await provider.edit(input);

        // Save images to configured directory (same as generate)
        const outputDir = await getOutputDirectory();
        const savedImages = await Promise.all(result.images.map(async (img, idx) => {
          const base64Data = img.dataUrl.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          const hash = createHash('md5').update(buffer).digest('hex');
          const filename = `${TEMP_FILE_PREFIX}${result.provider.toLowerCase()}-edit-${hash}-${Date.now()}-${idx}.${img.format || 'png'}`;
          const filepath = path.join(outputDir, filename);
          await fs.writeFile(filepath, buffer);
          return {
            path: filepath,
            format: img.format,
            size: buffer.length
          };
        }));

        const responseData = {
          images: savedImages,
          provider: result.provider,
          model: result.model,
          warnings: result.warnings,
          note: 'Images saved to disk. Files contain the edited results.'
        };

        // Format response based on requested format
        let responseText = input.response_format === ResponseFormat.MARKDOWN
          ? formatEditResultMarkdown(responseData)
          : JSON.stringify(responseData, null, 2);

        // Apply character limit truncation
        responseText = truncateIfNeeded(
          responseText,
          'Tip: Response was truncated due to size. Edited images are saved to disk and accessible via file paths.'
        );

        return {
          content: [
            {
              type: 'text',
              text: responseText
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Tool ${name} failed`, error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: message,
            tool: name
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

// Start server directly like playwright-proxy
const transport = new StdioServerTransport();
await server.connect(transport); // HANDSHAKE FIRST!

// NOW it's safe to touch stdin/stdout
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));

// Log after successful connection
await fs.appendFile(DEBUG_FILE, `\n[${new Date().toISOString()}] Image Gen MCP Started - PID=${process.pid}\n`).catch(() => {});
await debugLog('Server connected successfully');

// Start periodic cleanup of old temp files
startTempFileCleanup();