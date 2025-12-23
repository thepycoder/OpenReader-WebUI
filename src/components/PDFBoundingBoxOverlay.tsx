'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PDFStructure, PDFBlockType } from '@/types/pdfStructure';

interface PDFBoundingBoxOverlayProps {
  pageNumber: number;
  structure: PDFStructure | null;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  onBlockClick?: (blockId: string, pageNumber: number) => void;
  currentBlockId?: string | null;
}

// Colors for all pymupdf-layout block types
const BLOCK_TYPE_COLORS: Record<PDFBlockType, string> = {
  // Text types
  text: 'rgba(59, 130, 246, 0.15)',           // blue
  title: 'rgba(16, 185, 129, 0.15)',          // green
  'section-header': 'rgba(34, 197, 94, 0.15)', // lighter green
  
  // Header/footer types
  'page-header': 'rgba(107, 114, 128, 0.15)', // gray
  'page-footer': 'rgba(107, 114, 128, 0.15)', // gray
  
  // Visual content types
  image: 'rgba(245, 158, 11, 0.15)',          // yellow/orange
  figure: 'rgba(239, 68, 68, 0.15)',          // red
  picture: 'rgba(251, 146, 60, 0.15)',        // orange
  
  // Table types
  table: 'rgba(168, 85, 247, 0.15)',          // purple
  'table-fallback': 'rgba(139, 92, 246, 0.15)', // violet
  
  // Other content types
  caption: 'rgba(236, 72, 153, 0.15)',        // pink
  'list-item': 'rgba(14, 165, 233, 0.15)',    // sky blue
  footnote: 'rgba(156, 163, 175, 0.15)',      // gray
  formula: 'rgba(234, 179, 8, 0.15)',         // yellow
  code: 'rgba(34, 211, 238, 0.15)',           // cyan
};

const BLOCK_TYPE_BORDERS: Record<PDFBlockType, string> = {
  // Text types
  text: 'rgba(59, 130, 246, 0.6)',
  title: 'rgba(16, 185, 129, 0.6)',
  'section-header': 'rgba(34, 197, 94, 0.6)',
  
  // Header/footer types
  'page-header': 'rgba(107, 114, 128, 0.6)',
  'page-footer': 'rgba(107, 114, 128, 0.6)',
  
  // Visual content types
  image: 'rgba(245, 158, 11, 0.6)',
  figure: 'rgba(239, 68, 68, 0.6)',
  picture: 'rgba(251, 146, 60, 0.6)',
  
  // Table types
  table: 'rgba(168, 85, 247, 0.6)',
  'table-fallback': 'rgba(139, 92, 246, 0.6)',
  
  // Other content types
  caption: 'rgba(236, 72, 153, 0.6)',
  'list-item': 'rgba(14, 165, 233, 0.6)',
  footnote: 'rgba(156, 163, 175, 0.6)',
  formula: 'rgba(234, 179, 8, 0.6)',
  code: 'rgba(34, 211, 238, 0.6)',
};

// Hover colors (slightly more opaque)
const BLOCK_TYPE_HOVER_COLORS: Record<PDFBlockType, string> = {
  text: 'rgba(59, 130, 246, 0.3)',
  title: 'rgba(16, 185, 129, 0.3)',
  'section-header': 'rgba(34, 197, 94, 0.3)',
  'page-header': 'rgba(107, 114, 128, 0.3)',
  'page-footer': 'rgba(107, 114, 128, 0.3)',
  image: 'rgba(245, 158, 11, 0.3)',
  figure: 'rgba(239, 68, 68, 0.3)',
  picture: 'rgba(251, 146, 60, 0.3)',
  table: 'rgba(168, 85, 247, 0.3)',
  'table-fallback': 'rgba(139, 92, 246, 0.3)',
  caption: 'rgba(236, 72, 153, 0.3)',
  'list-item': 'rgba(14, 165, 233, 0.3)',
  footnote: 'rgba(156, 163, 175, 0.3)',
  formula: 'rgba(234, 179, 8, 0.3)',
  code: 'rgba(34, 211, 238, 0.3)',
};

// Active/current block colors (more prominent)
const BLOCK_TYPE_ACTIVE_COLORS: Record<PDFBlockType, string> = {
  text: 'rgba(59, 130, 246, 0.4)',
  title: 'rgba(16, 185, 129, 0.4)',
  'section-header': 'rgba(34, 197, 94, 0.4)',
  'page-header': 'rgba(107, 114, 128, 0.4)',
  'page-footer': 'rgba(107, 114, 128, 0.4)',
  image: 'rgba(245, 158, 11, 0.4)',
  figure: 'rgba(239, 68, 68, 0.4)',
  picture: 'rgba(251, 146, 60, 0.4)',
  table: 'rgba(168, 85, 247, 0.4)',
  'table-fallback': 'rgba(139, 92, 246, 0.4)',
  caption: 'rgba(236, 72, 153, 0.4)',
  'list-item': 'rgba(14, 165, 233, 0.4)',
  footnote: 'rgba(156, 163, 175, 0.4)',
  formula: 'rgba(234, 179, 8, 0.4)',
  code: 'rgba(34, 211, 238, 0.4)',
};

// Human-readable labels for block types
const BLOCK_TYPE_LABELS: Record<PDFBlockType, string> = {
  text: 'TEXT',
  title: 'TITLE',
  'section-header': 'SECTION',
  'page-header': 'HEADER',
  'page-footer': 'FOOTER',
  image: 'IMAGE',
  figure: 'FIGURE',
  picture: 'PICTURE',
  table: 'TABLE',
  'table-fallback': 'TABLE',
  caption: 'CAPTION',
  'list-item': 'LIST',
  footnote: 'FOOTNOTE',
  formula: 'FORMULA',
  code: 'CODE',
};

export function PDFBoundingBoxOverlay({
  pageNumber,
  structure,
  scale,
  pageWidth,
  pageHeight,
  onBlockClick,
  currentBlockId,
}: PDFBoundingBoxOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 10;

  // Store block click handler in ref for event listeners
  const onBlockClickRef = useRef(onBlockClick);
  useEffect(() => {
    onBlockClickRef.current = onBlockClick;
  }, [onBlockClick]);

  // Reset retry count when page changes
  useEffect(() => {
    setRetryCount(0);
  }, [pageNumber]);

  useEffect(() => {
    if (!structure || !overlayRef.current) return;

    const pageData = structure.pages.find(p => p.pageNumber === pageNumber);
    if (!pageData) return;

    const overlay = overlayRef.current;
    overlay.innerHTML = ''; // Clear previous boxes

    // Find the react-pdf Page component wrapper
    const pageElement = overlay.parentElement;
    if (!pageElement) return;
    
    const canvas = pageElement.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement;
    
    if (!canvas) {
      if (retryCount < MAX_RETRIES) {
        const timeoutId = setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 100);
        return () => clearTimeout(timeoutId);
      }
      return;
    }
    
    const renderedWidth = canvas.clientWidth || canvas.width;
    const renderedHeight = canvas.clientHeight || canvas.height;
    
    const pdfToRenderedScaleX = renderedWidth / pageWidth;
    const pdfToRenderedScaleY = renderedHeight / pageHeight;
    
    // Create overlay for each block
    pageData.blocks.forEach((block) => {
      const [x0, y0, x1, y1] = block.bbox;
      
      const left = x0 * pdfToRenderedScaleX;
      const top = y0 * pdfToRenderedScaleY;
      const width = (x1 - x0) * pdfToRenderedScaleX;
      const height = (y1 - y0) * pdfToRenderedScaleY;
      
      if (width <= 0 || height <= 0) return;

      const isCurrentBlock = currentBlockId === block.id;
      const isClickable = !!onBlockClickRef.current;
      
      const box = document.createElement('div');
      box.className = 'pdf-bounding-box';
      box.dataset.blockId = block.id;
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.backgroundColor = isCurrentBlock 
        ? (BLOCK_TYPE_ACTIVE_COLORS[block.type] || 'rgba(128, 128, 128, 0.4)')
        : (BLOCK_TYPE_COLORS[block.type] || 'rgba(128, 128, 128, 0.15)');
      box.style.border = isCurrentBlock
        ? `2px solid ${BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.8)'}`
        : `1px solid ${BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.6)'}`;
      box.style.pointerEvents = isClickable ? 'auto' : 'none';
      box.style.cursor = isClickable ? 'pointer' : 'default';
      box.style.zIndex = isCurrentBlock ? '15' : '10';
      box.style.boxSizing = 'border-box';
      box.style.transition = 'background-color 0.15s ease, border 0.15s ease';
      box.title = `${BLOCK_TYPE_LABELS[block.type] || block.type}: ${block.text.substring(0, 100)}${block.text.length > 100 ? '...' : ''}\n\nClick to start reading from here`;
      
      // Add hover effects
      if (isClickable) {
        const normalBg = BLOCK_TYPE_COLORS[block.type] || 'rgba(128, 128, 128, 0.15)';
        const hoverBg = BLOCK_TYPE_HOVER_COLORS[block.type] || 'rgba(128, 128, 128, 0.3)';
        const activeBg = BLOCK_TYPE_ACTIVE_COLORS[block.type] || 'rgba(128, 128, 128, 0.4)';
        
        box.addEventListener('mouseenter', () => {
          if (currentBlockId !== block.id) {
            box.style.backgroundColor = hoverBg;
            box.style.border = `2px solid ${BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.8)'}`;
          }
        });
        
        box.addEventListener('mouseleave', () => {
          if (currentBlockId !== block.id) {
            box.style.backgroundColor = normalBg;
            box.style.border = `1px solid ${BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.6)'}`;
          }
        });
        
        box.addEventListener('click', (e) => {
          e.stopPropagation();
          onBlockClickRef.current?.(block.id, pageNumber);
        });
      }
      
      // Add type label
      const label = document.createElement('div');
      label.className = 'pdf-bounding-box-label';
      label.style.position = 'absolute';
      label.style.top = '-18px';
      label.style.left = '0';
      label.style.fontSize = '10px';
      label.style.color = BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.8)';
      label.style.fontWeight = 'bold';
      label.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      label.style.padding = '2px 4px';
      label.style.borderRadius = '2px';
      label.style.whiteSpace = 'nowrap';
      label.style.pointerEvents = 'none';
      label.textContent = BLOCK_TYPE_LABELS[block.type] || block.type.toUpperCase();
      box.appendChild(label);
      
      overlay.appendChild(box);
    });
  }, [pageNumber, structure, scale, pageWidth, pageHeight, retryCount, currentBlockId]);

  if (!structure) return null;

  const pageData = structure.pages.find(p => p.pageNumber === pageNumber);
  if (!pageData || pageData.blocks.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      className="pdf-bounding-box-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${pageWidth * scale}px`,
        height: `${pageHeight * scale}px`,
        pointerEvents: 'none', // Container doesn't block, individual boxes handle clicks
        zIndex: 10,
      }}
    />
  );
}
