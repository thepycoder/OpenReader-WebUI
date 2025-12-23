# PyMuPDF PDF Structure Analysis API

FastAPI service for analyzing PDF structure using PyMuPDF.

## Features

- Extracts bounding boxes for all text and image blocks
- Classifies blocks (text, heading, image, figure, table, header, footer)
- Determines reading order (top-to-bottom, left-to-right)
- Provides global reading order across all pages

## Running

### With Docker

```bash
docker build -t pymupdf-api .
docker run -p 8000:8000 pymupdf-api
```

### With Python

```bash
pip install -r requirements.txt
python main.py
```

## API Endpoints

### POST /analyze

Analyzes a PDF file and returns structure data.

**Request:** Multipart form data with `file` field containing PDF bytes

**Response:** JSON with document structure including:
- `documentId`: Unique document identifier
- `pages`: Array of page data with blocks
- `globalReadingOrder`: Array of block IDs in reading order

### GET /health

Health check endpoint.

## Environment Variables

- `PYMUPDF_API_HOST`: Host to bind to (default: 0.0.0.0)
- `PYMUPDF_API_PORT`: Port to bind to (default: 8000)

