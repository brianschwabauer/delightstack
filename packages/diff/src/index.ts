export { DiffError } from './diff.error';
export {
	DEFAULT_MAX_EDIT_DISTANCE,
	diffLines,
	diffTokens,
	diffWords,
	tokenizeLines,
	tokenizeWords,
} from './diff.text';
export type { DiffOp, DiffOptions, DiffOpType } from './diff.text';
export { diffStructured } from './diff.structured';
export type {
	StructuredChange,
	StructuredChangeType,
	StructuredDiff,
	StructuredDiffOptions,
} from './diff.structured';
export { escapeHTML, renderDiffHTML } from './diff.render';
export type { RenderDiffHTMLOptions } from './diff.render';
