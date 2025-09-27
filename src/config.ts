import 'dotenv/config';
import { ImageProvider } from './providers/base.js';
import { MockProvider } from './providers/mock.js';
import { OpenAIProvider } from './providers/openai.js';
import { StabilityProvider } from './providers/stability.js';
import { ReplicateProvider } from './providers/replicate.js';
import { GeminiProvider } from './providers/gemini.js';
import { ProviderName, ProviderError } from './types.js';
import { logger } from './util/logger.js';

/**
 * Provider factory and configuration management
 */
export class Config {
  private static providers: Map<ProviderName, ImageProvider> = new Map();
  private static initialized = false;

  /**
   * Initialize all providers
   */
  static initialize(): void {
    if (this.initialized) return;

    // Register all providers
    this.providers.set('MOCK', new MockProvider());
    this.providers.set('OPENAI', new OpenAIProvider());
    this.providers.set('STABILITY', new StabilityProvider());
    this.providers.set('REPLICATE', new ReplicateProvider());
    this.providers.set('GEMINI', new GeminiProvider());

    this.initialized = true;
    logger.info('Providers initialized', {
      configured: this.getConfiguredProviders()
    });
  }

  /**
   * Get a provider by name
   */
  static getProvider(name: string): ImageProvider | undefined {
    this.initialize();
    return this.providers.get(name.toUpperCase() as ProviderName);
  }

  /**
   * Get all registered providers
   */
  static getAllProviders(): Map<ProviderName, ImageProvider> {
    this.initialize();
    return this.providers;
  }

  /**
   * Get list of configured providers
   */
  static getConfiguredProviders(): ProviderName[] {
    this.initialize();
    const configured: ProviderName[] = [];

    for (const [name, provider] of this.providers) {
      if (provider.isConfigured()) {
        configured.push(name);
      }
    }

    return configured;
  }

  /**
   * Get default provider based on env or fallback chain
   */
  static getDefaultProvider(): ImageProvider {
    this.initialize();

    // Check env variable first
    const envDefault = process.env.DEFAULT_PROVIDER;
    if (envDefault) {
      const provider = this.getProvider(envDefault);
      if (provider?.isConfigured()) {
        return provider;
      }
      if (process.env.DISABLE_FALLBACK === 'true') {
        throw new ProviderError(
          `Default provider ${envDefault} not configured and fallback is disabled`,
          envDefault,
          false
        );
      }
      logger.debug(`Default provider ${envDefault} not configured, falling back`);
    }

    // If fallback is disabled, throw error
    if (process.env.DISABLE_FALLBACK === 'true') {
      throw new ProviderError(
        'No default provider configured and fallback is disabled',
        'NONE',
        false
      );
    }

    // Fallback chain
    const fallbackChain: ProviderName[] = ['OPENAI', 'STABILITY', 'REPLICATE', 'GEMINI', 'MOCK'];

    for (const name of fallbackChain) {
      const provider = this.providers.get(name);
      if (provider?.isConfigured()) {
        logger.debug(`Using ${name} as default provider`);
        return provider;
      }
    }

    // Mock is always available
    return this.providers.get('MOCK')!;
  }

  /**
   * Get provider with fallback support
   */
  static getProviderWithFallback(requestedName?: string): ImageProvider {
    this.initialize();

    if (requestedName) {
      const provider = this.getProvider(requestedName);
      if (provider) {
        if (provider.isConfigured()) {
          return provider;
        }
        if (process.env.DISABLE_FALLBACK === 'true') {
          throw new ProviderError(
            `Provider ${requestedName} not configured and fallback is disabled`,
            requestedName,
            false
          );
        }
        logger.warn(`Provider ${requestedName} not configured, using fallback`);
      } else {
        if (process.env.DISABLE_FALLBACK === 'true') {
          throw new ProviderError(
            `Unknown provider ${requestedName} and fallback is disabled`,
            requestedName,
            false
          );
        }
        logger.warn(`Unknown provider ${requestedName}, using fallback`);
      }
    }

    return this.getDefaultProvider();
  }

  /**
   * Check if required environment variables are set
   */
  static requireEnv(keys: string[]): void {
    const missing = keys.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new ProviderError(
        `Missing required environment variables: ${missing.join(', ')}`,
        'CONFIG',
        false
      );
    }
  }

  /**
   * Get provider status for config.providers tool
   */
  static getProviderStatus(): Array<{
    name: string;
    configured: boolean;
    requiredEnvVars: string[];
    capabilities: ReturnType<ImageProvider['getCapabilities']>;
  }> {
    this.initialize();
    const status = [];

    for (const [name, provider] of this.providers) {
      status.push({
        name,
        configured: provider.isConfigured(),
        requiredEnvVars: provider.getRequiredEnvVars(),
        capabilities: provider.getCapabilities()
      });
    }

    return status;
  }
}