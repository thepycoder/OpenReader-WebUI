'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFStructure, PDFBlockType } from '@/types/pdfStructure';

interface PDFBoundingBoxOverlayProps {
  pageNumber: number;
  structure: PDFStructure | null;
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

const BLOCK_TYPE_COLORS: Record<PDFBlockType, string> = {
  text: 'rgba(59, 130, 246, 0.2)', // blue
  heading: 'rgba(16, 185, 129, 0.2)', // green
  image: 'rgba(245, 158, 11, 0.2)', // yellow
  figure: 'rgba(239, 68, 68, 0.2)', // red
  table: 'rgba(168, 85, 247, 0.2)', // purple
  caption: 'rgba(236, 72, 153, 0.2)', // pink
  header: 'rgba(107, 114, 128, 0.2)', // gray
  footer: 'rgba(107, 114, 128, 0.2)', // gray
};

const BLOCK_TYPE_BORDERS: Record<PDFBlockType, string> = {
  text: 'rgba(59, 130, 246, 0.6)',
  heading: 'rgba(16, 185, 129, 0.6)',
  image: 'rgba(245, 158, 11, 0.6)',
  figure: 'rgba(239, 68, 68, 0.6)',
  table: 'rgba(168, 85, 247, 0.6)',
  caption: 'rgba(236, 72, 153, 0.6)',
  header: 'rgba(107, 114, 128, 0.6)',
  footer: 'rgba(107, 114, 128, 0.6)',
};

export function PDFBoundingBoxOverlay({
  pageNumber,
  structure,
  scale,
  pageWidth,
  pageHeight,
}: PDFBoundingBoxOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 10; // Maximum number of retries before giving up

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
    // react-pdf creates: .react-pdf__Page (wrapper) -> .react-pdf__Page__canvas
    const pageElement = overlay.parentElement;
    if (!pageElement) return;
    
    // Find the Page wrapper (should be a sibling or parent)
    const canvas = pageElement.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement;
    
    if (!canvas) {
      // Canvas not ready yet, retry after a short delay
      // Use retryCount state to trigger effect re-run
      if (retryCount < MAX_RETRIES) {
        const timeoutId = setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 100);
        return () => clearTimeout(timeoutId);
      }
      return; // Give up after max retries
    }
    
    // Get the actual rendered size of the canvas
    // Use clientWidth/clientHeight for CSS size, or fallback to width/height attributes
    const renderedWidth = canvas.clientWidth || canvas.width;
    const renderedHeight = canvas.clientHeight || canvas.height;
    
    // Calculate scale factors from PDF points to rendered pixels
    const pdfToRenderedScaleX = renderedWidth / pageWidth;
    const pdfToRenderedScaleY = renderedHeight / pageHeight;
    
    // Create overlay for each block
    pageData.blocks.forEach((block) => {
      const [x0, y0, x1, y1] = block.bbox;
      
      // PyMuPDF coordinates: y=0 is at top-left (same as CSS)
      // No Y-axis flip needed - PyMuPDF uses top-left origin like CSS
      const left = x0 * pdfToRenderedScaleX;
      const top = y0 * pdfToRenderedScaleY;
      const width = (x1 - x0) * pdfToRenderedScaleX;
      const height = (y1 - y0) * pdfToRenderedScaleY;
      
      // Skip boxes with invalid dimensions
      if (width <= 0 || height <= 0) return;

      const box = document.createElement('div');
      box.className = 'pdf-bounding-box';
      box.style.position = 'absolute';
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.backgroundColor = BLOCK_TYPE_COLORS[block.type] || 'rgba(128, 128, 128, 0.2)';
      box.style.border = `1px solid ${BLOCK_TYPE_BORDERS[block.type] || 'rgba(128, 128, 128, 0.6)'}`;
      box.style.pointerEvents = 'none';
      box.style.zIndex = '10';
      box.style.boxSizing = 'border-box';
      box.title = `${block.type}: ${block.text.substring(0, 50)}${block.text.length > 50 ? '...' : ''}`;
      
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
      label.textContent = block.type.toUpperCase();
      box.appendChild(label);
      
      overlay.appendChild(box);
    });
  }, [pageNumber, structure, scale, pageWidth, pageHeight, retryCount]);

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
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
