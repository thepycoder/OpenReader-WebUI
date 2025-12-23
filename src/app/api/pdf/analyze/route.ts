import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const PYMUPDF_API_URL = process.env.PYMUPDF_API_URL || 'http://localhost:8000';
const DOCS_DIR = path.join(process.cwd(), 'docstore');

interface PDFStructure {
  documentId: string;
  pages: Array<{
    pageNumber: number;
    blocks: Array<{
      id: string;
      type: 'text' | 'heading' | 'image' | 'figure' | 'table' | 'caption' | 'header' | 'footer';
      bbox: [number, number, number, number];
      text: string;
      readingOrder: number;
      globalOrder?: number;
      fontSize?: number;
      fontName?: string;
    }>;
  }>;
  globalReadingOrder: string[];
}

async function analyzePdfWithRetry(pdfBytes: ArrayBuffer, maxRetries = 3): Promise<PDFStructure> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const formData = new FormData();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      formData.append('file', blob, 'document.pdf');
      
      const response = await fetch(`${PYMUPDF_API_URL}/analyze`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PyMuPDF API error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json() as PDFStructure;
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  
  throw lastError || new Error('Failed to analyze PDF after retries');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documentId, pdfBytes } = body;
    
    if (!documentId && !pdfBytes) {
      return NextResponse.json(
        { error: 'Either documentId or pdfBytes must be provided' },
        { status: 400 }
      );
    }
    
    let pdfData: ArrayBuffer;
    
    if (documentId) {
      // Fetch PDF from server's docstore
      const pdfPath = path.join(DOCS_DIR, `${documentId}.pdf`);
      if (!existsSync(pdfPath)) {
        return NextResponse.json(
          { error: 'PDF document not found on server' },
          { status: 404 }
        );
      }
      const fileBuffer = await readFile(pdfPath);
      pdfData = fileBuffer.buffer;
    } else if (pdfBytes) {
      // Use provided PDF bytes
      const uint8Array = new Uint8Array(pdfBytes);
      pdfData = uint8Array.buffer;
    } else {
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 400 }
      );
    }
    
    // Call Python service
    const structure = await analyzePdfWithRetry(pdfData);
    
    return NextResponse.json(structure);
  } catch (error) {
    console.error('Error analyzing PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to analyze PDF', details: errorMessage },
      { status: 500 }
    );
  }
}

