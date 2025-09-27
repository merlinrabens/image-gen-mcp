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

/**
 * MCP server for image generation
 */
class ImageGenMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
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

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
            const provider = Config.getProviderWithFallback(input.provider);

            // Validate input against provider capabilities
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

              // Save images to temp directory to avoid huge responses
              const savedImages = await Promise.all(result.images.map(async (img, idx) => {
                const base64Data = img.dataUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const hash = createHash('md5').update(buffer).digest('hex');
                const filename = `${TEMP_FILE_PREFIX}${result.provider.toLowerCase()}-${hash}-${Date.now()}-${idx}.${img.format || 'png'}`;
                const filepath = path.join(os.tmpdir(), filename);
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
            const provider = Config.getProviderWithFallback(input.provider);

            logger.info(`Editing image with ${provider.name}`, {
              prompt: input.prompt.slice(0, 50)
            });

            if (!provider.getCapabilities().supportsEdit) {
              throw new Error(
                `Provider ${provider.name} does not support image editing. ` +
                `Try OpenAI or Stability providers instead.`
              );
            }

            const result = await provider.edit(input);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
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
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Image Gen MCP server started');

    // Start periodic cleanup of old temp files
    this.startTempFileCleanup();
  }

  private async cleanupOldTempFiles(): Promise<void> {
    try {
      const tmpDir = os.tmpdir();
      const files = await fs.readdir(tmpDir);
      const now = Date.now();

      for (const file of files) {
        if (file.startsWith(TEMP_FILE_PREFIX)) {
          const filepath = path.join(tmpDir, file);
          try {
            const stats = await fs.stat(filepath);
            const age = now - stats.mtimeMs;
            if (age > TEMP_FILE_MAX_AGE_MS) {
              await fs.unlink(filepath);
              logger.debug(`Cleaned up old temp file: ${file}`);
            }
          } catch (error) {
            // File might already be deleted, ignore
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup temp files', error);
    }
  }

  private startTempFileCleanup(): void {
    // Run cleanup immediately on start
    this.cleanupOldTempFiles();

    // Then run every 30 minutes (unref to not keep process alive)
    const interval = setInterval(() => {
      this.cleanupOldTempFiles();
    }, 30 * 60 * 1000);
    interval.unref();
  }
}

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

// Start the server
const server = new ImageGenMCPServer();

// Handle graceful shutdown to prevent stale processes
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

server.start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});