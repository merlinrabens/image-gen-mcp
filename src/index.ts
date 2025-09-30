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
import { GenerateInputSchema, EditInputSchema, ProviderError } from './types.js';
import { logger } from './util/logger.js';

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
    name: 'image-gen-mcp',
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
        name: 'health.ping',
        description: 'Check if the server is running',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'config.providers',
        description: 'List available providers and their configuration status',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'image.generate',
        description: 'Generate an image from a text prompt',
        inputSchema: zodToJsonSchema(GenerateInputSchema)
      },
      {
        name: 'image.edit',
        description: 'Edit an existing image with a text prompt',
        inputSchema: zodToJsonSchema(EditInputSchema)
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'health.ping':
        return {
          content: [
            {
              type: 'text',
              text: 'ok'
            }
          ]
        };

      case 'config.providers':
        const status = Config.getProviderStatus();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }
          ]
        };

      case 'image.generate': {
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
              `No providers support the requested dimensions (${input.width || 'default'}x${input.height || 'default'}). ` +
              `Try reducing image size or specify a different provider.`
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
              `Width ${input.width} exceeds provider ${provider.name} maximum (${capabilities.maxWidth})`
            );
          }
          if (input.height && capabilities.maxHeight && input.height > capabilities.maxHeight) {
            throw new Error(
              `Height ${input.height} exceeds provider ${provider.name} maximum (${capabilities.maxHeight})`
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

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  images: savedImages,
                  provider: result.provider,
                  model: result.model,
                  warnings: warnings.length > 0 ? warnings : undefined,
                  note: 'Images saved to disk due to size. Original base64 data available in files.'
                }, null, 2)
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
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      ...result,
                      warnings: [
                        `Original provider ${provider.name} failed: ${error.message}`,
                        `Fell back to ${fallback.name}`,
                        ...(result.warnings || [])
                      ]
                    }, null, 2)
                  }
                ]
              };
            }
          }
          throw error;
        }
      }

      case 'image.edit': {
        const input = EditInputSchema.parse(args);

        // For auto-selection, only consider providers that support editing
        let provider;
        if (input.provider === 'auto' || !input.provider) {
          const editCapableProviders = Config.getConfiguredEditProviders();
          if (editCapableProviders.length === 0) {
            throw new Error(
              'No providers configured that support image editing. ' +
              'Please configure OPENAI, STABILITY, BFL, or GEMINI.'
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
            `Provider ${provider.name} does not support image editing. ` +
            `Please use a provider that supports editing: OPENAI, STABILITY, BFL, or GEMINI.`
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                images: savedImages,
                provider: result.provider,
                model: result.model,
                warnings: result.warnings,
                note: 'Images saved to disk. Files contain the edited results.'
              }, null, 2)
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