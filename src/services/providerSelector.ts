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
    keywords: ['art', 'painting', 'illustration', 'creative', 'abstract', 'surreal', 'imaginative', 'artistic'],
    preferredProviders: ['LEONARDO', 'STABLE'],
    fallbackProviders: ['BFL', 'REPLICATE'],
    confidence: 0.85
  },
  'fantasy': {
    keywords: ['fantasy', 'magical', 'mythical', 'dragon', 'wizard', 'medieval', 'enchanted', 'mystical', 'rpg'],
    preferredProviders: ['LEONARDO', 'STABLE'],
    fallbackProviders: ['BFL', 'REPLICATE'],
    confidence: 0.9
  },
  'cinematic': {
    keywords: ['cinematic', 'dramatic', 'epic', 'movie', 'film', 'scene', 'atmospheric', 'moody'],
    preferredProviders: ['LEONARDO', 'BFL'],
    fallbackProviders: ['STABLE', 'DALLE'],
    confidence: 0.85
  },
  'game-asset': {
    keywords: ['game', 'asset', 'sprite', 'texture', 'character design', 'concept art', 'gaming', 'video game'],
    preferredProviders: ['LEONARDO', 'STABLE'],
    fallbackProviders: ['FAL', 'BFL'],
    confidence: 0.85
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
    keywords: ['instagram', 'tiktok', 'youtube', 'thumbnail', 'story', 'post', 'reel', 'viral', 'social'],
    preferredProviders: ['LEONARDO', 'IDEOGRAM'],
    fallbackProviders: ['BFL', 'FAL'],
    confidence: 0.8
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
  'multi-image': {
    keywords: ['combine', 'multiple images', 'composite', 'merge', 'collage', 'blend images', 'mix images'],
    preferredProviders: ['GEMINI'], // Unique multimodal capability
    fallbackProviders: ['DALLE', 'LEONARDO'],
    confidence: 0.9
  }
};


// Pre-compiled keyword search for performance
const keywordToUseCases = new Map<string, Set<string>>();

// Build reverse index for O(1) keyword lookups
function buildKeywordIndex(): void {
  if (keywordToUseCases.size === 0) {
    for (const [useCase, config] of Object.entries(useCaseMapping)) {
      for (const keyword of config.keywords) {
        if (!keywordToUseCases.has(keyword)) {
          keywordToUseCases.set(keyword, new Set());
        }
        keywordToUseCases.get(keyword)!.add(useCase);
      }
    }
  }
}

/**
 * Analyze prompt to detect use case with optimized O(n) complexity
 */
export function analyzePrompt(prompt: string): { useCase: string; confidence: number } | null {
  // Handle empty or whitespace-only prompts
  if (!prompt || !prompt.trim()) {
    return null;
  }

  // Build index on first use
  buildKeywordIndex();

  const lower = prompt.toLowerCase();
  const useCaseScores = new Map<string, { score: number; matchedKeywords: number }>();

  // Check for exact keyword matches in the full prompt (not just words)
  // This is more accurate for compound keywords like "remove background"
  for (const [keyword, useCases] of keywordToUseCases.entries()) {
    if (lower.includes(keyword)) {
      for (const useCase of useCases) {
        const current = useCaseScores.get(useCase) || { score: 0, matchedKeywords: 0 };
        current.score += keyword.length * (keyword.split(' ').length); // Weight multi-word keywords higher
        current.matchedKeywords++;
        useCaseScores.set(useCase, current);
      }
    }
  }

  // Find best match
  let bestMatch: { useCase: string; confidence: number; score: number } | null = null;

  for (const [useCase, scoreData] of useCaseScores.entries()) {
    const config = useCaseMapping[useCase];
    const matchRatio = scoreData.matchedKeywords / config.keywords.length;
    const finalConfidence = config.confidence * (0.5 + 0.5 * matchRatio);

    if (!bestMatch || scoreData.score > bestMatch.score) {
      bestMatch = {
        useCase,
        confidence: finalConfidence,
        score: scoreData.score
      };
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
): string | undefined {
  // Handle empty provider list
  if (!availableProviders || availableProviders.length === 0) {
    return undefined;
  }
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
    const speedProviders = ['FAL', 'GEMINI', 'DALLE'];
    for (const provider of speedProviders) {
      if (availableProviders.includes(provider)) {
        logger.info(`Selected ${provider} for speed-focused request`);
        return provider;
      }
    }
  }

  // Default to most versatile available provider (prioritize fallback chain order)
  // GEMINI preferred over OPENAI for better aspect ratio preservation and faster edits
  const preferredOrder = ['GEMINI', 'OPENAI', 'STABILITY', 'BFL', 'LEONARDO', 'IDEOGRAM', 'FAL', 'REPLICATE'];
  for (const provider of preferredOrder) {
    if (availableProviders.includes(provider)) {
      logger.info(`Using default provider: ${provider}`);
      return provider;
    }
  }

  // Fallback to first available if none from preferred list
  if (availableProviders.length > 0) {
    const defaultProvider = availableProviders[0];
    logger.info(`Using fallback default provider: ${defaultProvider}`);
    return defaultProvider;
  }

  return undefined;
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

  // Generic recommendations (aligned with fallback chain)
  return {
    primary: ['GEMINI', 'OPENAI', 'STABILITY'],
    secondary: ['BFL', 'LEONARDO', 'IDEOGRAM', 'FAL'],
    reason: 'No specific use case detected - using versatile general-purpose providers'
  };
}