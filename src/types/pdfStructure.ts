export type PDFBlockType = 'text' | 'heading' | 'image' | 'figure' | 'table' | 'caption' | 'header' | 'footer';

export interface PDFBlock {
  id: string;
  type: PDFBlockType;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1]
  text: string;
  readingOrder: number; // order within page
  globalOrder?: number; // position in global reading order (cross-page)
  fontSize?: number;
  fontName?: string;
}

export interface PDFPageStructure {
  pageNumber: number;
  blocks: PDFBlock[];
}

export interface PDFStructure {
  documentId: string;
  pages: PDFPageStructure[];
  globalReadingOrder: string[]; // array of block IDs in reading order (cross-page)
}

export interface PDFStructureRow {
  documentId: string;
  structure: PDFStructure;
  analyzedAt: number; // timestamp
}

export interface PDFElementFilter {
  enabled: boolean; // Whether filtering is enabled
  excludedTypes: PDFBlockType[];
  excludedBboxes?: string[]; // Specific block IDs to exclude
}

export interface PDFFilterRow {
  documentId: string;
  filter: PDFElementFilter;
  useGlobal: boolean; // If true, use global settings instead of this filter
  showBoundingBoxes?: boolean; // Whether to show bounding boxes for debugging
}

