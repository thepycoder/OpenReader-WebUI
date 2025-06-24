/**
 * Text-to-Speech (TTS) Preprocessing Rules
 * 
 * This module provides a rule-based text preprocessing system for TTS.
 * Rules are split into two categories:
 * - Block-level rules: Applied at line/sentence level with access to font/position data
 * - Page-level rules: Applied to the entire page text without position requirements
 * 
 * Key features:
 * - Extensible rule system
 * - Font size-based title detection (for PDFs)
 * - Easy to add new preprocessing rules
 * - Clear rule documentation and organization
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { getEnabledAbbreviationsMap } from '@/utils/abbreviations';

/**
 * Interface for text items with font size information
 * Used primarily for PDF processing where font metrics are available
 */
export interface TextItemWithSize extends TextItem {
  fontSize?: number;
  isBold?: boolean;
  isTitle?: boolean;
}

/**
 * Context information passed to preprocessing rules
 */
export interface PreprocessingContext {
  documentType?: 'pdf' | 'epub' | 'html' | 'docx';
  textItems?: TextItemWithSize[]; // Available for PDFs - all items from the page
  currentLineItems?: TextItemWithSize[]; // Current line items for specific analysis
  currentLineIndex?: number; // Index of current line for comparison with adjacent lines
  currentSentenceIndex?: number;
  totalSentences?: number;
  originalText?: string;
}

/**
 * Interface for a preprocessing rule
 */
export interface PreprocessingRule {
  name: string;
  description: string;
  enabled: boolean;
  priority: number; // Lower numbers = higher priority (executed first)
  apply: (sentence: string, context: PreprocessingContext) => string;
}

// =============================================================================
// BLOCK-LEVEL RULES (need position and font information)
// =============================================================================

/**
 * Rule: Add period to titles
 * 
 * Detects titles based on font size comparison and adds a period if missing.
 * This creates a natural pause after titles when read by TTS.
 * 
 * Logic:
 * - For PDFs: Uses font size information from text items, comparing current line with next line
 * - For other formats: Uses heuristics like all caps, short length, etc.
 */
const addPeriodToTitlesRule: PreprocessingRule = {
  name: 'addPeriodToTitles',
  description: 'Add period to titles for natural pause in TTS',
  enabled: true,
  priority: 1,
  apply: (sentence: string, context: PreprocessingContext): string => {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?') || trimmed.endsWith(':')) {
      return sentence; // Already has punctuation or is empty
    }

    let isTitle = false;

    if (context.documentType === 'pdf' && context.textItems && context.currentLineItems && context.currentLineIndex !== undefined) {
      // PDF-specific title detection using font size comparison with next line
      isTitle = detectTitleFromPDFWithComparison(trimmed, context.textItems, context.currentLineItems, context.currentLineIndex);
    } else {
      // Heuristic-based title detection for other formats
      isTitle = detectTitleHeuristic(trimmed);
    }

    if (isTitle) {
      console.log(`TTS Preprocessing: Adding period to detected title: "${trimmed.substring(0, 50)}..."`);
      return trimmed + '.';
    }

    return sentence;
  }
};

/**
 * Rule: Add pauses for lists
 * 
 * Adds slight pauses (commas) between list items for better comprehension.
 */
const addListPausesRule: PreprocessingRule = {
  name: 'addListPauses',
  description: 'Add pauses between list items',
  enabled: true,
  priority: 3,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  apply: (sentence: string, _context: PreprocessingContext): string => {
    // Detect bullet points and numbered lists
    const listPatterns = [
      /^[\s]*[-•*]\s+/,  // Bullet points: - • *
      /^[\s]*\d+[\.)]\s+/, // Numbered lists: 1. 1)
      /^[\s]*[a-zA-Z][\.)]\s+/, // Lettered lists: a. a)
    ];

    for (const pattern of listPatterns) {
      if (pattern.test(sentence)) {
        // If it's a list item and doesn't end with punctuation, add a comma
        const trimmed = sentence.trim();
        if (!trimmed.endsWith('.') && !trimmed.endsWith(',') && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
          return trimmed + ',';
        }
        break;
      }
    }

    return sentence;
  }
};

/**
 * All block-level preprocessing rules
 * These rules need position/font information and are applied at the line level
 */
const BLOCK_LEVEL_RULES: PreprocessingRule[] = [
  addPeriodToTitlesRule,
  addListPausesRule,
];

// =============================================================================
// PAGE-LEVEL RULES (work on full text without position requirements)
// =============================================================================

/**
 * Rule: Normalize whitespace
 * 
 * Cleans up excessive whitespace and normalizes spacing for better TTS processing.
 */
const normalizeWhitespaceRule: PreprocessingRule = {
  name: 'normalizeWhitespace',
  description: 'Normalize excessive whitespace and line breaks',
  enabled: true,
  priority: 10,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  apply: (sentence: string, _context: PreprocessingContext): string => {
    return sentence
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();
  }
};

// Cache for abbreviations to avoid repeated database calls
let abbreviationsCache: Map<string, { expansion: string; isRegex: boolean }> | null = null;
let cacheLoadPromise: Promise<Map<string, { expansion: string; isRegex: boolean }>> | null = null;

/**
 * Load abbreviations and cache them
 */
async function loadAbbreviationsCache(): Promise<Map<string, { expansion: string; isRegex: boolean }>> {
  if (abbreviationsCache) {
    return abbreviationsCache;
  }
  
  if (cacheLoadPromise) {
    return cacheLoadPromise;
  }
  
  cacheLoadPromise = getEnabledAbbreviationsMap();
  abbreviationsCache = await cacheLoadPromise;
  cacheLoadPromise = null;
  
  return abbreviationsCache;
}

/**
 * Clear the abbreviations cache (useful when abbreviations are updated)
 */
export function clearAbbreviationsCache(): void {
  abbreviationsCache = null;
  cacheLoadPromise = null;
}

/**
 * Safely creates a regex from a string, handling both literal strings and regex patterns
 * @param abbrev - The abbreviation string
 * @param isRegex - Whether this should be treated as a regex pattern
 * @returns A RegExp object
 */
function createAbbreviationRegex(abbrev: string, isRegex: boolean): RegExp {
  try {
    if (isRegex) {
      // Use as regex pattern directly
      return new RegExp(abbrev, 'gi');
    } else {
      // Escape special characters and add word boundaries for literal strings
      const escapedAbbrev = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapedAbbrev}\\b`, 'gi');
    }
  } catch (error) {
    // If regex creation fails, fall back to escaped literal string
    console.warn(`Invalid regex pattern "${abbrev}", treating as literal string:`, error);
    const escapedAbbrev = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedAbbrev}\\b`, 'gi');
  }
}

/**
 * Rule: Expand common abbreviations
 * 
 * Expands abbreviations to their full form for better TTS pronunciation.
 * Uses dynamic abbreviations from the abbreviations manager with caching.
 * Processes abbreviations in order, with higher order values first.
 * Supports both literal strings and regex patterns based on explicit isRegex flag.
 */
const expandAbbreviationsRule: PreprocessingRule = {
  name: 'expandAbbreviations',
  description: 'Expand abbreviations for better pronunciation',
  enabled: true,
  priority: 5,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  apply: (sentence: string, _context: PreprocessingContext): string => {
    // Use cached abbreviations if available
    if (!abbreviationsCache) {
      // If cache is not loaded, load it asynchronously but don't block
      // This will be available for subsequent calls
      loadAbbreviationsCache().catch(error => {
        console.warn('Error loading abbreviations cache:', error);
      });
      return sentence; // Return original sentence if cache not ready
    }
    
    let result = sentence;
    
    // Process abbreviations in order (Map preserves insertion order)
    // The abbreviations are already sorted by order when cached
    for (const [abbrev, { expansion, isRegex }] of abbreviationsCache.entries()) {
      try {
        const regex = createAbbreviationRegex(abbrev, isRegex);
        const newResult = result.replace(regex, expansion);
        
        // Log if replacement was made
        if (newResult !== result) {
          const patternType = isRegex ? 'regex' : 'literal';
          console.log(`TTS Abbreviation expanded (${patternType}): "${abbrev}" → "${expansion}"`);
          result = newResult;
        }
      } catch (error) {
        console.warn(`Error processing abbreviation "${abbrev}":`, error);
        // Continue with other abbreviations even if one fails
      }
    }
    
    return result;
  }
};

/**
 * All page-level preprocessing rules
 * These rules work on the full text and don't need position/font information
 */
const PAGE_LEVEL_RULES: PreprocessingRule[] = [
  normalizeWhitespaceRule,
  expandAbbreviationsRule,
];

// =============================================================================
// COMBINED RULES AND UTILITIES
// =============================================================================

/**
 * All available preprocessing rules
 * Add new rules to the appropriate category above
 */
const ALL_RULES: PreprocessingRule[] = [
  ...BLOCK_LEVEL_RULES,
  ...PAGE_LEVEL_RULES,
];

/**
 * Detects if text is likely a title based on font size comparison with the following line
 * @param text - The text to check
 * @param allTextItems - All text items from the page (assumed to be in reading order)
 * @param currentLineItems - Text items for the current line
 * @param currentLineIndex - Index of the current line
 * @returns true if the text is likely a title
 */
function detectTitleFromPDFWithComparison(
  text: string, 
  allTextItems: TextItemWithSize[], 
  currentLineItems: TextItemWithSize[],
  currentLineIndex: number
): boolean {
  if (currentLineItems.length === 0 || allTextItems.length === 0) return false;

  // Get font size from the first item in current line (assuming uniform font size per line)
  const currentLineItem = currentLineItems[0];
  if (!currentLineItem.transform || currentLineItem.transform.length < 4) return false;
  const currentLineFontSize = Math.abs(currentLineItem.transform[3]); // scaleY represents font size

  // Check if there's a next item in allTextItems using the currentLineIndex
  if (currentLineIndex + 1 >= allTextItems.length) {
    return false; // No next item to compare
  }

  // Get the next text item (which should be from the next line)
  const nextLineItem = allTextItems[currentLineIndex + 1];
  if (!nextLineItem.transform || nextLineItem.transform.length < 4) return false;
  const nextLineFontSize = Math.abs(nextLineItem.transform[3]);

  // Simple comparison: current line font size is larger than next line
  const isLargerThanNext = currentLineFontSize > nextLineFontSize;
  const isReasonableLength = text.length < 150; // Reasonable title length

  // console.log(`Title detection: current=${currentLineFontSize}, next=${nextLineFontSize}, larger=${isLargerThanNext}, text="${text.substring(0, 30)}..."`);

  return isLargerThanNext && isReasonableLength;
}

/**
 * Detects if text is likely a title using heuristics (for non-PDF formats)
 */
function detectTitleHeuristic(text: string): boolean {
  const trimmed = text.trim();
  
  // Heuristics for title detection:
  // 1. All caps and longer than 2 characters
  // 2. Short text (< 100 chars) that starts with capital and has multiple capitals
  // 3. Starts with common title words
  // 4. Centered or isolated short text
  
  const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length > 2;
  const isShort = trimmed.length < 100;
  const hasMultipleCapitals = (trimmed.match(/[A-Z]/g) || []).length >= 3;
  const startsWithTitleWord = /^(Chapter|Section|Part|Book|Volume|Unit|Lesson|Introduction|Conclusion|Abstract|Summary|References|Bibliography)\s+/i.test(trimmed);
  const isNumberedTitle = /^(Chapter|Section|Part)\s+\d+/i.test(trimmed);
  
  return isAllCaps || 
         (isShort && hasMultipleCapitals) || 
         startsWithTitleWord || 
         isNumberedTitle;
}

// =============================================================================
// PUBLIC FUNCTIONS
// =============================================================================

/**
 * Apply block-level preprocessing rules to a sentence
 * These rules have access to font and position information
 * 
 * @param sentence - The sentence to preprocess
 * @param context - Context information for rule application
 * @returns The preprocessed sentence
 */
export function applyBlockLevelRules(
  sentence: string, 
  context: PreprocessingContext = {}
): string {
  // Get enabled block-level rules sorted by priority
  const enabledRules = BLOCK_LEVEL_RULES
    .filter(rule => rule.enabled)
    .sort((a, b) => a.priority - b.priority);

  let processedSentence = sentence;

  for (const rule of enabledRules) {
    try {
      const before = processedSentence;
      processedSentence = rule.apply(processedSentence, context);
      
      // Log significant changes for debugging
      if (before !== processedSentence && before.trim() !== processedSentence.trim()) {
        console.log(`TTS Block Rule "${rule.name}": "${before}" → "${processedSentence}"`);
      }
    } catch (error) {
      console.warn(`Error applying TTS block-level rule "${rule.name}":`, error);
      // Continue with other rules even if one fails
    }
  }

  return processedSentence;
}

/**
 * Apply page-level preprocessing rules to text
 * These rules work on the full text without position requirements
 * 
 * @param text - The text to preprocess
 * @param context - Context information for rule application
 * @returns The preprocessed text
 */
export function applyPageLevelRules(
  text: string, 
  context: PreprocessingContext = {}
): string {
  // Get enabled page-level rules sorted by priority
  const enabledRules = PAGE_LEVEL_RULES
    .filter(rule => rule.enabled)
    .sort((a, b) => a.priority - b.priority);

  let processedText = text;

  for (const rule of enabledRules) {
    try {
      const before = processedText;
      processedText = rule.apply(processedText, context);
      
      // Log significant changes for debugging
      if (before !== processedText && before.trim() !== processedText.trim()) {
        console.log(`TTS Page Rule "${rule.name}": Applied to full text`);
      }
    } catch (error) {
      console.warn(`Error applying TTS page-level rule "${rule.name}":`, error);
      // Continue with other rules even if one fails
    }
  }

  return processedText;
}

/**
 * Apply all enabled preprocessing rules to a sentence (backwards compatibility)
 * 
 * @param sentence - The sentence to preprocess
 * @param context - Context information for rule application
 * @returns The preprocessed sentence
 */
export function applyPreprocessingRules(
  sentence: string, 
  context: PreprocessingContext = {}
): string {
  // Get enabled rules sorted by priority
  const enabledRules = ALL_RULES
    .filter(rule => rule.enabled)
    .sort((a, b) => a.priority - b.priority);

  let processedSentence = sentence;

  for (const rule of enabledRules) {
    try {
      const before = processedSentence;
      processedSentence = rule.apply(processedSentence, context);
      
      // Log significant changes for debugging
      if (before !== processedSentence && before.trim() !== processedSentence.trim()) {
        console.log(`TTS Rule "${rule.name}": "${before}" → "${processedSentence}"`);
      }
    } catch (error) {
      console.warn(`Error applying TTS preprocessing rule "${rule.name}":`, error);
      // Continue with other rules even if one fails
    }
  }

  return processedSentence;
}

/**
 * Get all available preprocessing rules (for settings/configuration)
 */
export function getAllPreprocessingRules(): PreprocessingRule[] {
  return [...ALL_RULES];
}

/**
 * Get block-level preprocessing rules
 */
export function getBlockLevelRules(): PreprocessingRule[] {
  return [...BLOCK_LEVEL_RULES];
}

/**
 * Get page-level preprocessing rules
 */
export function getPageLevelRules(): PreprocessingRule[] {
  return [...PAGE_LEVEL_RULES];
}

/**
 * Enable or disable a specific preprocessing rule
 */
export function setRuleEnabled(ruleName: string, enabled: boolean): void {
  const rule = ALL_RULES.find(r => r.name === ruleName);
  if (rule) {
    rule.enabled = enabled;
  }
}

/**
 * Process an array of sentences with preprocessing rules
 * 
 * @param sentences - Array of sentences to preprocess
 * @param context - Context information for rule application
 * @returns Array of preprocessed sentences
 */
export function preprocessSentences(
  sentences: string[], 
  context: PreprocessingContext = {}
): string[] {
  return sentences.map((sentence, index) => 
    applyPreprocessingRules(sentence, {
      ...context,
      currentSentenceIndex: index,
      totalSentences: sentences.length
    })
  );
}