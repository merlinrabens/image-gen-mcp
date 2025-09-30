#!/usr/bin/env tsx
/**
 * Provider Validation Script
 *
 * This script tests each configured provider by making a simple image generation request.
 * Use this to verify your API keys are working before deploying.
 *
 * Usage: npm run validate-providers
 */

import { getConfiguredProviders } from '../src/config.js';
import { logger } from '../src/util/logger.js';

// Simple test prompt
const TEST_PROMPT = 'A simple red circle on white background';

interface ValidationResult {
  provider: string;
  configured: boolean;
  success: boolean;
  error?: string;
  responseTime?: number;
}

async function validateProvider(providerName: string): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const providers = getConfiguredProviders();
    const provider = providers.find(p => p.name === providerName);

    if (!provider) {
      return {
        provider: providerName,
        configured: false,
        success: false,
        error: 'Provider not configured (missing API key)'
      };
    }

    // Try to generate a simple image
    const result = await provider.generate({
      prompt: TEST_PROMPT,
      width: 512,
      height: 512
    });

    const responseTime = Date.now() - startTime;

    if (result.images && result.images.length > 0) {
      return {
        provider: providerName,
        configured: true,
        success: true,
        responseTime
      };
    } else {
      return {
        provider: providerName,
        configured: true,
        success: false,
        error: 'No images returned'
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      provider: providerName,
      configured: true,
      success: false,
      error: errorMessage,
      responseTime
    };
  }
}

async function main() {
  console.log('\n🔍 Image Gen MCP - Provider Validation\n');
  console.log('Testing configured providers with a simple image generation request...\n');

  // All available providers
  const allProviders = [
    'OPENAI',
    'STABILITY',
    'LEONARDO',
    'IDEOGRAM',
    'BFL',
    'FAL',
    'CLIPDROP',
    'REPLICATE',
    'GEMINI'
  ];

  const results: ValidationResult[] = [];

  // Test each provider sequentially (to avoid rate limits)
  for (const providerName of allProviders) {
    console.log(`Testing ${providerName}...`);
    const result = await validateProvider(providerName);
    results.push(result);

    if (result.success) {
      console.log(`  ✓ Success (${result.responseTime}ms)\n`);
    } else if (!result.configured) {
      console.log(`  ⚠ Not configured\n`);
    } else {
      console.log(`  ✗ Failed: ${result.error}\n`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60) + '\n');

  const configured = results.filter(r => r.configured);
  const successful = results.filter(r => r.success);
  const failed = configured.filter(r => !r.success);
  const notConfigured = results.filter(r => !r.configured);

  console.log(`Total Providers: ${allProviders.length}`);
  console.log(`Configured: ${configured.length}`);
  console.log(`✓ Working: ${successful.length}`);
  console.log(`✗ Failed: ${failed.length}`);
  console.log(`⚠ Not Configured: ${notConfigured.length}\n`);

  if (successful.length > 0) {
    console.log('✓ Working Providers:');
    successful.forEach(r => {
      console.log(`  • ${r.provider} (${r.responseTime}ms)`);
    });
    console.log('');
  }

  if (failed.length > 0) {
    console.log('✗ Failed Providers:');
    failed.forEach(r => {
      console.log(`  • ${r.provider}: ${r.error}`);
    });
    console.log('');
  }

  if (notConfigured.length > 0) {
    console.log('⚠ Not Configured:');
    notConfigured.forEach(r => {
      console.log(`  • ${r.provider}`);
    });
    console.log('');
  }

  // Exit with error if no providers work
  if (successful.length === 0) {
    console.error('❌ No providers are working! Please check your API keys.\n');
    process.exit(1);
  }

  console.log(`✅ Validation complete! ${successful.length} provider(s) working.\n`);
}

// Run validation
main().catch((error) => {
  console.error('Fatal error during validation:', error);
  process.exit(1);
});