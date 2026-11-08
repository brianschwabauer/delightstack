export * from './types.js';
export * from './errors.js';

export { processImage } from './process.js';
export { imageProcessing } from './integration.js';
export { defineImageTable } from './schema.js';
export type { ImageSchemaBuilder, ImageTable } from './schema.js';

export { createImageHandle } from './handle.js';

export { decodeThumbHash, imageURL, toImageProps } from './image-helpers.js';
export type { ImageProps, ImageRecord, ImageVariant } from './image-helpers.js';

// Note: ImageProcessorContainer is intentionally NOT exported from this barrel.
// It imports @cloudflare/containers which depends on cloudflare:workers.
// Import it from '@delightstack/images/worker' in your Worker entry point.
export type { ImageProcessorContainer } from './container.js';
