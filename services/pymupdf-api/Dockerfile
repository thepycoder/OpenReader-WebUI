FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# This layer will be cached unless system packages change
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for better caching)
# This layer will only rebuild if requirements.txt changes
COPY requirements.txt .

# Install Python dependencies (cached unless requirements.txt changes)
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (this will rebuild when code changes, but dependencies stay cached)
COPY main.py .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

