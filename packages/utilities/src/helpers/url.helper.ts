/** Returns whether the given query value should be treated as true */
export const isQueryTruthy = (query: string | boolean | null | undefined): boolean => {
	return query === '' || query === '1' || query === 'true' || query === true;
};

/** Returns whether the given query value should be treated as false */
export const isQueryFalsey = (query: string | boolean | null | undefined): boolean => {
	return query === '0' || query === 'false' || query === false;
};

/** Returns the parsed version of the given URL */
export function parseUrl(url: string): URL | undefined {
	try {
		const formatted = `https://${(url || '').replace(/^https?:\/\//, '')}`;
		return new URL(formatted);
	} catch (error) {
		return;
	}
}

/**
 * Given a stardard string, this will encode it into a websafe base64 string
 * A websafe base64 string uses '_' instead of '/' and '-' instead of '+'
 */
export function encodeWebsafeBase64(val: string): string {
	const formatted = typeof val === 'string' ? val : '';
	return btoa(formatted).replace(/\//g, '_').replace(/\+/g, '-');
}

/**
 * Given a websafe base64 string, this will decode it into the stardard string
 * A websafe base64 string uses '_' instead of '/' and '-' instead of '+'
 */
export function decodeWebsafeBase64(val: string): string {
	const formatted = typeof val === 'string' ? val : '';
	return atob(formatted).replace(/\//g, '_').replace(/\+/g, '-');
}
