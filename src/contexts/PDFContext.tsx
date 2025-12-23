/**
 * PDF Context Provider
 * 
 * This module provides a React context for managing PDF document functionality.
 * It handles document loading, text extraction, highlighting, and integration with TTS.
 * 
 * Key features:
 * - PDF document management (add/remove/load)
 * - Text extraction and processing
 * - Text highlighting and navigation
 * - Document state management
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
  useMemo,
  RefObject,
  useRef,
} from 'react';

import type { PDFDocumentProxy } from 'pdfjs-dist';

import { getPdfDocument } from '@/lib/dexie';
import { useTTS } from '@/contexts/TTSContext';
import { useConfig } from '@/contexts/ConfigContext';
import { processTextToSentences, processBlocksToChunks } from '@/lib/nlp';
import { withRetry, getAudiobookStatus, generateTTS, createAudiobookChapter } from '@/lib/client';
import {
  extractTextFromPDF,
  extractTextFromPageWithStructure,
  highlightPattern,
  clearHighlights,
  clearWordHighlights,
  highlightWordIndex,
} from '@/lib/pdf';
import { getPdfStructure, getPdfFilter, getAppConfig } from '@/lib/dexie';
import type { PDFStructure, PDFBlock, PDFElementFilter } from '@/types/pdfStructure';
import type { TTSBlockChunk } from '@/types/tts';

import type {
  TTSSentenceAlignment,
  TTSAudioBuffer,
  TTSAudiobookFormat,
  TTSAudiobookChapter,
} from '@/types/tts';
import type {
  TTSRequestHeaders,
  TTSRequestPayload,
  TTSRetryOptions,
} from '@/types/client';

/**
 * Interface defining all available methods and properties in the PDF context
 */
interface PDFContextType {
  // Current document state
  currDocData: ArrayBuffer | undefined;
  currDocName: string | undefined;
  currDocPages: number | undefined;
  currDocPage: number;
  currDocText: string | undefined;
  pdfDocument: PDFDocumentProxy | undefined;
  pdfStructure: PDFStructure | null;
  setCurrentDocument: (id: string) => Promise<void>;
  clearCurrDoc: () => void;

  // PDF functionality
  onDocumentLoadSuccess: (pdf: PDFDocumentProxy) => void;
  highlightPattern: (
    text: string,
    pattern: string,
    containerRef: RefObject<HTMLDivElement>,
    blockBbox?: [number, number, number, number],
    pageNumber?: number
  ) => void;
  clearHighlights: () => void;
  clearWordHighlights: () => void;
  highlightWordIndex: (
    alignment: TTSSentenceAlignment | undefined,
    wordIndex: number | null | undefined,
    sentence: string | null | undefined,
    containerRef: RefObject<HTMLDivElement>
  ) => void;
  createFullAudioBook: (onProgress: (progress: number) => void, signal?: AbortSignal, onChapterComplete?: (chapter: TTSAudiobookChapter) => void, bookId?: string, format?: TTSAudiobookFormat) => Promise<string>;
  regenerateChapter: (chapterIndex: number, bookId: string, format: TTSAudiobookFormat, signal: AbortSignal) => Promise<TTSAudiobookChapter>;
  isAudioCombining: boolean;
  
  // Block-based TTS
  requestMoreBlocks: () => void;
  jumpToBlock: (blockId: string) => void;
}

// Create the context
const PDFContext = createContext<PDFContextType | undefined>(undefined);

const CONTINUATION_PREVIEW_CHARS = 600;
// Number of blocks to prefetch for TTS processing
const BLOCKS_TO_PREFETCH = 15;

/**
 * PDFProvider Component
 * 
 * Main provider component that manages PDF state and functionality.
 * Handles document loading, text processing, and integration with TTS.
 * 
 * @param {Object} props - Component props
 * @param {ReactNode} props.children - Child components to be wrapped by the provider
 */
export function PDFProvider({ children }: { children: ReactNode }) {
  const { 
    setText: setTTSText,
    setBlocks: setTTSBlocks,
    registerBlockRequestHandler,
    registerBlockJumpHandler,
    stop, 
    currDocPageNumber,
    currDocPages, 
    setCurrDocPages,
    setIsEPUB,
    registerVisualPageChangeHandler,
  } = useTTS();
  const { 
    headerMargin,
    footerMargin,
    leftMargin,
    rightMargin,
    apiKey,
    baseUrl,
    voiceSpeed,
    voice,
    ttsProvider,
    ttsModel,
    ttsInstructions,
    smartSentenceSplitting,
  } = useConfig();

  // Current document state
  const [currDocData, setCurrDocData] = useState<ArrayBuffer>();
  const [currDocName, setCurrDocName] = useState<string>();
  const [currDocId, setCurrDocId] = useState<string>();
  const [currDocText, setCurrDocText] = useState<string>();
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>();
  const [pdfStructure, setPdfStructure] = useState<PDFStructure | null>(null);
  const [isAudioCombining] = useState(false);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const [currDocPage, setCurrDocPage] = useState<number>(currDocPageNumber);
  const prefetchCacheRef = useRef<Map<string, string>>(new Map());
  const currentBlockIdRef = useRef<string | null>(null);
  
  // Block-based TTS state
  const currentBlockIndexRef = useRef<number>(0); // Index in globalReadingOrder
  const loadedBlockIdsRef = useRef<Set<string>>(new Set());
  const pdfStructureRef = useRef<PDFStructure | null>(null);
  const pdfFilterRef = useRef<PDFElementFilter | null>(null);
  const structureLoadedForDocRef = useRef<string | null>(null); // Track which doc we loaded structure for
  const currDocTextRef = useRef<string | undefined>(undefined); // Track current text to avoid re-renders
  const textLoadedForPageRef = useRef<number | null>(null); // Track which page we loaded text for

  useEffect(() => {
    setCurrDocPage(currDocPageNumber);
  }, [currDocPageNumber]);

  /**
   * Load PDF structure and filter once when document ID changes
   * This is the ONLY place where we fetch structure/filter from Dexie
   */
  useEffect(() => {
    if (!currDocId || structureLoadedForDocRef.current === currDocId) {
      return; // Already loaded for this document
    }

    const loadStructureAndFilter = async () => {
      try {
        // Load structure
        const structureRow = await getPdfStructure(currDocId);
        if (structureRow?.structure) {
          pdfStructureRef.current = structureRow.structure;
          setPdfStructure(structureRow.structure);
        } else {
          pdfStructureRef.current = null;
          setPdfStructure(null);
        }

        // Load filter settings
        const appConfig = await getAppConfig();
        const globalFilter = appConfig?.pdfElementFilters || {
          enabled: false,
          excludedTypes: [],
          excludedBboxes: [],
        };

        const documentFilterRow = await getPdfFilter(currDocId);
        const useGlobalFilter = documentFilterRow?.useGlobal !== false;
        const activeFilter: PDFElementFilter = useGlobalFilter
          ? globalFilter
          : documentFilterRow?.filter || globalFilter;

        pdfFilterRef.current = activeFilter;
        structureLoadedForDocRef.current = currDocId;
      } catch (error) {
        console.error('Error loading PDF structure/filter:', error);
        pdfStructureRef.current = null;
        pdfFilterRef.current = null;
      }
    };

    loadStructureAndFilter();
  }, [currDocId]);

  /**
   * Handles successful PDF document load
   * 
   * @param {PDFDocumentProxy} pdf - The loaded PDF document proxy object
   */
  const onDocumentLoadSuccess = useCallback((pdf: PDFDocumentProxy) => {
    console.log('Document loaded:', pdf.numPages);
    setCurrDocPages(pdf.numPages);
    setPdfDocument(pdf);
  }, [setCurrDocPages]);

  /**
   * Build a map from block ID to block data with page numbers
   */
  const buildBlockMap = useCallback((structure: PDFStructure): Map<string, { block: PDFBlock; pageNumber: number }> => {
    const blockMap = new Map<string, { block: PDFBlock; pageNumber: number }>();
    for (const page of structure.pages) {
      for (const block of page.blocks) {
        blockMap.set(block.id, { block, pageNumber: page.pageNumber });
      }
    }
    return blockMap;
  }, []);

  /**
   * Filter blocks based on active filter settings
   */
  const shouldIncludeBlock = useCallback((block: PDFBlock, filter: PDFElementFilter | null): boolean => {
    if (!filter || !filter.enabled) return true;
    if (filter.excludedTypes.includes(block.type)) return false;
    if (filter.excludedBboxes?.includes(block.id)) return false;
    return true;
  }, []);

  /**
   * Load blocks from globalReadingOrder starting at a specific index
   * Returns chunks for TTS processing
   */
  const loadBlocksFromIndex = useCallback((
    startIndex: number,
    count: number,
    structure: PDFStructure,
    filter: PDFElementFilter | null
  ): { chunks: TTSBlockChunk[]; nextIndex: number; reachedEnd: boolean } => {
    const blockMap = buildBlockMap(structure);
    const globalOrder = structure.globalReadingOrder;
    
    const blocks: PDFBlock[] = [];
    const blockIndices: number[] = [];
    const pageNumbers: number[] = [];
    
    let currentIndex = startIndex;
    let blocksLoaded = 0;
    
    while (blocksLoaded < count && currentIndex < globalOrder.length) {
      const blockId = globalOrder[currentIndex];
      const blockData = blockMap.get(blockId);
      
      if (blockData) {
        const { block, pageNumber } = blockData;
        
        // Apply filter
        if (shouldIncludeBlock(block, filter) && block.text?.trim()) {
          blocks.push(block);
          blockIndices.push(currentIndex);
          pageNumbers.push(pageNumber);
          loadedBlockIdsRef.current.add(blockId);
          blocksLoaded++;
        }
      }
      
      currentIndex++;
    }
    
    const chunks = processBlocksToChunks(blocks, blockIndices, pageNumbers);
    
    return {
      chunks,
      nextIndex: currentIndex,
      reachedEnd: currentIndex >= globalOrder.length,
    };
  }, [buildBlockMap, shouldIncludeBlock]);

  /**
   * Request more blocks for TTS - called by TTSContext when queue is running low
   */
  const requestMoreBlocks = useCallback(() => {
    const structure = pdfStructureRef.current;
    if (!structure) return;
    
    const result = loadBlocksFromIndex(
      currentBlockIndexRef.current,
      BLOCKS_TO_PREFETCH,
      structure,
      pdfFilterRef.current
    );
    
    if (result.chunks.length > 0) {
      currentBlockIndexRef.current = result.nextIndex;
      setTTSBlocks(result.chunks, result.reachedEnd);
    }
  }, [loadBlocksFromIndex, setTTSBlocks]);

  /**
   * Initialize block-based TTS from a starting position
   * Uses cached structure/filter from refs (loaded when document changes)
   */
  const initializeBlockTTS = useCallback((startBlockIndex: number = 0): boolean => {
    const structure = pdfStructureRef.current;
    const filter = pdfFilterRef.current;
    
    if (!structure) {
      console.warn('No PDF structure available, falling back to page-based extraction');
      return false;
    }
    
    // Reset state
    currentBlockIndexRef.current = startBlockIndex;
    loadedBlockIdsRef.current.clear();
    
    // Load initial blocks
    const result = loadBlocksFromIndex(
      startBlockIndex,
      BLOCKS_TO_PREFETCH,
      structure,
      filter
    );
    
    if (result.chunks.length > 0) {
      currentBlockIndexRef.current = result.nextIndex;
      setTTSBlocks(result.chunks, result.reachedEnd);
      
      // Update current page based on first chunk
      const firstChunk = result.chunks[0];
      if (firstChunk) {
        setCurrDocPage(firstChunk.pageNumber);
      }
      
      return true;
    }
    
    return false;
  }, [loadBlocksFromIndex, setTTSBlocks]);

  /**
   * Jump to a specific block by its ID
   * Finds the block's index in globalReadingOrder and reinitializes TTS from there
   * 
   * @param {string} blockId - The block ID to jump to
   */
  const jumpToBlock = useCallback((blockId: string) => {
    const structure = pdfStructureRef.current;
    if (!structure) return;
    
    const globalOrder = structure.globalReadingOrder;
    const blockIndex = globalOrder.indexOf(blockId);
    
    if (blockIndex === -1) {
      console.warn('Block not found in globalReadingOrder:', blockId);
      return;
    }
    
    // Reset loading state
    textLoadedForPageRef.current = null;
    loadedBlockIdsRef.current.clear();
    
    // Initialize TTS from this block
    initializeBlockTTS(blockIndex);
  }, [initializeBlockTTS]);

  // Register the block request handler with TTS context
  useEffect(() => {
    registerBlockRequestHandler(requestMoreBlocks);
  }, [registerBlockRequestHandler, requestMoreBlocks]);

  // Register the block jump handler with TTS context
  useEffect(() => {
    registerBlockJumpHandler(jumpToBlock);
  }, [registerBlockJumpHandler, jumpToBlock]);

  /**
   * Loads and processes text from the current document page
   * Tries block-based loading first, falls back to page-based extraction
   * Uses cached structure/filter from refs
   */
  const loadCurrDocText = useCallback(async () => {
    try {
      if (!pdfDocument || !currDocName) return;

      // Skip if we already loaded for this page
      if (textLoadedForPageRef.current === currDocPageNumber) {
        return;
      }

      const structure = pdfStructureRef.current;
      const filter = pdfFilterRef.current;

      // Try block-based loading first if we have structure
      if (structure) {
        const globalOrder = structure.globalReadingOrder;
        const blockMap = buildBlockMap(structure);
        
        // Find first block on the current page
        let startIndex = 0;
        for (let i = 0; i < globalOrder.length; i++) {
          const blockId = globalOrder[i];
          const blockData = blockMap.get(blockId);
          if (blockData && blockData.pageNumber === currDocPageNumber) {
            startIndex = i;
            break;
          }
        }
        
        // Initialize block-based TTS
        const success = initializeBlockTTS(startIndex);
        if (success) {
          textLoadedForPageRef.current = currDocPageNumber;
          return;
        }
      }

      // Fallback to page-based extraction (no structure available)
      const margins = {
        header: headerMargin,
        footer: footerMargin,
        left: leftMargin,
        right: rightMargin
      };

      const getPageText = async (pageNumber: number, shouldCache = false): Promise<string> => {
        if (pageTextCacheRef.current.has(pageNumber)) {
          const cached = pageTextCacheRef.current.get(pageNumber)!;
          if (!shouldCache) {
            pageTextCacheRef.current.delete(pageNumber);
          }
          return cached;
        }

        // Use original extraction (no structure available in fallback)
        const extracted = await extractTextFromPDF(pdfDocument, pageNumber, margins);
        
        if (shouldCache) {
          pageTextCacheRef.current.set(pageNumber, extracted);
        }
        return extracted;
      };

      const totalPages = currDocPages ?? pdfDocument.numPages;
      const nextPageNumber = currDocPageNumber < totalPages ? currDocPageNumber + 1 : undefined;

      const [text, nextText] = await Promise.all([
        getPageText(currDocPageNumber),
        nextPageNumber ? getPageText(nextPageNumber, true) : Promise.resolve<string | undefined>(undefined),
      ]);

      // Update text only if it changed
      if (text !== currDocTextRef.current || text === '') {
        currDocTextRef.current = text;
        setCurrDocText(text);
        setTTSText(text, {
          location: currDocPageNumber,
          nextLocation: nextPageNumber,
          nextText: nextText?.slice(0, CONTINUATION_PREVIEW_CHARS),
        });
      }
      
      textLoadedForPageRef.current = currDocPageNumber;
    } catch (error) {
      console.error('Error loading PDF text:', error);
    }
  }, [
    pdfDocument,
    currDocPageNumber,
    currDocPages,
    setTTSText,
    currDocName,
    headerMargin,
    footerMargin,
    leftMargin,
    rightMargin,
    buildBlockMap,
    initializeBlockTTS,
  ]);

  /**
   * Effect hook to update document text when the page changes
   * Triggers text extraction and processing when either the document URL or page changes
   */
  useEffect(() => {
    if (currDocData) {
      loadCurrDocText();
    }
  }, [currDocPageNumber, currDocData, loadCurrDocText]);

  /**
   * Sets the current document based on its ID
   * Retrieves document from IndexedDB
   * 
   * @param {string} id - The unique identifier of the document to set
   * @returns {Promise<void>}
   */
  const setCurrentDocument = useCallback(async (id: string): Promise<void> => {
    try {
      const doc = await getPdfDocument(id);
      if (doc) {
        setCurrDocId(id);
        setCurrDocName(doc.name);
        setCurrDocData(doc.data);
      }
    } catch (error) {
      console.error('Failed to get document:', error);
    }
  }, []);

  /**
   * Clears the current document state
   * Resets all document-related states and stops any ongoing TTS playback
   */
  const clearCurrDoc = useCallback(() => {
    setCurrDocId(undefined);
    setCurrDocName(undefined);
    setCurrDocData(undefined);
    setCurrDocText(undefined);
    setCurrDocPages(undefined);
    setPdfDocument(undefined);
    setPdfStructure(null);
    pageTextCacheRef.current.clear();
    prefetchCacheRef.current.clear();
    currentBlockIdRef.current = null;
    currentBlockIndexRef.current = 0;
    loadedBlockIdsRef.current.clear();
    pdfStructureRef.current = null;
    pdfFilterRef.current = null;
    structureLoadedForDocRef.current = null;
    currDocTextRef.current = undefined;
    textLoadedForPageRef.current = null;
    stop();
  }, [setCurrDocPages, stop]);

  /**
   * Creates a complete audiobook by processing all PDF pages through NLP and TTS
   * @param {Function} onProgress - Callback for progress updates
   * @param {AbortSignal} signal - Optional signal for cancellation
   * @param {Function} onChapterComplete - Optional callback for when a chapter completes
   * @returns {Promise<string>} The bookId for the generated audiobook
   */
  const createFullAudioBook = useCallback(async (
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
    onChapterComplete?: (chapter: TTSAudiobookChapter) => void,
    providedBookId?: string,
    format: TTSAudiobookFormat = 'mp3'
  ): Promise<string> => {
    try {
      if (!pdfDocument) {
        throw new Error('No PDF document loaded');
      }

      // First pass: extract and measure all text
      const textPerPage: string[] = [];
      let totalLength = 0;
      
      // Use cached structure/filter from refs
      const structure = pdfStructureRef.current;
      const filter = pdfFilterRef.current;
      const margins = {
        header: headerMargin,
        footer: footerMargin,
        left: leftMargin,
        right: rightMargin
      };

      // Extract text from all pages using cached structure/filter
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const rawText = await extractTextFromPageWithStructure(
          pdfDocument, pageNum, structure, filter, margins
        );
        const trimmedText = rawText.trim();
        if (trimmedText) {
          const processedText = smartSentenceSplitting
            ? processTextToSentences(trimmedText).join(' ')
            : trimmedText;

          textPerPage.push(processedText);
          totalLength += processedText.length;
        }
      }

      if (totalLength === 0) {
        throw new Error('No text content found in PDF');
      }

      let processedLength = 0;
      let bookId: string = providedBookId || '';

      // If we have a bookId, check for existing chapters to determine which indices already exist
      const existingIndices = new Set<number>();
      if (bookId) {
        try {
          const existingData = await getAudiobookStatus(bookId);
          if (existingData.chapters && existingData.chapters.length > 0) {
            for (const ch of existingData.chapters) {
              existingIndices.add(ch.index);
            }
            let nextMissing = 0;
            while (existingIndices.has(nextMissing)) nextMissing++;
            console.log(`Resuming; next missing page index is ${nextMissing} (page ${nextMissing + 1})`);
          }
        } catch (error) {
          console.error('Error checking existing chapters:', error);
        }
      }

      // Second pass: process text into audio
      for (let i = 0; i < textPerPage.length; i++) {
        // Check for abort at the start of iteration
        if (signal?.aborted) {
          console.log('Generation cancelled by user');
          if (bookId) {
            return bookId; // Return bookId with partial progress
          }
          throw new Error('Audiobook generation cancelled');
        }

        const text = textPerPage[i];
        
        // Skip pages that already exist on disk (supports non-contiguous indices)
        if (existingIndices.has(i)) {
          processedLength += text.length;
          onProgress((processedLength / totalLength) * 100);
          continue;
        }

        const reqHeaders: TTSRequestHeaders = {
          'Content-Type': 'application/json',
          'x-openai-key': apiKey,
          'x-openai-base-url': baseUrl,
          'x-tts-provider': ttsProvider,
        };

        const reqBody: TTSRequestPayload = {
          text,
          voice: voice || (ttsProvider === 'openai' ? 'alloy' : (ttsProvider === 'deepinfra' ? 'af_bella' : 'af_sarah')),
          speed: voiceSpeed,
          format: 'mp3',
          model: ttsModel,
          instructions: ttsModel === 'gpt-4o-mini-tts' ? ttsInstructions : undefined
        };

        const retryOptions: TTSRetryOptions = {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 5000,
          backoffFactor: 2
        };

        try {
          const audioBuffer = await withRetry(
            async () => {
              // Check for abort before starting TTS request
              if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
              }

              return await generateTTS(reqBody, reqHeaders, signal);
            },
            retryOptions
          );

          const chapterTitle = `Page ${i + 1}`;

          // Check for abort before sending to server
          if (signal?.aborted) {
            console.log('Generation cancelled before saving page');
            if (bookId) {
              return bookId;
            }
            throw new Error('Audiobook generation cancelled');
          }

          // Send to server for conversion and storage
          const chapter = await createAudiobookChapter({
            chapterTitle,
            buffer: Array.from(new Uint8Array(audioBuffer)),
            bookId,
            format,
            chapterIndex: i
          }, signal);
          
          if (!bookId) {
            bookId = chapter.bookId!;
          }

          // Notify about completed chapter
          if (onChapterComplete) {
            onChapterComplete(chapter);
          }

          processedLength += text.length;
          onProgress((processedLength / totalLength) * 100);

        } catch (error) {
          if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled'))) {
            console.log('TTS request aborted, returning partial progress');
            if (bookId) {
              return bookId; // Return with partial progress
            }
            throw new Error('Audiobook generation cancelled');
          }
          console.error('Error processing page:', error);
          
          // Notify about error
          if (onChapterComplete) {
            onChapterComplete({
              index: i,
              title: `Page ${i + 1}`,
              status: 'error',
              bookId,
              format
            });
          }
        }
      }

      if (!bookId) {
        throw new Error('No audio was generated from the PDF content');
      }

      return bookId;
    } catch (error) {
      console.error('Error creating audiobook:', error);
      throw error;
    }
  }, [pdfDocument, headerMargin, footerMargin, leftMargin, rightMargin, apiKey, baseUrl, voice, voiceSpeed, ttsProvider, ttsModel, ttsInstructions, smartSentenceSplitting, currDocId]);

  /**
   * Regenerates a specific chapter (page) of the PDF audiobook
   */
  const regenerateChapter = useCallback(async (
    chapterIndex: number,
    bookId: string,
    format: TTSAudiobookFormat,
    signal: AbortSignal
  ): Promise<TTSAudiobookChapter> => {
    try {
      if (!pdfDocument) {
        throw new Error('No PDF document loaded');
      }

      // IMPORTANT: Chapter indices are based on non-empty pages used during generation.
      // Build a mapping of "chapterIndex" -> actual PDF page number (1-based).
      // Use cached structure/filter from refs
      const structure = pdfStructureRef.current;
      const filter = pdfFilterRef.current;
      const margins = {
        header: headerMargin,
        footer: footerMargin,
        left: leftMargin,
        right: rightMargin
      };

      const nonEmptyPages: number[] = [];
      for (let page = 1; page <= pdfDocument.numPages; page++) {
        const pageText = await extractTextFromPageWithStructure(
          pdfDocument, page, structure, filter, margins
        );
        if (pageText.trim()) {
          nonEmptyPages.push(page);
        }
      }

      if (chapterIndex < 0 || chapterIndex >= nonEmptyPages.length) {
        throw new Error('Invalid chapter index');
      }

      const pageNum = nonEmptyPages[chapterIndex];

      // Extract text from the mapped page
      const rawText = await extractTextFromPageWithStructure(
        pdfDocument, pageNum, structure, filter, margins
      );

      const trimmedText = rawText.trim();
      if (!trimmedText) {
        throw new Error('No text content found on page');
      }

      const textForTTS = smartSentenceSplitting
        ? processTextToSentences(trimmedText).join(' ')
        : trimmedText;

      // Use logical chapter numbering (index + 1) to match original generation titles
      const chapterTitle = `Page ${chapterIndex + 1}`;

      // Generate audio with retry logic
      const reqHeaders: TTSRequestHeaders = {
        'Content-Type': 'application/json',
        'x-openai-key': apiKey,
        'x-openai-base-url': baseUrl,
        'x-tts-provider': ttsProvider,
      };

      const reqBody: TTSRequestPayload = {
        text: textForTTS,
        voice: voice || (ttsProvider === 'openai' ? 'alloy' : (ttsProvider === 'deepinfra' ? 'af_bella' : 'af_sarah')),
        speed: voiceSpeed,
        format: 'mp3',
        model: ttsModel,
        instructions: ttsModel === 'gpt-4o-mini-tts' ? ttsInstructions : undefined
      };

      const retryOptions: TTSRetryOptions = {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffFactor: 2
      };

      const audioBuffer: TTSAudioBuffer = await withRetry(
        async () => {
          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          return await generateTTS(reqBody, reqHeaders, signal);
        },
        retryOptions
      );

      if (signal?.aborted) {
        throw new Error('Page regeneration cancelled');
      }

      // Send to server for conversion and storage
      const chapter = await createAudiobookChapter({
        chapterTitle,
        buffer: Array.from(new Uint8Array(audioBuffer)),
        bookId,
        format,
        chapterIndex
      }, signal);

      return chapter;

    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled'))) {
        throw new Error('Page regeneration cancelled');
      }
      console.error('Error regenerating page:', error);
      throw error;
    }
  }, [pdfDocument, headerMargin, footerMargin, leftMargin, rightMargin, apiKey, baseUrl, voice, voiceSpeed, ttsProvider, ttsModel, ttsInstructions, smartSentenceSplitting, currDocId]);

  /**
   * Effect hook to initialize TTS as non-EPUB mode
   */
  useEffect(() => {
    setIsEPUB(false);
  }, [setIsEPUB]);

  useEffect(() => {
    registerVisualPageChangeHandler(location => {
      if (typeof location !== 'number') return;
      if (!pdfDocument) return;
      const totalPages = currDocPages ?? pdfDocument.numPages;
      const clamped = Math.min(Math.max(location, 1), totalPages);
      setCurrDocPage(clamped);
    });
  }, [registerVisualPageChangeHandler, currDocPages, pdfDocument]);

  // Context value memoization
  const contextValue = useMemo(
    () => ({
      onDocumentLoadSuccess,
      setCurrentDocument,
      currDocData,
      currDocName,
      currDocPages,
      currDocPage,
      currDocText,
      clearCurrDoc,
      highlightPattern,
      clearHighlights,
      clearWordHighlights,
      highlightWordIndex,
      pdfDocument,
      pdfStructure,
      createFullAudioBook,
      regenerateChapter,
      isAudioCombining,
      requestMoreBlocks,
      jumpToBlock,
    }),
    [
      onDocumentLoadSuccess,
      setCurrentDocument,
      currDocData,
      currDocName,
      currDocPages,
      currDocPage,
      currDocText,
      clearCurrDoc,
      pdfDocument,
      pdfStructure,
      createFullAudioBook,
      regenerateChapter,
      isAudioCombining,
      requestMoreBlocks,
      jumpToBlock,
    ]
  );

  return (
    <PDFContext.Provider value={contextValue}>
      {children}
    </PDFContext.Provider>
  );
}

/**
 * Custom hook to consume the PDF context
 * Ensures the context is used within a provider
 * 
 * @throws {Error} If used outside of PDFProvider
 * @returns {PDFContextType} The PDF context value containing all PDF-related functionality
 */
export function usePDF() {
  const context = useContext(PDFContext);
  if (context === undefined) {
    throw new Error('usePDF must be used within a PDFProvider');
  }
  return context;
}
