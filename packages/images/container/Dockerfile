# Stage 1: Build dependencies
FROM oven/bun:1-alpine AS builder

RUN apk add --no-cache \
    build-base \
    python3 \
    pkgconfig \
    vips-dev \
    glib-dev \
    expat-dev \
    libjpeg-turbo-dev \
    libpng-dev \
    libwebp-dev \
    libheif-dev \
    aom-dev \
    libraw-dev \
    librsvg-dev \
    poppler-dev \
    giflib-dev \
    lcms2-dev \
    libexif-dev \
    tiff-dev \
    cgif-dev

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Stage 2: Runtime
FROM oven/bun:1-alpine

RUN apk add --no-cache \
    vips \
    glib \
    expat \
    libjpeg-turbo \
    libpng \
    libwebp \
    libheif \
    aom-libs \
    libraw \
    librsvg \
    poppler \
    poppler-utils \
    giflib \
    lcms2 \
    libexif \
    tiff \
    cgif

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

EXPOSE 8080
CMD ["bun", "run", "src/server.ts"]
