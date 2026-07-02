import type { BlockSpec } from '../types/index.js';
import { calloutBlock } from './callout.js';
import { codeBlock } from './code-block.js';
import { imageBlock } from './image.js';
import { audioBlock, fileBlock, videoBlock } from './media.js';
import { embedBlock } from './embed.js';
import { galleryBlock } from './gallery.js';

export { calloutBlock, type CalloutAttrs } from './callout.js';
export { codeBlock, type CodeBlockAttrs } from './code-block.js';
export { imageBlock, pickFiles, type ImageAttrs } from './image.js';
export { audioBlock, fileBlock, videoBlock, type MediaAttrs } from './media.js';
export { embedBlock, matchEmbedUrl, type EmbedAttrs } from './embed.js';
export { galleryBlock, type GalleryAttrs } from './gallery.js';

export interface DefaultBlocksOptions {
	/** Only include these blocks */
	include?: string[];
	/** Exclude these blocks */
	exclude?: string[];
}

/** The built-in block set for `new Editor({ blocks: defaultBlocks() })`. */
export function defaultBlocks(options: DefaultBlocksOptions = {}): BlockSpec[] {
	const all = [
		calloutBlock,
		codeBlock,
		imageBlock,
		galleryBlock,
		videoBlock,
		audioBlock,
		fileBlock,
		embedBlock,
	] as unknown as BlockSpec[];
	return all.filter((block) => {
		if (options.include && !options.include.includes(block.name)) return false;
		if (options.exclude?.includes(block.name)) return false;
		return true;
	});
}
