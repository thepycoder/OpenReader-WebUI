/**
 * Natural Language Processing Utilities
 * 
 * This module provides consistent sentence processing functionality across the application.
 * It handles text preprocessing, sentence splitting, and block creation for optimal TTS processing.
 */

import nlp from 'compromise';
import type { PDFBlock } from '@/types/pdfStructure';
import type { TTSBlockChunk } from '@/types/tts';

const MAX_BLOCK_LENGTH = 450;

/**
 * Preprocesses text for audio generation by cleaning up various text artifacts
 * 
 * @param {string} text - The text to preprocess
 * @returns {string} The cleaned text
 */
export const preprocessSentenceForAudio = (text: string): string => {
  return text
    .replace(/\S*(?:https?:\/\/|www\.)([^\/\s]+)(?:\/\S*)?/gi, '- (link to $1) -')
    .replace(/(\w+)-\s+(\w+)/g, '$1$2') // Remove hyphenation
    // Remove special character *
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Splits text into sentences and groups them into blocks suitable for TTS processing
 * 
 * @param {string} text - The text to split into sentences
 * @returns {string[]} Array of sentence blocks
 */
export const splitIntoSentences = (text: string): string[] => {
  // Normalize line breaks: 
  // - Double+ newlines = paragraph break (keep as separator)
  // - Single newlines = soft line wrap (replace with space)
  const normalizedText = text
    .replace(/\n{2,}/g, '\n\n')  // Normalize multiple newlines to exactly 2
    .replace(/(?<!\n)\n(?!\n)/g, ' '); // Replace single newlines with space
  
  const paragraphs = normalizedText.split(/\n\n+/);
  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const cleanedText = preprocessSentenceForAudio(paragraph);
    const doc = nlp(cleanedText);
    const rawSentences = doc.sentences().out('array') as string[];
    
    // Merge multi-sentence dialogue enclosed in quotes into single items
    const mergedSentences = mergeQuotedDialogue(rawSentences);

    let currentBlock = '';

    for (const sentence of mergedSentences) {
      const trimmedSentence = sentence.trim();

      if (currentBlock && (currentBlock.length + trimmedSentence.length + 1) > MAX_BLOCK_LENGTH) {
        blocks.push(currentBlock.trim());
        currentBlock = trimmedSentence;
      } else {
        currentBlock = currentBlock 
          ? `${currentBlock} ${trimmedSentence}`
          : trimmedSentence;
      }
    }

    if (currentBlock) {
      blocks.push(currentBlock.trim());
    }
  }
  
  return blocks;
};

/**
 * Main sentence processing function that handles both short and long texts
 * 
 * @param {string} text - The text to process
 * @returns {string[]} Array of processed sentences/blocks
 */
export const processTextToSentences = (text: string): string[] => {
  if (!text || text.length < 1) {
    return [];
  }

  // Always use the full splitting logic so we consistently respect
  // sentence boundaries and quoted dialogue, even for shorter texts.
  return splitIntoSentences(text);
};

/**
 * Processes a PDF block into TTS chunks.
 * - If block text < MAX_BLOCK_LENGTH, returns a single chunk
 * - If longer, splits into sentences using existing logic
 * 
 * @param {PDFBlock} block - The PDF block to process
 * @param {number} blockIndex - Index of this block in globalReadingOrder
 * @param {number} pageNumber - Page number where this block appears
 * @returns {TTSBlockChunk[]} Array of TTS chunks for this block
 */
export const processBlockToChunks = (
  block: PDFBlock,
  blockIndex: number,
  pageNumber: number
): TTSBlockChunk[] => {
  const text = block.text?.trim() || '';
  
  if (!text) {
    return [];
  }

  const cleanedText = preprocessSentenceForAudio(text);
  
  if (!cleanedText) {
    return [];
  }

  // Log block details
  console.log(`[Block ${blockIndex}] Processing block:`, {
    blockId: block.id,
    type: block.type,
    page: pageNumber,
    textLength: text.length,
    cleanedLength: cleanedText.length,
    bbox: block.bbox,
    fontSize: block.fontSize,
    fontName: block.fontName,
    fullText: text, // Full original text
    cleanedText: cleanedText, // Full cleaned text
  });

  // Short blocks become a single chunk
  if (cleanedText.length <= MAX_BLOCK_LENGTH) {
    return [{
      blockId: block.id,
      blockIndex,
      chunkIndex: 0,
      totalChunksInBlock: 1,
      text: cleanedText,
      pageNumber,
    }];
  }

  // Longer blocks get split into sentences/chunks
  const sentences = splitIntoSentences(text);
  
  if (sentences.length === 0) {
    // Fallback: if splitting produces nothing, return the whole text as one chunk
    return [{
      blockId: block.id,
      blockIndex,
      chunkIndex: 0,
      totalChunksInBlock: 1,
      text: cleanedText,
      pageNumber,
    }];
  }

  return sentences.map((sentenceText, idx) => ({
    blockId: block.id,
    blockIndex,
    chunkIndex: idx,
    totalChunksInBlock: sentences.length,
    text: sentenceText,
    pageNumber,
  }));
};

/**
 * Processes multiple PDF blocks into a flattened array of TTS chunks.
 * Each block is processed individually - no aggregation between blocks.
 * 
 * @param {PDFBlock[]} blocks - Array of PDF blocks to process
 * @param {number[]} blockIndices - Global reading order indices for each block
 * @param {number[]} pageNumbers - Page numbers for each block
 * @returns {TTSBlockChunk[]} Flattened array of all TTS chunks
 */
export const processBlocksToChunks = (
  blocks: PDFBlock[],
  blockIndices: number[],
  pageNumbers: number[]
): TTSBlockChunk[] => {
  const allChunks: TTSBlockChunk[] = [];
  
  // Process each block individually - 1:1 mapping (block may split into chunks if long)
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockIndex = blockIndices[i];
    const pageNumber = pageNumbers[i];
    
    const chunks = processBlockToChunks(block, blockIndex, pageNumber);
    allChunks.push(...chunks);
  }
  
  return allChunks;
};

/**
 * Gets raw sentences from text without preprocessing or grouping
 * This is useful for text matching and highlighting
 * 
 * @param {string} text - The text to extract sentences from
 * @returns {string[]} Array of raw sentences
 */
export const getRawSentences = (text: string): string[] => {
  if (!text || text.length < 1) {
    return [];
  }
  
  return nlp(text).sentences().out('array') as string[];
};

/**
 * Enhanced sentence processing that returns both processed sentences and raw sentences
 * This allows for better mapping between the two for click-to-highlight functionality
 * 
 * @param {string} text - The text to process
 * @returns {Object} Object containing processed sentences and raw sentences with mapping
 */
export const processTextWithMapping = (text: string): {
  processedSentences: string[];
  rawSentences: string[];
  sentenceMapping: Array<{ processedIndex: number; rawIndices: number[] }>;
} => {
  const rawSentences = getRawSentences(text);
  const processedSentences = processTextToSentences(text);
  
  // Create a mapping between processed sentences and raw sentences
  const sentenceMapping: Array<{ processedIndex: number; rawIndices: number[] }> = [];
  
  // For simple mapping, we'll track which raw sentences contributed to each processed sentence
  let rawIndex = 0;
  
  for (let processedIndex = 0; processedIndex < processedSentences.length; processedIndex++) {
    const processedSentence = processedSentences[processedIndex];
    const rawIndices: number[] = [];
    
    // Find which raw sentences are contained in this processed sentence
    const remainingText = processedSentence;
    
    while (rawIndex < rawSentences.length && remainingText.length > 0) {
      const rawSentence = rawSentences[rawIndex];
      const cleanedRawSentence = preprocessSentenceForAudio(rawSentence);
      
      if (remainingText.includes(cleanedRawSentence) || cleanedRawSentence.includes(remainingText)) {
        rawIndices.push(rawIndex);
        rawIndex++;
        break;
      } else {
        rawIndex++;
      }
    }
    
    sentenceMapping.push({ processedIndex, rawIndices });
  }
  
  return {
    processedSentences,
    rawSentences,
    sentenceMapping
  };
}; 
// Helper functions to merge quoted dialogue across sentences
const countDoubleQuotes = (s: string): number => {
  const matches = s.match(/["“”]/g);
  return matches ? matches.length : 0;
};

// Replace the old curly single-quote counter and standalone-straight counter with a unified, context-aware counter
const countNonApostropheSingleQuotes = (s: string): number => {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '‘' || ch === '’') {
      const prev = i > 0 ? s[i - 1] : '';
      const next = i + 1 < s.length ? s[i + 1] : '';
      const isPrevAlphaNum = /[A-Za-z0-9]/.test(prev);
      const isNextAlphaNum = /[A-Za-z0-9]/.test(next);
      // Treat as a real quote mark only when it's not clearly an apostrophe
      // between two alphanumeric characters (e.g., don't, WizardLM’s).
      if (!(isPrevAlphaNum && isNextAlphaNum)) {
        count++;
      }
    }
  }
  return count;
};

const mergeQuotedDialogue = (rawSentences: string[]): string[] => {
  const result: string[] = [];
  let buffer = '';
  let insideDouble = false;
  let insideSingle = false;

  for (const s of rawSentences) {
    const t = s.trim();
    const dblCount = countDoubleQuotes(t);
    // Use the new context-aware single-quote counter so curly apostrophes
    // inside words don't incorrectly toggle quote state and merge large
    // regions of plain prose into one block.
    const singleCount = countNonApostropheSingleQuotes(t);

    if (insideDouble || insideSingle) {
      buffer = buffer ? `${buffer} ${t}` : t;
    } else {
      // Start buffering if this sentence opens an unclosed quote
      if ((dblCount % 2 === 1) || (singleCount % 2 === 1)) {
        buffer = t;
      } else {
        result.push(t);
      }
    }

    // Toggle quote states after processing this sentence
    if (dblCount % 2 === 1) insideDouble = !insideDouble;
    if (singleCount % 2 === 1) insideSingle = !insideSingle;

    // If all open quotes are closed, flush buffer
    if (!(insideDouble || insideSingle) && buffer) {
      result.push(buffer);
      buffer = '';
    }
  }

  if (buffer) {
    result.push(buffer);
  }

  return result;
};