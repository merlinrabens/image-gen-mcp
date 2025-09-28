import { logger } from '../util/logger.js';

/**
 * Use case mapping for intelligent provider selection
 */
interface UseCase {
  keywords: string[];
  preferredProviders: string[];
  fallbackProviders: string[];
  confidence: number; // How confident we are in this categorization
}

const useCaseMapping: Record<string, UseCase> = {
  'logo': {
    keywords: ['logo', 'brand', 'icon', 'symbol', 'emblem', 'mark', 'badge'],
    preferredProviders: ['IDEOGRAM', 'DALLE'],
    fallbackProviders: ['LEONARDO', 'STABLE'],
    confidence: 0.9
  },
  'text-heavy': {
    keywords: ['text', 'poster', 'banner', 'sign', 'quote', 'typography', 'lettering', 'flyer', 'advertisement'],
    preferredProviders: ['IDEOGRAM'],
    fallbackProviders: ['DALLE', 'GEMINI'],
    confidence: 0.95
  },
  'photorealistic': {
    keywords: ['realistic', 'photo', 'photography', 'real', 'lifelike', 'portrait', 'headshot', 'professional'],
    preferredProviders: ['BFL', 'STABLE'],
    fallbackProviders: ['GEMINI', 'DALLE'],
    confidence: 0.85
  },
  'artistic': {
    keywords: ['art', 'painting', 'illustration', 'creative', 'abstract', 'surreal', 'fantasy', 'imaginative'],
    preferredProviders: ['LEONARDO', 'REPLICATE'],
    fallbackProviders: ['STABLE', 'FAL'],
    confidence: 0.8
  },
  'ui-design': {
    keywords: ['ui', 'ux', 'interface', 'app', 'website', 'dashboard', 'mockup', 'wireframe', 'design'],
    preferredProviders: ['DALLE', 'IDEOGRAM'],
    fallbackProviders: ['STABLE', 'LEONARDO'],
    confidence: 0.85
  },
  'product': {
    keywords: ['product', 'ecommerce', 'catalog', 'item', 'merchandise', 'packaging'],
    preferredProviders: ['BFL', 'STABLE'],
    fallbackProviders: ['DALLE', 'GEMINI'],
    confidence: 0.8
  },
  'social-media': {
    keywords: ['instagram', 'tiktok', 'youtube', 'thumbnail', 'story', 'post', 'reel', 'viral'],
    preferredProviders: ['LEONARDO', 'IDEOGRAM'],
    fallbackProviders: ['FAL', 'CLIPDROP'],
    confidence: 0.75
  },
  'technical': {
    keywords: ['diagram', 'chart', 'graph', 'flowchart', 'architecture', 'schematic', 'blueprint'],
    preferredProviders: ['DALLE', 'GEMINI'],
    fallbackProviders: ['IDEOGRAM', 'STABLE'],
    confidence: 0.8
  },
  '3d-render': {
    keywords: ['3d', 'render', 'cgi', 'three dimensional', 'model', 'sculpture'],
    preferredProviders: ['STABLE', 'BFL'],
    fallbackProviders: ['DALLE', 'LEONARDO'],
    confidence: 0.85
  },
  'anime': {
    keywords: ['anime', 'manga', 'kawaii', 'chibi', 'japanese', 'otaku'],
    preferredProviders: ['LEONARDO', 'STABLE'],
    fallbackProviders: ['REPLICATE', 'FAL'],
    confidence: 0.9
  },
  'carousel': {
    keywords: ['carousel', 'series', 'consistent', 'multiple', 'sequence', 'slides'],
    preferredProviders: ['LEONARDO'], // Character consistency is key!
    fallbackProviders: ['IDEOGRAM', 'STABLE'],
    confidence: 0.95
  },
  'quick-draft': {
    keywords: ['quick', 'draft', 'fast', 'rapid', 'speed', 'instant'],
    preferredProviders: ['FAL'], // Ultra-fast generation
    fallbackProviders: ['DALLE', 'GEMINI'],
    confidence: 0.9
  },
  'post-process': {
    keywords: ['remove background', 'transparent', 'upscale', 'enhance', 'cleanup', 'edit'],
    preferredProviders: ['CLIPDROP'], // Post-processing specialist
    fallbackProviders: ['STABLE', 'OPENAI'],
    confidence: 0.95
  },
  'infographic': {
    keywords: ['infographic', 'data', 'visualization', 'stats', 'chart', 'graph', 'information'],
    preferredProviders: ['IDEOGRAM', 'DALLE'],
    fallbackProviders: ['GEMINI', 'STABLE'],
    confidence: 0.85
  },
  'game-asset': {
    keywords: ['game', 'asset', 'sprite', 'texture', 'character design', 'concept art'],
    preferredProviders: ['LEONARDO', 'STABLE'],
    fallbackProviders: ['FAL', 'BFL'],
    confidence: 0.85
  }
};

/**
 * Provider capabilities for matching
 * TODO: Use for advanced matching in future versions
 */
// const providerStrengths: Record<string, string[]> = {
//   'IDEOGRAM': ['text', 'logo', 'poster', 'typography'],
//   'BFL': ['photorealistic', 'high-quality', 'professional', 'raw'],
//   'LEONARDO': ['character-consistency', 'training', 'artistic', 'anime'],
//   'FAL': ['ultra-fast', 'real-time', 'scalable'],
//   'CLIPDROP': ['editing', 'background-removal', 'post-processing'],
//   'DALLE': ['versatile', 'clean', 'technical', 'ui'],
//   'STABLE': ['flexible', 'customizable', '3d', 'photorealistic'],
//   'GEMINI': ['multimodal', 'understanding', 'technical'],
//   'REPLICATE': ['models', 'variety', 'custom'],
//   'TOGETHER': ['open-source', 'variety', 'cost-effective'],
//   'OPENAI': ['versatile', 'safe', 'consistent'],
//   'LEONARDO': ['game-assets', 'control', 'textures']
// };

/**
 * Analyze prompt to detect use case
 */
export function analyzePrompt(prompt: string): { useCase: string; confidence: number } | null {
  const lower = prompt.toLowerCase();
  let bestMatch: { useCase: string; confidence: number; score: number } | null = null;

  for (const [useCase, config] of Object.entries(useCaseMapping)) {
    let score = 0;
    let matchedKeywords = 0;

    // Check for keyword matches
    for (const keyword of config.keywords) {
      if (lower.includes(keyword)) {
        score += keyword.length; // Longer keywords = more specific = higher score
        matchedKeywords++;
      }
    }

    if (matchedKeywords > 0) {
      // Calculate confidence based on matches and keyword specificity
      // const avgKeywordLength = score / matchedKeywords; // TODO: Use for weighted scoring
      const matchRatio = matchedKeywords / config.keywords.length;
      const finalConfidence = config.confidence * (0.5 + 0.5 * matchRatio);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          useCase,
          confidence: finalConfidence,
          score
        };
      }
    }
  }

  if (bestMatch) {
    logger.debug(`Detected use case: ${bestMatch.useCase} (confidence: ${bestMatch.confidence.toFixed(2)})`);
    return { useCase: bestMatch.useCase, confidence: bestMatch.confidence };
  }

  return null;
}

/**
 * Select the best provider for a given prompt
 */
export function selectProvider(
  prompt: string,
  availableProviders: string[],
  explicitProvider?: string
): string {
  // If explicit provider requested and available, use it
  if (explicitProvider && explicitProvider !== 'auto') {
    if (availableProviders.includes(explicitProvider)) {
      logger.info(`Using explicitly requested provider: ${explicitProvider}`);
      return explicitProvider;
    }
    logger.warn(`Requested provider ${explicitProvider} not available, falling back to auto-selection`);
  }

  // Analyze the prompt
  const analysis = analyzePrompt(prompt);

  if (analysis) {
    const useCase = useCaseMapping[analysis.useCase];

    // Try preferred providers first
    for (const provider of useCase.preferredProviders) {
      if (availableProviders.includes(provider)) {
        logger.info(`Selected ${provider} for ${analysis.useCase} use case (confidence: ${analysis.confidence.toFixed(2)})`);
        return provider;
      }
    }

    // Try fallback providers
    for (const provider of useCase.fallbackProviders) {
      if (availableProviders.includes(provider)) {
        logger.info(`Using fallback provider ${provider} for ${analysis.useCase} use case`);
        return provider;
      }
    }
  }

  // No specific use case detected, use general heuristics
  logger.debug('No specific use case detected, using general provider selection');

  // Check for quality keywords
  const lower = prompt.toLowerCase();
  if (lower.includes('high quality') || lower.includes('professional') || lower.includes('4k')) {
    const qualityProviders = ['BFL', 'STABLE', 'DALLE'];
    for (const provider of qualityProviders) {
      if (availableProviders.includes(provider)) {
        logger.info(`Selected ${provider} for quality-focused request`);
        return provider;
      }
    }
  }

  // Check for speed keywords
  if (lower.includes('quick') || lower.includes('fast') || lower.includes('draft')) {
    const speedProviders = ['FAL', 'DALLE', 'GEMINI'];
    for (const provider of speedProviders) {
      if (availableProviders.includes(provider)) {
        logger.info(`Selected ${provider} for speed-focused request`);
        return provider;
      }
    }
  }

  // Default to first available provider
  const defaultProvider = availableProviders[0];
  logger.info(`Using default provider: ${defaultProvider}`);
  return defaultProvider;
}

/**
 * Get provider recommendations for a prompt
 */
export function getProviderRecommendations(prompt: string): {
  primary: string[];
  secondary: string[];
  reason: string;
} {
  const analysis = analyzePrompt(prompt);

  if (analysis) {
    const useCase = useCaseMapping[analysis.useCase];
    return {
      primary: useCase.preferredProviders,
      secondary: useCase.fallbackProviders,
      reason: `Detected ${analysis.useCase} use case with ${(analysis.confidence * 100).toFixed(0)}% confidence`
    };
  }

  // Generic recommendations
  return {
    primary: ['DALLE', 'STABLE', 'BFL'],
    secondary: ['GEMINI', 'LEONARDO', 'FAL', 'IDEOGRAM'],
    reason: 'No specific use case detected - using general-purpose providers'
  };
}