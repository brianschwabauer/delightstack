export * from './types';
export * from './errors';

export { processImage } from './process';
export { imageProcessing } from './integration';
export { defineImageTable } from './schema';
export type { ImageSchemaBuilder, ImageTable } from './schema';

export { createImageHandle } from './handle';

export { decodeThumbHash, imageURL, toImageProps } from './image-helpers';
export type { ImageProps, ImageRecord, ImageVariant } from './image-helpers';

// Note: ImageProcessorContainer is intentionally NOT exported from this barrel.
// It imports @cloudflare/containers which depends on cloudflare:workers.
// Import it from '@delightstack/images/worker' in your Worker entry point.
export type { ImageProcessorContainer } from './container';
