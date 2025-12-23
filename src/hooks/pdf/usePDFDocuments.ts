'use client';

import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/dexie';
import type { PDFDocument } from '@/types/documents';
import { analyzePdfDocument } from '@/lib/pdfAnalysis';

export function usePDFDocuments() {
  const documents = useLiveQuery(
    () => db['pdf-documents'].toArray(),
    [],
    undefined,
  );

  const isLoading = documents === undefined;

  const addDocument = useCallback(async (file: File): Promise<string> => {
    const id = uuidv4();
    const arrayBuffer = await file.arrayBuffer();

    const newDoc: PDFDocument = {
      id,
      type: 'pdf',
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      data: arrayBuffer,
    };

    await db['pdf-documents'].add(newDoc);
    
    // Trigger analysis in background (don't await - non-blocking)
    // Pass the PDF data so server doesn't need to fetch from IndexedDB
    analyzePdfDocument(id, arrayBuffer).catch(error => {
      console.error('Background PDF analysis failed:', error);
      // Analysis failures are non-critical, document can still be used
    });
    
    return id;
  }, []);

  const removeDocument = useCallback(async (id: string): Promise<void> => {
    await db['pdf-documents'].delete(id);
  }, []);

  const clearDocuments = useCallback(async (): Promise<void> => {
    await db['pdf-documents'].clear();
  }, []);

  return {
    documents: documents ?? [],
    isLoading,
    addDocument,
    removeDocument,
    clearDocuments,
  };
}
