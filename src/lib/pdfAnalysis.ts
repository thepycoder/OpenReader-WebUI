import type { PDFStructure } from '@/types/pdfStructure';
import { savePdfStructure } from './dexie';

/**
 * Analyzes a PDF document and stores the structure in IndexedDB
 * @param documentId - The ID of the PDF document to analyze
 * @param pdfData - Optional PDF data as ArrayBuffer (if not provided, will fetch from server)
 * @returns Promise that resolves when analysis is complete
 */
export async function analyzePdfDocument(documentId: string, pdfData?: ArrayBuffer): Promise<void> {
  try {
    console.log('Starting PDF analysis for document:', documentId);
    
    // Prepare request body
    const requestBody: { documentId?: string; pdfBytes?: number[] } = {};
    
    if (pdfData) {
      // Send PDF bytes directly if available
      requestBody.pdfBytes = Array.from(new Uint8Array(pdfData));
    } else {
      // Otherwise, let server fetch from docstore
      requestBody.documentId = documentId;
    }
    
    // Call the analysis API
    const response = await fetch('/api/pdf/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`PDF analysis failed: ${errorData.error || response.statusText}`);
    }

    const structure = await response.json() as PDFStructure;
    
    // Update documentId to match the actual document ID
    structure.documentId = documentId;
    
    // Store in IndexedDB (this runs in browser, so IndexedDB is available)
    await savePdfStructure(documentId, structure);
    
    console.log('PDF analysis complete for document:', documentId);
  } catch (error) {
    console.error('Error analyzing PDF:', error);
    // Don't throw - analysis failures should not block document usage
    // The document can still be used with fallback text extraction
  }
}

