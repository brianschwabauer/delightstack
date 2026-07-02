/**
 * Inline SVG icons (24x24 viewBox, stroke: currentColor) for the built-in
 * commands. Kept as strings so the core stays dependency-free; menus render
 * them with `{@html}` inside a fixed-size span.
 */

function icon(paths: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export const icons = {
	text: icon('<path d="M17 6.1H3M21 12.1H3M15.1 18H3"/>'),
	heading_1: icon('<path d="M4 12h8M4 18V6M12 18V6M17 12l3-2v8"/>'),
	heading_2: icon(
		'<path d="M4 12h8M4 18V6M12 18V6M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
	),
	heading_3: icon(
		'<path d="M4 12h8M4 18V6M12 18V6M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2c1.5 0 2.5 1 2.5 2.5a2.5 2.5 0 0 1-4 2"/>',
	),
	heading_4: icon('<path d="M4 12h8M4 18V6M12 18V6M17 10v4h4M21 10v8"/>'),
	bold: icon('<path d="M14 12a4 4 0 0 0 0-8H6v8M15 20a4 4 0 0 0 0-8H6v8Z"/>'),
	italic: icon(
		'<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
	),
	underline: icon(
		'<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
	),
	strike: icon(
		'<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
	),
	code: icon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
	code_block: icon(
		'<path d="M10 9.5 8 12l2 2.5M14 9.5l2 2.5-2 2.5"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
	),
	link: icon(
		'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	),
	bullet_list: icon(
		'<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
	),
	ordered_list: icon(
		'<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	),
	todo_list: icon(
		'<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m4.5 8 1 1 2-2.5M13 6h8M13 12h8M13 18h8M3 17l2 2 4-4"/>',
	),
	blockquote: icon('<path d="M17 6H3M21 12H8M21 18H8M3 12v6"/>'),
	divider: icon(
		'<line x1="3" x2="21" y1="12" y2="12"/><path d="M8 8h8M8 16h8" opacity="0"/>',
	),
	undo: icon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
	redo: icon(
		'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
	),
	image: icon(
		'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
	),
	gallery: icon(
		'<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
	),
	video: icon(
		'<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
	),
	audio: icon(
		'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
	),
	file: icon(
		'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
	),
	embed: icon(
		'<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m9 11-2 2 2 2M15 11l2 2-2 2"/>',
	),
	callout: icon(
		'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4M12 16h.01"/>',
	),
	settings: icon(
		'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	),
	arrange: icon(
		'<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M10 7h8M10 17h8" opacity="0.5"/>',
	),
	duplicate: icon(
		'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	),
	trash: icon(
		'<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
	),
	plus: icon('<path d="M5 12h14M12 5v14"/>'),
	arrow_up: icon('<path d="M12 19V5M5 12l7-7 7 7"/>'),
	width_text: icon(
		'<path d="M3 4v16M21 4v16"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
	),
	width_wide: icon(
		'<path d="M3 4v16M21 4v16"/><rect x="6" y="8" width="12" height="8" rx="1"/>',
	),
	width_full: icon('<rect x="2.5" y="8" width="19" height="8" rx="1"/>'),
	play: icon('<path d="M8 5.5v13l11-6.5z"/>'),
	arrow_down: icon('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
	drag: icon(
		'<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
	),
	external: icon(
		'<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	),
	unlink: icon(
		'<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>',
	),
	check: icon('<path d="M20 6 9 17l-5-5"/>'),
	close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
} as const;

export type IconName = keyof typeof icons;
