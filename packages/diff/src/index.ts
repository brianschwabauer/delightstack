export { DiffError } from './diff.error.js';
export {
	DEFAULT_MAX_EDIT_DISTANCE,
	diffLines,
	diffTokens,
	diffWords,
	tokenizeLines,
	tokenizeWords,
} from './diff.text.js';
export type { DiffOp, DiffOptions, DiffOpType } from './diff.text.js';
export { diffStructured } from './diff.structured.js';
export type {
	StructuredChange,
	StructuredChangeType,
	StructuredDiff,
	StructuredDiffOptions,
} from './diff.structured.js';
export { escapeHTML, renderDiffHTML } from './diff.render.js';
export type { RenderDiffHTMLOptions } from './diff.render.js';
