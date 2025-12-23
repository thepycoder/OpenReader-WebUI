"""
PyMuPDF PDF Structure Analysis API
Extracts bounding boxes, element classes, and reading order from PDFs
Uses pymupdf-layout for automatic block classification
"""

import json
import uuid
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Activate pymupdf-layout before importing other pymupdf modules
import pymupdf.layout
pymupdf.layout.activate()

import pymupdf  # PyMuPDF (fitz)
import pymupdf4llm

app = FastAPI(title="PyMuPDF PDF Structure Analysis API")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_text_from_textlines(textlines: List[Dict[str, Any]]) -> str:
    """Extract text content from textlines array."""
    if not textlines:
        return ""
    texts = []
    for textline in textlines:
        if isinstance(textline, dict):
            spans = textline.get("spans", [])
            line_texts = []
            for span in spans:
                if isinstance(span, dict):
                    text = span.get("text", "")
                    if text:
                        line_texts.append(text)
            if line_texts:
                texts.append("".join(line_texts))
    return "\n".join(texts)


def get_font_info_from_textlines(textlines: Optional[List[Dict[str, Any]]]) -> tuple:
    """Extract font size and name from the first span in textlines."""
    font_size = None
    font_name = None
    
    if textlines and len(textlines) > 0:
        first_line = textlines[0]
        if isinstance(first_line, dict):
            spans = first_line.get("spans", [])
            if spans and isinstance(spans[0], dict):
                font_size = spans[0].get("size")
                font_name = spans[0].get("font")
    
    return font_size, font_name


def extract_reading_order(blocks: List[Dict[str, Any]]) -> List[int]:
    """
    Extract reading order for blocks on a page.
    Returns list of block indices in reading order (top-to-bottom, left-to-right).
    """
    if not blocks:
        return []
    
    # Get block positions and sort by reading order
    block_positions = []
    for idx, block in enumerate(blocks):
        bbox = block.get("bbox", [])
        if bbox and len(bbox) >= 4:
            # Use top-left corner for sorting
            y0 = bbox[1]
            x0 = bbox[0]
            block_positions.append((idx, y0, x0))
    
    # Sort by Y first (top to bottom), then by X (left to right)
    block_positions.sort(key=lambda x: (x[1], x[2]))
    
    return [idx for idx, _, _ in block_positions]


@app.post("/analyze")
async def analyze_pdf(file: UploadFile = File(...)):
    """
    Analyze PDF structure and return bounding boxes, element classes, and reading order.
    Uses pymupdf-layout for automatic block classification.
    """
    try:
        # Read PDF bytes
        pdf_bytes = await file.read()
        
        # Open PDF with PyMuPDF
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        
        document_id = str(uuid.uuid4())
        pages_data = []
        global_reading_order = []
        block_id_counter = 0
        
        # Try to use pymupdf4llm for structured extraction with layout analysis
        try:
            # Get structured data from pymupdf4llm - returns JSON string
            structured_json = pymupdf4llm.to_json(doc)
            
            # Parse the JSON string
            structured_data = json.loads(structured_json) if isinstance(structured_json, str) else structured_json
            
            # The structure has "pages" array at root level
            pages_array = structured_data.get("pages", structured_data) if isinstance(structured_data, dict) else structured_data
            
            # If it's still a dict with pages key, extract pages
            if isinstance(pages_array, dict) and "pages" in pages_array:
                pages_array = pages_array["pages"]
            
            # If pages_array is a list, process each page
            if isinstance(pages_array, list):
                for page_idx, page_data in enumerate(pages_array):
                    # Get page number (0-indexed in data, we convert to 1-indexed)
                    page_num = page_data.get("page_number", page_data.get("page", page_idx + 1))
                    if isinstance(page_num, int) and page_num > 0:
                        page_num_zero = page_num - 1
                    else:
                        page_num_zero = page_idx
                    
                    # Get boxes from page - this is where pymupdf-layout provides classified blocks
                    boxes = page_data.get("boxes", [])
                    
                    processed_blocks = []
                    
                    for box in boxes:
                        block_id = f"{document_id}-page{page_num_zero}-block{block_id_counter}"
                        block_id_counter += 1
                        
                        # Get boxclass from pymupdf-layout
                        boxclass = box.get("boxclass", "text")
                        
                        # Get bounding box - pymupdf-layout uses x0, y0, x1, y1 format
                        x0 = box.get("x0", 0)
                        y0 = box.get("y0", 0)
                        x1 = box.get("x1", 0)
                        y1 = box.get("y1", 0)
                        bbox = [x0, y0, x1, y1]
                        
                        # Get text content from textlines
                        textlines = box.get("textlines", [])
                        text = extract_text_from_textlines(textlines)
                        
                        # Get font info
                        font_size, font_name = get_font_info_from_textlines(textlines)
                        
                        processed_block = {
                            "id": block_id,
                            "type": boxclass,
                            "bbox": bbox,
                            "text": text.strip(),
                            "readingOrder": 0,
                            "fontSize": font_size,
                            "fontName": font_name,
                        }
                        
                        processed_blocks.append(processed_block)
                    
                    # Use existing order from pymupdf4llm as reading order
                    # pymupdf4llm/pymupdf-layout already provides blocks in reading order
                    for idx, block in enumerate(processed_blocks):
                        block["readingOrder"] = idx
                        global_reading_order.append(block["id"])
                    
                    pages_data.append({
                        "pageNumber": page_num_zero + 1,  # 1-indexed for output
                        "blocks": processed_blocks,
                    })
            else:
                raise ValueError("Unexpected data structure from pymupdf4llm")
        
        except Exception as e:
            # Fallback to basic extraction if pymupdf4llm fails
            print(f"pymupdf4llm extraction failed, using fallback: {e}")
            import traceback
            traceback.print_exc()
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                
                # Get blocks from page using basic method
                blocks = page.get_text("dict")
                page_blocks = blocks.get("blocks", [])
                
                processed_blocks = []
                
                for block in page_blocks:
                    block_id = f"{document_id}-page{page_num}-block{block_id_counter}"
                    block_id_counter += 1
                    
                    # Basic type detection (0=text, 1=image)
                    raw_type = block.get("type", 0)
                    if raw_type == 1:
                        block_type = "figure"
                    else:
                        block_type = "text"
                    
                    bbox = block.get("bbox", [])
                    text = block.get("text", "").strip()
                    
                    # Extract font info if available
                    font_size = None
                    font_name = None
                    if block.get("lines"):
                        first_line = block["lines"][0]
                        if first_line.get("spans"):
                            first_span = first_line["spans"][0]
                            font_size = first_span.get("size")
                            font_name = first_span.get("font")
                    
                    processed_block = {
                        "id": block_id,
                        "type": block_type,
                        "bbox": list(bbox) if bbox else [],
                        "text": text,
                        "readingOrder": 0,
                        "fontSize": font_size,
                        "fontName": font_name,
                    }
                    
                    processed_blocks.append(processed_block)
                
                # Calculate reading order
                reading_order_indices = extract_reading_order(processed_blocks)
                
                # Update reading order
                for order_idx, block_idx in enumerate(reading_order_indices):
                    if block_idx < len(processed_blocks):
                        processed_blocks[block_idx]["readingOrder"] = order_idx
                
                # Add to global reading order
                for block_idx in reading_order_indices:
                    if block_idx < len(processed_blocks):
                        global_reading_order.append(processed_blocks[block_idx]["id"])
                
                pages_data.append({
                    "pageNumber": page_num + 1,
                    "blocks": processed_blocks,
                })
        
        doc.close()
        
        # Build response
        response = {
            "documentId": document_id,
            "pages": pages_data,
            "globalReadingOrder": global_reading_order,
        }
        
        return JSONResponse(content=response)
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error analyzing PDF: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
