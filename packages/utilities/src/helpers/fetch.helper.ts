/**
 * Retries a fetch call to a url with the given amount of max retries before failing
 * If given an array for retries, it will treat the array as the delays in MS before retrying
 * Defaults to exponential backoff 5 attempts
 */
export async function retryFetch(
	url: string,
	init?: RequestInit,
	retries: number | number[] = [100, 1000, 2000, 4000, 8000, 16000],
): Promise<Response> {
	const response = await fetch(`${url}`, init)
		.catch(() => fetch(`${url}`, init))
		.catch(() => new Response(null, { status: 500 }));
	if (!response.ok && response.status !== 404) {
		const retryDelays = Array.isArray(retries)
			? [...retries]
			: Array.from({ length: retries }, () => 100);
		if (retryDelays.length <= 0) return response;
		const nextDelay = retryDelays.shift();
		const retryAfter =
			+(response.headers.get('Retry-After')?.trim?.() || '') * 1000 ||
			new Date(response.headers.get('Retry-After') || '').getTime() - Date.now() ||
			nextDelay;
		await new Promise((resolve) => setTimeout(resolve, retryAfter));
		return retryFetch(url, init, retryDelays);
	}
	return response;
}
