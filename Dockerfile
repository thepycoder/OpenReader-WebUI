# Stage 1: build whisper.cpp (no model download – the app handles that)
FROM alpine:3.20 AS whisper-builder

RUN apk add --no-cache git cmake build-base

WORKDIR /opt

RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git && \
    cd whisper.cpp && \
    cmake -B build && \
    cmake --build build -j --config Release


# Stage 2: build the Next.js app
FROM node:lts-alpine AS app-builder

# Install pnpm globally
RUN npm install -g pnpm

# Create app directory
WORKDIR /app

# Copy package files first (for better caching)
# This layer will only rebuild if package.json or pnpm-lock.yaml changes
COPY package.json pnpm-lock.yaml ./

# Install dependencies (cached unless package files change)
RUN pnpm install --frozen-lockfile

# Copy configuration files (these rarely change, so they're cached separately)
COPY next.config.ts tsconfig.json postcss.config.mjs tailwind.config.ts eslint.config.mjs playwright.config.ts ./

# Copy public assets (these change infrequently)
COPY public ./public

# Copy source code (this layer will rebuild when source code changes, but dependencies stay cached)
# Note: services/ directory is excluded via .dockerignore, so API changes won't trigger rebuilds
COPY src ./src

# Build the Next.js application
RUN pnpm exec next telemetry disable && \
    pnpm build


# Stage 3: minimal runtime image
FROM node:lts-alpine AS runner

# Add runtime OS dependencies:
# - ffmpeg: required for audiobook export and word-by-word alignment (/api/whisper)
# - libreoffice-writer: required for DOCX → PDF conversion
RUN apk add --no-cache ffmpeg libreoffice-writer

# Install pnpm globally for running the app
RUN npm install -g pnpm

# App runtime directory
WORKDIR /app

# Copy only production dependencies
COPY --from=app-builder /app/node_modules ./node_modules

# Copy built Next.js application
COPY --from=app-builder /app/.next ./.next
COPY --from=app-builder /app/public ./public

# Copy source files (needed for API routes and dynamic imports in production)
COPY --from=app-builder /app/src ./src

# Copy necessary config files for runtime
COPY --from=app-builder /app/package.json ./package.json
COPY --from=app-builder /app/next.config.ts ./next.config.ts

# Copy the compiled whisper.cpp build output into the runtime image
# (includes whisper-cli and its shared libraries, e.g. libwhisper.so, libggml.so)
COPY --from=whisper-builder /opt/whisper.cpp/build /opt/whisper.cpp/build

# Point the app at the compiled whisper-cli binary and ensure its libs are discoverable
ENV WHISPER_CPP_BIN=/opt/whisper.cpp/build/bin/whisper-cli
ENV LD_LIBRARY_PATH=/opt/whisper.cpp/build
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3003

# Start the application
CMD ["pnpm", "start"]
