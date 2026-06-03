/** Ambient type declarations for container dependencies without bundled types */

declare module 'culori' {
	interface OklchColor {
		mode: 'oklch';
		l: number;
		c: number;
		h: number;
		alpha?: number;
	}

	interface Color {
		mode: string;
		[key: string]: unknown;
	}

	function parse(input: string): Color | undefined;
	function oklch(color: Color | undefined): OklchColor | undefined;
}
