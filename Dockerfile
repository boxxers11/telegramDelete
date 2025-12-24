# Multi-stage build for Traceless - Telegram Message Deleter
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY index.html ./
COPY src ./src
COPY public ./public
COPY vite.config.ts tsconfig*.json tailwind.config.js postcss.config.js eslint.config.js ./

# Build frontend
RUN npm run build

# Python backend stage
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY app ./app

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/dist ./dist

# Create necessary directories
RUN mkdir -p sessions cloud_backups logs

# Expose port
EXPOSE 8001

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8001

# Run the application (use PORT env var if available, otherwise default to 8001)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
