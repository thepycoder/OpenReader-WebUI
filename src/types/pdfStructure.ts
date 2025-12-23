// All block types from pymupdf-layout classification
export type PDFBlockType = 
  | 'text'           // Regular paragraph text
  | 'title'          // Document/section title
  | 'section-header' // Section heading
  | 'page-header'    // Page header (running header)
  | 'page-footer'    // Page footer (running footer)
  | 'image'          // Image element
  | 'figure'         // Figure/diagram
  | 'picture'        // Picture element
  | 'table'          // Table structure
  | 'table-fallback' // Table that couldn't be fully parsed
  | 'caption'        // Caption for figures/tables
  | 'list-item'      // List item
  | 'footnote'       // Footnote text
  | 'formula'        // Mathematical formula
  | 'code';          // Code block

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

