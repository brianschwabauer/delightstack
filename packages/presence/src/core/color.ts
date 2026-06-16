import { colorHash } from '@delightstack/utilities';

/**
 * Resolve a stable, recognizable color for a user as a CSS color string.
 * Derived from the user id (falls back to the name) so the same person keeps the
 * same color everywhere in the app.
 */
export function userColor(user: { id?: string; name?: string }): string {
	// Vivid, well-separated hues so each person is instantly recognizable —
	// the default colorHash tuning is muted, which reads poorly for cursors.
	return colorHash(user.id || user.name || '', { saturation: 0.7, lightness: 0.58 });
}
