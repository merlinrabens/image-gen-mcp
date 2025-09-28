// Remove dotenv/config as it can pollute stdout
// Environment variables should be passed via Claude's config
import { ImageProvider } from './providers/base.js';
import { MockProvider } from './providers/mock.js';
import { OpenAIProvider } from './providers/openai.js';
import { StabilityProvider } from './providers/stability.js';
import { ReplicateProvider } from './providers/replicate.js';
import { GeminiProvider } from './providers/gemini.js';
import { ProviderName, ProviderError } from './types.js';

/**
 * Provider factory and configuration management
 */
export class Config {
  private static providers: Map<ProviderName, ImageProvider> = new Map();

  /**
   * Lazy create a provider only when needed
   */
  private static createProvider(name: ProviderName): ImageProvider | undefined {
    const existing = this.providers.get(name);
    if (existing) return existing;

    let provider: ImageProvider | undefined;
    switch (name) {
      case 'MOCK':
        provider = new MockProvider();
        break;
      case 'OPENAI':
        provider = new OpenAIProvider();
        break;
      case 'STABILITY':
        provider = new StabilityProvider();
        break;
      case 'REPLICATE':
        provider = new ReplicateProvider();
        break;
      case 'GEMINI':
        provider = new GeminiProvider();
        break;
    }

    if (provider) {
      this.providers.set(name, provider);
    }
    return provider;
  }

  /**
   * Get a provider by name
   */
  static getProvider(name: string): ImageProvider | undefined {
    return this.createProvider(name.toUpperCase() as ProviderName);
  }

  /**
   * Get all registered providers
   */
  static getAllProviders(): Map<ProviderName, ImageProvider> {
    // Create all providers lazily
    const allNames: ProviderName[] = ['MOCK', 'OPENAI', 'STABILITY', 'REPLICATE', 'GEMINI'];
    for (const name of allNames) {
      this.createProvider(name);
    }
    return this.providers;
  }

  /**
   * Get list of configured providers
   */
  static getConfiguredProviders(): ProviderName[] {
    const configured: ProviderName[] = [];
    const allNames: ProviderName[] = ['MOCK', 'OPENAI', 'STABILITY', 'REPLICATE', 'GEMINI'];

    for (const name of allNames) {
      const provider = this.createProvider(name);
      if (provider?.isConfigured()) {
        configured.push(name);
      }
    }

    return configured;
  }

  /**
   * Get default provider based on env or fallback chain
   */
  static getDefaultProvider(): ImageProvider {
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
      const provider = this.createProvider(name);
      if (provider?.isConfigured()) {
        return provider;
      }
    }

    // Mock is always available
    return this.createProvider('MOCK')!;
  }

  /**
   * Get provider with fallback support
   */
  static getProviderWithFallback(requestedName?: string): ImageProvider {
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
        // Don't log to avoid stdout/stderr pollution
      } else {
        if (process.env.DISABLE_FALLBACK === 'true') {
          throw new ProviderError(
            `Unknown provider ${requestedName} and fallback is disabled`,
            requestedName,
            false
          );
        }
        // Don't log to avoid stdout/stderr pollution
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
    const status = [];
    const allNames: ProviderName[] = ['MOCK', 'OPENAI', 'STABILITY', 'REPLICATE', 'GEMINI'];

    for (const name of allNames) {
      const provider = this.createProvider(name);
      if (provider) {
        status.push({
          name,
          configured: provider.isConfigured(),
          requiredEnvVars: provider.getRequiredEnvVars(),
          capabilities: provider.getCapabilities()
        });
      }
    }

    return status;
  }
}