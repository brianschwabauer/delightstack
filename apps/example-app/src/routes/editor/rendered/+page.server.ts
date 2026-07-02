import { renderHTML, renderText } from '@delightstack/editor/render';
import { sampleDoc } from '../sample-doc.js';
import type { PageServerLoad } from './$types';

/**
 * Demonstrates the zero-dependency server renderer: the same document the
 * playground edits, rendered to HTML without shipping ProseMirror or Svelte
 * editor code to this page.
 */
export const load: PageServerLoad = () => {
	return {
		html: renderHTML(sampleDoc),
		text: renderText(sampleDoc),
	};
};
