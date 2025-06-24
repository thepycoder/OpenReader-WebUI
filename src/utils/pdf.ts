import { pdfjs } from 'react-pdf';
import stringSimilarity from 'string-similarity';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import "core-js/proposals/promise-with-resolvers";
import { processTextToSentences, type PreprocessingContext } from '@/utils/nlp';
import type { TextItemWithSize } from '@/utils/tts-preprocessing';
import { applyBlockLevelRules, applyPageLevelRules } from '@/utils/tts-preprocessing';

// Function to detect if we need to use legacy build
function shouldUseLegacyBuild() {
  try {
    if (typeof window === 'undefined') return false;
    
    const ua = window.navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    
    console.log(isSafari ? 'Running on Safari' : 'Not running on Safari');
    if (!isSafari) return false;
    
    // Extract Safari version - matches "Version/18" format
    const match = ua.match(/Version\/(\d+)/i);
    console.log('Safari version:', match);
    if (!match || !match[1]) return true; // If we can't determine version, use legacy to be safe
    
    const version = parseInt(match[1]);
    return version < 18; // Use legacy build for Safari versions equal or below 18
  } catch (e) {
    console.error('Error detecting Safari version:', e);
    return false;
  }
}

// Function to initialize PDF worker
function initPDFWorker() {
  try {
    if (typeof window !== 'undefined') {
      const useLegacy = shouldUseLegacyBuild();
      // Use local worker file instead of unpkg
      const workerSrc = useLegacy 
        ? new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
        : new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      console.log('Setting PDF worker to:', workerSrc);
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      pdfjs.GlobalWorkerOptions.workerPort = null;
    }
  } catch (e) {
    console.error('Error setting PDF worker:', e);
  }
}

// Initialize the worker
initPDFWorker();

interface TextMatch {
  elements: HTMLElement[];
  rating: number;
  text: string;
  lengthDiff: number;
}

/**
 * Preprocesses a line of text based on its constituent text items
 * This is where block-level TTS preprocessing happens at the granular level
 * 
 * @param lineText - The assembled line text
 * @param lineItems - The text items that make up this line
 * @param allPageTextItems - All text items from the entire page for context-aware processing
 * @param lineIndex - Index of this line in the page (for comparing with adjacent lines)
 * @returns Preprocessed line text
 */
function preprocessLineForTTS(
  lineText: string, 
  lineItems: TextItemWithSize[],
  allPageTextItems: TextItemWithSize[],
  lineIndex: number
): string {
  if (!lineText.trim()) return lineText;

  // Create preprocessing context with page-wide information
  const context: PreprocessingContext = {
    documentType: 'pdf',
    textItems: allPageTextItems, // All page items for context-aware processing
    originalText: lineText,
    currentLineItems: lineItems, // Current line items for specific analysis
    currentLineIndex: lineIndex // Line position for comparison with adjacent lines
  };

  // Apply block-level preprocessing rules to this specific line
  const preprocessedLine = applyBlockLevelRules(lineText, context);
  
  return preprocessedLine;
}

// Text Processing functions
export async function extractTextFromPDF(
  pdf: PDFDocumentProxy, 
  pageNumber: number, 
  margins = { header: 0.07, footer: 0.07, left: 0.07, right: 0.07 }
): Promise<{ text: string; textItems: TextItemWithSize[] }> {
  try {
    // Log pdf worker version
    //console.log('PDF worker version:', pdfjs.GlobalWorkerOptions.workerSrc);

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height;
    const pageWidth = viewport.width;

    const textItems = textContent.items.filter((item): item is TextItem => {
      if (!('str' in item && 'transform' in item)) return false;
      
      const [scaleX, skewX, skewY, scaleY, x, y] = item.transform;
      
      // Basic text filtering
      if (Math.abs(scaleX) < 1 || Math.abs(scaleX) > 20) return false;
      if (Math.abs(scaleY) < 1 || Math.abs(scaleY) > 20) return false;
      if (Math.abs(skewX) > 0.5 || Math.abs(skewY) > 0.5) return false;
      
      // Calculate margins in PDF coordinate space (y=0 is at bottom)
      const headerY = pageHeight * (1 - margins.header); // Convert from top margin to bottom-based Y
      const footerY = pageHeight * margins.footer; // Footer Y stays as is since it's already bottom-based
      const leftX = pageWidth * margins.left;
      const rightX = pageWidth * (1 - margins.right);
      
      // Check margins - remember y=0 is at bottom of page in PDF coordinates
      if (y > headerY || y < footerY) { // Y greater than headerY means it's in header area, less than footerY means footer area
        return false;
      }

      // Check horizontal margins
      if (x < leftX || x > rightX) {
        return false;
      }
      
      // Sanity check for coordinates
      if (x < 0 || x > pageWidth) return false;
      
      return item.str.trim().length > 0;
    });

    // Create enhanced text items with font size information
    const enhancedTextItems: TextItemWithSize[] = textItems.map(item => ({
      ...item,
      fontSize: Math.abs(item.transform[3]), // scaleY represents font size
      isBold: Math.abs(item.transform[0]) > Math.abs(item.transform[3]) // scaleX > scaleY might indicate bold
    }));

    //console.log('Filtered text items:', textItems);

    const tolerance = 2;
    const lines: TextItemWithSize[][] = [];
    let currentLine: TextItemWithSize[] = [];
    let currentY: number | null = null;

    enhancedTextItems.forEach((item) => {
      const y = item.transform[5];
      if (currentY === null) {
        currentY = y;
        currentLine.push(item);
      } else if (Math.abs(y - currentY) < tolerance) {
        currentLine.push(item);
      } else {
        lines.push(currentLine);
        currentLine = [item];
        currentY = y;
      }
    });
    lines.push(currentLine);

    let pageText = '';
    for (const line of lines) {
      line.sort((a, b) => a.transform[4] - b.transform[4]);
      let lineText = '';
      let prevItem: TextItemWithSize | null = null;

      for (const item of line) {
        if (!prevItem) {
          lineText = item.str;
        } else {
          const prevEndX = prevItem.transform[4] + (prevItem.width ?? 0);
          const currentStartX = item.transform[4];
          const space = currentStartX - prevEndX;
          
          // Get average character width as fallback
          const avgCharWidth = (item.width ?? 0) / Math.max(1, item.str.length);
          
          // Multiple conditions for space detection
          const needsSpace = 
              // Primary check: significant gap between items
              space > Math.max(avgCharWidth * 0.3, 2) ||
              // Secondary check: natural word boundary
              (!/^\W/.test(item.str) && !/\W$/.test(prevItem.str)) ||
              // Tertiary check: items are far enough apart relative to their size
              (space > ((prevItem.width ?? 0) * 0.25));

          if (needsSpace) {
              lineText += ' ' + item.str;
          } else {
              lineText += item.str;
          }
        }
        prevItem = item;
      }
      
      // Apply TTS preprocessing to this line before adding to page text
      const preprocessedLine = preprocessLineForTTS(lineText, line, enhancedTextItems, lines.indexOf(line));
      pageText += preprocessedLine + ' ';
    }
  
    // Apply page-level preprocessing rules to the final assembled text
    const preprocessingContext: PreprocessingContext = {
      documentType: 'pdf',
      textItems: enhancedTextItems,
      originalText: pageText
    };
    
    const pageProcessedText = applyPageLevelRules(pageText.replace(/\s+/g, ' ').trim(), preprocessingContext);
    const finalText = pageProcessedText;
    
    return { text: finalText, textItems: enhancedTextItems };
    
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw error;
  }
}

// Highlighting functions
export function clearHighlights() {
  const textNodes = document.querySelectorAll('.react-pdf__Page__textContent span');
  textNodes.forEach((node) => {
    const element = node as HTMLElement;
    element.style.backgroundColor = '';
    element.style.opacity = '1';
  });
}

export function findBestTextMatch(
  elements: Array<{ element: HTMLElement; text: string }>,
  targetText: string,
  maxCombinedLength: number
): TextMatch {
  let bestMatch = {
    elements: [] as HTMLElement[],
    rating: 0,
    text: '',
    lengthDiff: Infinity,
  };

  const SPAN_SEARCH_LIMIT = 10;

  for (let i = 0; i < elements.length; i++) {
    let combinedText = '';
    const currentElements = [];
    for (let j = i; j < Math.min(i + SPAN_SEARCH_LIMIT, elements.length); j++) {
      const node = elements[j];
      const newText = combinedText ? `${combinedText} ${node.text}` : node.text;
      if (newText.length > maxCombinedLength) break;

      combinedText = newText;
      currentElements.push(node.element);

      const similarity = stringSimilarity.compareTwoStrings(targetText, combinedText);
      const lengthDiff = Math.abs(combinedText.length - targetText.length);
      const lengthPenalty = lengthDiff / targetText.length;
      const adjustedRating = similarity * (1 - lengthPenalty * 0.5);

      if (adjustedRating > bestMatch.rating) {
        bestMatch = {
          elements: [...currentElements],
          rating: adjustedRating,
          text: combinedText,
          lengthDiff,
        };
      }
    }
  }

  return bestMatch;
}

export function highlightPattern(
  text: string,
  pattern: string,
  containerRef: React.RefObject<HTMLDivElement>,
  margins = { header: 0.07, footer: 0.07, left: 0.07, right: 0.07 }
) {
  clearHighlights();

  if (!pattern?.trim()) return;

  const cleanPattern = pattern.trim().replace(/\s+/g, ' ');
  const container = containerRef.current;
  if (!container) return;

  // Find the page element to get page dimensions
  const pageElement = container.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement;
  if (!pageElement) return;

  const pageRect = pageElement.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  
  // Calculate margin boundaries in DOM coordinates (y=0 at top)
  const pageWidth = pageRect.width;
  const pageHeight = pageRect.height;
  const headerMargin = pageHeight * margins.header; // From top
  const footerMargin = pageHeight * margins.footer; // From bottom
  const leftMargin = pageWidth * margins.left;
  const rightMargin = pageWidth * margins.right;

  const textNodes = container.querySelectorAll('.react-pdf__Page__textContent span');
  const allText = Array.from(textNodes).map((node) => {
    const element = node as HTMLElement;
    const text = (element.textContent || '').trim();
    return { element, text };
  }).filter((node) => {
    if (node.text.length === 0) return false;
    
    // Get element position relative to the page
    const elementRect = node.element.getBoundingClientRect();
    const relativeToPage = {
      top: elementRect.top - pageRect.top,
      left: elementRect.left - pageRect.left,
      bottom: elementRect.bottom - pageRect.top,
      right: elementRect.right - pageRect.left
    };
    
    // Check if element is within margin boundaries
    // Top margin check (header)
    if (relativeToPage.top < headerMargin) return false;
    
    // Bottom margin check (footer) 
    if (relativeToPage.bottom > (pageHeight - footerMargin)) return false;
    
    // Left margin check
    if (relativeToPage.left < leftMargin) return false;
    
    // Right margin check  
    if (relativeToPage.right > (pageWidth - rightMargin)) return false;
    
    return true;
  });

  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + containerRect.height;
  const bufferSize = containerRect.height;

  const visibleNodes = allText.filter(({ element }) => {
    const rect = element.getBoundingClientRect();
    const elementTop = rect.top - containerRect.top + container.scrollTop;
    return elementTop >= (visibleTop - bufferSize) && elementTop <= (visibleBottom + bufferSize);
  });

  let bestMatch = findBestTextMatch(visibleNodes, cleanPattern, cleanPattern.length * 2);

  if (bestMatch.rating < 0.3) {
    bestMatch = findBestTextMatch(allText, cleanPattern, cleanPattern.length * 2);
  }

  const similarityThreshold = bestMatch.lengthDiff < cleanPattern.length * 0.3 ? 0.3 : 0.5;

  if (bestMatch.rating >= similarityThreshold) {
    bestMatch.elements.forEach((element) => {
      element.style.backgroundColor = 'grey';
      element.style.opacity = '0.4';
    });

    if (bestMatch.elements.length > 0) {
      const element = bestMatch.elements[0];
      const elementRect = element.getBoundingClientRect();
      const elementTop = elementRect.top - containerRect.top + container.scrollTop;

      if (elementTop < visibleTop || elementTop > visibleBottom) {
        container.scrollTo({
          top: elementTop - containerRect.height / 3,
          behavior: 'smooth',
        });
      }
    }
  }
}

/**
 * Finds the most specific sentence that contains the clicked text
 * Uses word boundaries and position weighting for better precision
 * 
 * @param {string} clickedText - The text that was clicked
 * @param {string[]} sentences - Array of processed sentences
 * @param {number} contextMatchIndex - Index of the sentence that matched the context
 * @returns {Object} Object containing the best sentence match and its index
 */
function findClickedSentence(
  clickedText: string,
  sentences: string[],
  contextMatchIndex: number
): { sentence: string; index: number; confidence: number } {
  let bestMatch = { sentence: sentences[contextMatchIndex], index: contextMatchIndex, confidence: 0 };
  
  // Define search range around the context match (±2 sentences)
  const searchStart = Math.max(0, contextMatchIndex - 2);
  const searchEnd = Math.min(sentences.length - 1, contextMatchIndex + 2);
  
  for (let i = searchStart; i <= searchEnd; i++) {
    const sentence = sentences[i];
    const clickedLower = clickedText.toLowerCase().trim();
    const sentenceLower = sentence.toLowerCase();
    
    let confidence = 0;
    
    // Check for exact word match (highest priority)
    const clickedWords = clickedLower.split(/\s+/);
    const sentenceWords = sentenceLower.split(/\s+/);
    
    let exactWordMatches = 0;
    for (const clickedWord of clickedWords) {
      if (clickedWord.length > 2) { // Skip very short words
        for (const sentenceWord of sentenceWords) {
          if (sentenceWord.includes(clickedWord) || clickedWord.includes(sentenceWord)) {
            exactWordMatches++;
            break;
          }
        }
      }
    }
    
    if (exactWordMatches > 0) {
      confidence += (exactWordMatches / clickedWords.length) * 0.4;
    }
    
    // Check for substring containment
    if (sentenceLower.includes(clickedLower)) {
      confidence += 0.3;
    } else if (clickedLower.includes(sentenceLower.trim())) {
      confidence += 0.2;
    }
    
    // String similarity
    const similarity = stringSimilarity.compareTwoStrings(clickedText, sentence);
    confidence += similarity * 0.3;
    
    // Position bonus (prefer sentences closer to context match)
    const positionBonus = 1 - (Math.abs(i - contextMatchIndex) * 0.1);
    confidence *= positionBonus;
    
    if (confidence > bestMatch.confidence) {
      bestMatch = { sentence, index: i, confidence };
    }
  }
  
  return bestMatch;
}

// Text Click Handler
export function handleTextClick(
  event: MouseEvent,
  pdfText: string,
  containerRef: React.RefObject<HTMLDivElement>,
  stopAndPlayFromIndex: (index: number) => void,
  isProcessing: boolean,
  margins = { header: 0.07, footer: 0.07, left: 0.07, right: 0.07 }
) {
  if (isProcessing) return;

  const target = event.target as HTMLElement;
  if (!target.matches('.react-pdf__Page__textContent span')) return;

  const parentElement = target.closest('.react-pdf__Page__textContent');
  if (!parentElement) return;

  const spans = Array.from(parentElement.querySelectorAll('span'));
  const clickedIndex = spans.indexOf(target);
  const contextWindow = 3;
  
  // Get the clicked text for precise matching
  const clickedText = (target.textContent || '').trim();
  if (!clickedText) return;
  
  // Get context window for robust matching
  const startIndex = Math.max(0, clickedIndex - contextWindow);
  const endIndex = Math.min(spans.length - 1, clickedIndex + contextWindow);
  const contextText = spans
    .slice(startIndex, endIndex + 1)
    .map((span) => span.textContent)
    .join(' ')
    .trim();

  if (!contextText?.trim()) return;

  const cleanContext = contextText.trim().replace(/\s+/g, ' ');
  const allText = Array.from(parentElement.querySelectorAll('span')).map((node) => ({
    element: node as HTMLElement,
    text: (node.textContent || '').trim(),
  })).filter((node) => node.text.length > 0);

  // Use context for robust matching
  const bestMatch = findBestTextMatch(allText, cleanContext, cleanContext.length * 2);
  const similarityThreshold = bestMatch.lengthDiff < cleanContext.length * 0.3 ? 0.3 : 0.5;

  if (bestMatch.rating >= similarityThreshold) {
    const matchText = bestMatch.text;
    // Use the same sentence processing logic as TTSContext for consistency
    const sentences = processTextToSentences(pdfText);
    console.log("sentences inside handleTextClick: %d", sentences.length);
    
    // Find the best sentence match using the context
    let bestSentenceMatch = { sentence: '', rating: 0, index: -1 };

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const rating = stringSimilarity.compareTwoStrings(matchText, sentence);
      if (rating > bestSentenceMatch.rating) {
        bestSentenceMatch = { sentence, rating, index: i };
      }
    }

    if (bestSentenceMatch.rating >= 0.5) {
      // Use the new helper function to find the most specific sentence
      const clickedSentenceMatch = findClickedSentence(
        clickedText,
        sentences,
        bestSentenceMatch.index
      );
      
      console.log(`Context matched sentence ${bestSentenceMatch.index}, clicked text matched sentence ${clickedSentenceMatch.index} with confidence ${clickedSentenceMatch.confidence}`);
      
      // Use the clicked sentence match if it has reasonable confidence
      const targetSentenceIndex = clickedSentenceMatch.confidence > 0.2 
        ? clickedSentenceMatch.index 
        : bestSentenceMatch.index;
      const targetSentence = sentences[targetSentenceIndex];
      
      // Play the specific sentence that was clicked
      stopAndPlayFromIndex(targetSentenceIndex);
      
      // Highlight only the target sentence, not the entire context
      highlightPattern(pdfText, targetSentence, containerRef, margins);
    }
  }
}

// Debounce for PDF viewer
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
