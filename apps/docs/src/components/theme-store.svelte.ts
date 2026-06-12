/**
 * Shared state for the docs theme customizer. One module-level store so the
 * navbar popover (ThemePicker) and the inline panel on the Design Tokens page
 * (ThemePanel) stay in sync when both are on the same page.
 *
 * Persistence contract (shared with the pre-paint head script registered in
 * astro.config.mjs, which re-applies the saved CSS before first paint so
 * there's no flash of the default theme):
 *   - delightstack:theme-overrides — JSON of the picked prefs (UI state)
 *   - delightstack:theme-css       — the generated CSS text (what's applied)
 *   - <style id="delightstack-theme-overrides"> in <head> — the live styles
 */
export const STORAGE_KEY = 'delightstack:theme-overrides';
export const CSS_KEY = 'delightstack:theme-css';
export const STYLE_ID = 'delightstack-theme-overrides';

export const TOKENS = [
	{ key: 'primary', css_var: '--color-primary', label: 'Primary' },
	{ key: 'secondary', css_var: '--color-secondary', label: 'Secondary' },
	{ key: 'neutral', css_var: '--color-neutral', label: 'Neutral' },
	{ key: 'error', css_var: '--color-error', label: 'Error' },
	{ key: 'success', css_var: '--color-success', label: 'Success' },
	{ key: 'warning', css_var: '--color-warning', label: 'Warning' },
] as const;
export type TokenKey = (typeof TOKENS)[number]['key'];
export type Colors = Partial<Record<TokenKey, string>>;

/** One-click primary seeds. Secondary and neutral derive from primary in
 * tokens.css, so a single color re-themes everything. */
export const PRESETS = [
	{ name: 'Grape', primary: '#7c3aed' },
	{ name: 'Forest', primary: '#15803d' },
	{ name: 'Sunset', primary: '#ea580c' },
	{ name: 'Rose', primary: '#e11d48' },
	{ name: 'Indigo', primary: '#4f46e5' },
	{ name: 'Slate', primary: '#475569' },
] as const;
export type Preset = (typeof PRESETS)[number];

/** Multipliers applied to the default --radius-* scale (sm..3xl). */
const ROUNDNESS = {
	sharp: 0,
	subtle: 0.5,
	default: 1,
	round: 1.75,
	extra: 2.5,
} as const;
export type RoundnessKey = keyof typeof ROUNDNESS;
export const ROUNDNESS_OPTIONS: { label: string; value: RoundnessKey }[] = [
	{ label: 'Sharp', value: 'sharp' },
	{ label: 'Subtle', value: 'subtle' },
	{ label: 'Default', value: 'default' },
	{ label: 'Round', value: 'round' },
	{ label: 'Extra round', value: 'extra' },
];
const RADIUS_SCALE = [
	['sm', 2],
	['md', 5],
	['lg', 10],
	['xl', 20],
	['2xl', 30],
	['3xl', 60],
] as const;

/** Control height ratio + inline padding per density (see tokens.css). */
/* All three ratios shift together — components marked dense/comfortable read
 * their own ratio token, so overriding only the default ratio would leave
 * most controls (e.g. the docs demos) untouched. */
const DENSITY = {
	dense: [
		'--control-height-ratio: 2.5;',
		'--control-height-ratio-dense: 2;',
		'--control-height-ratio-comfortable: 3;',
		'--control-pad-x: 0.75em;',
	],
	default: [],
	comfortable: [
		'--control-height-ratio: 3.5;',
		'--control-height-ratio-dense: 3;',
		'--control-height-ratio-comfortable: 4;',
		'--control-pad-x: 1.25em;',
	],
} as const;
export type DensityKey = keyof typeof DENSITY;
export const DENSITY_OPTIONS: { label: string; value: DensityKey }[] = [
	{ label: 'Dense', value: 'dense' },
	{ label: 'Default', value: 'default' },
	{ label: 'Comfortable', value: 'comfortable' },
];

/** System font stacks (no webfont downloads) for --font-sans. */
const FONTS = {
	default: '',
	grotesque: `Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif`,
	humanist: `Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif`,
	geometric: `Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif`,
	rounded: `ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', 'Arial Rounded MT Bold', Calibri, source-sans-pro, sans-serif`,
	serif: `Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif`,
} as const;
export type FontKey = keyof typeof FONTS;
export const FONT_OPTIONS: { label: string; value: FontKey }[] = [
	{ label: 'System', value: 'default' },
	{ label: 'Grotesque', value: 'grotesque' },
	{ label: 'Humanist', value: 'humanist' },
	{ label: 'Geometric', value: 'geometric' },
	{ label: 'Rounded', value: 'rounded' },
	{ label: 'Serif', value: 'serif' },
];

export interface Prefs {
	colors: Colors;
	roundness: RoundnessKey;
	density: DensityKey;
	font: FontKey;
}

const HEX = /^#[0-9a-f]{6}$/i;

function loadStored(): Prefs {
	const prefs: Prefs = {
		colors: {},
		roundness: 'default',
		density: 'default',
		font: 'default',
	};
	if (typeof localStorage === 'undefined') return prefs;
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
		if (!parsed || typeof parsed !== 'object') return prefs;
		const stored = parsed as Record<string, unknown>;
		const colors =
			stored.colors && typeof stored.colors === 'object'
				? (stored.colors as Record<string, unknown>)
				: {};
		for (const token of TOKENS) {
			const value = colors[token.key];
			if (typeof value === 'string' && HEX.test(value)) prefs.colors[token.key] = value;
		}
		if (typeof stored.roundness === 'string' && stored.roundness in ROUNDNESS) {
			prefs.roundness = stored.roundness as RoundnessKey;
		}
		if (typeof stored.density === 'string' && stored.density in DENSITY) {
			prefs.density = stored.density as DensityKey;
		}
		if (typeof stored.font === 'string' && stored.font in FONTS) {
			prefs.font = stored.font as FontKey;
		}
	} catch {
		// corrupted storage — fall back to defaults
	}
	return prefs;
}

/**
 * Builds the portable override CSS (what visitors copy into their app). The
 * three seeds re-derive the rest of the palette on their own; the feedback
 * colors are standalone light-dark pairs in tokens.css, so their state/text
 * variants are regenerated here with the same relative-color recipes the
 * action tokens use.
 */
export function generateCss(prefs: Prefs): string {
	const lines: string[] = [];
	const colors = prefs.colors;
	if (colors.primary) lines.push(`--color-primary: ${colors.primary};`);
	if (colors.secondary) lines.push(`--color-secondary: ${colors.secondary};`);
	if (colors.neutral) lines.push(`--color-neutral: ${colors.neutral};`);
	for (const key of ['error', 'success'] as const) {
		const hex = colors[key];
		if (!hex) continue;
		lines.push(
			`--color-${key}: light-dark(${hex}, oklch(from ${hex} calc(l - 0.12) c h));`,
			`--color-${key}-active: light-dark(oklch(from var(--color-${key}) calc(l - 0.06) calc(c + 0.02) h), oklch(from var(--color-${key}) calc(l + 0.07) calc(c + 0.02) h));`,
			`--color-${key}-disabled: light-dark(oklch(from var(--color-${key}) calc(l + 0.08) calc(c - 0.01) h), oklch(from var(--color-${key}) calc(l - 0.1) calc(c - 0.02) h));`,
			`--color-${key}-text: oklch(from ${hex} 96% min(0.05, c) h);`,
			`--color-${key}-text-disabled: light-dark(oklch(from ${hex} 82% min(0.09, c) h), oklch(from ${hex} 66% min(0.09, c) h));`,
			`--color-${key}-text-active: #ffffff;`,
		);
	}
	if (colors.warning) lines.push(`--color-warning: ${colors.warning};`);
	if (prefs.roundness !== 'default') {
		const factor = ROUNDNESS[prefs.roundness];
		for (const [name, px] of RADIUS_SCALE) {
			lines.push(`--radius-${name}: ${Math.round(px * factor * 10) / 10}px;`);
		}
	}
	lines.push(...DENSITY[prefs.density]);
	if (prefs.font !== 'default') lines.push(`--font-sans: ${FONTS[prefs.font]};`);
	if (!lines.length) return '';
	return `:root {\n${lines.map((line) => `\t${line}`).join('\n')}\n}`;
}

/** Docs-only additions applied (and persisted) but NOT shown in the copyable
 * snippet — Starlight's body text runs on --sl-font, not --font-sans. */
function docsOnlyCss(prefs: Prefs): string {
	if (prefs.font === 'default') return '';
	return `\n:root {\n\t--sl-font: var(--font-sans);\n}`;
}

/**
 * Resolves each color token's current effective value to a hex for the
 * pickers. light-dark()/oklch() computed values aren't hex, so the color is
 * pushed through a 1×1 canvas to normalize it to sRGB bytes.
 *
 * This is expensive (forced style recalc + canvas readbacks), so it runs only
 * from the deferred commit() — never on the live input stream. One probe per
 * token, all computed colors read in a single pass, so the whole batch costs
 * one style recalc instead of one per token.
 */
function resolveDefaults(): Colors {
	const container = document.createElement('div');
	const probes = TOKENS.map((token) => {
		const probe = document.createElement('span');
		probe.style.color = `var(${token.css_var})`;
		container.appendChild(probe);
		return probe;
	});
	document.body.appendChild(container);
	const computed = probes.map((probe) => getComputedStyle(probe).color);
	container.remove();
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const resolved: Colors = {};
	if (!ctx) return resolved;
	TOKENS.forEach((token, i) => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = computed[i];
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		resolved[token.key] =
			`#${[r, g, b].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	});
	return resolved;
}

const state = $state({
	prefs: loadStored(),
	/** Effective color of each token right now (for un-overridden pickers). */
	defaults: {} as Colors,
});

let commit_timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Applies the current prefs to the live page. This is the hot path while the
 * user drags a color picker, so it does the minimum: update one <style> tag
 * (a single batched style recalc at the next frame). Persistence and swatch
 * re-resolution are deferred to commit().
 */
function applyStyle(): string {
	const applied = generateCss(state.prefs) + docsOnlyCss(state.prefs);
	let style = document.getElementById(STYLE_ID);
	if (!applied) {
		style?.remove();
	} else {
		if (!style) {
			style = document.createElement('style');
			style.id = STYLE_ID;
			document.head.appendChild(style);
		}
		style.textContent = applied;
	}
	return applied;
}

/** The deferred bookkeeping: persist to localStorage and re-resolve the
 * effective swatch colors (which forces style recalcs + canvas readbacks). */
function commit() {
	clearTimeout(commit_timer);
	commit_timer = undefined;
	const applied = generateCss(state.prefs) + docsOnlyCss(state.prefs);
	try {
		if (!applied) {
			localStorage.removeItem(STORAGE_KEY);
			localStorage.removeItem(CSS_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state.prefs));
			localStorage.setItem(CSS_KEY, applied);
		}
	} catch {
		// localStorage unavailable (private mode etc.) — live preview still works
	}
	state.defaults = resolveDefaults();
}

/** Applies the current prefs to the page; commits after the input stream
 * settles (the live color update itself is NOT debounced). */
function sync(immediate = false) {
	applyStyle();
	clearTimeout(commit_timer);
	if (immediate) commit();
	else commit_timer = setTimeout(commit, 150);
}

export const theme = {
	get prefs() {
		return state.prefs;
	},
	get defaults() {
		return state.defaults;
	},
	get css() {
		return generateCss(state.prefs);
	},
	get has_overrides() {
		return generateCss(state.prefs) !== '';
	},
	setColor(key: TokenKey, hex: string) {
		if (!HEX.test(hex)) return;
		const colors = { ...state.prefs.colors, [key]: hex };
		// Picking a primary un-locks the derived seeds — otherwise an earlier
		// secondary/neutral override would silently pin the old hue and the
		// "one color themes everything" promise breaks.
		if (key === 'primary') {
			delete colors.secondary;
			delete colors.neutral;
		}
		state.prefs.colors = colors;
		sync();
	},
	setPreset(preset: Preset) {
		const colors = { ...state.prefs.colors, primary: preset.primary };
		delete colors.secondary;
		delete colors.neutral;
		state.prefs.colors = colors;
		sync();
	},
	setRoundness(value: RoundnessKey) {
		state.prefs.roundness = value;
		sync();
	},
	setDensity(value: DensityKey) {
		state.prefs.density = value;
		sync();
	},
	setFont(value: FontKey) {
		state.prefs.font = value;
		sync();
	},
	reset() {
		state.prefs = {
			colors: {},
			roundness: 'default',
			density: 'default',
			font: 'default',
		};
		sync(true);
	},
	/** Re-resolve the effective token colors (call when a panel mounts). */
	refreshDefaults() {
		state.defaults = resolveDefaults();
	},
};
