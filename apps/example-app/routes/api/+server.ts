import type { RequestHandler } from './$types';

export const trailingSlash = 'never';

export const GET: RequestHandler = async () => {
	return new Response('Hello world!');
};
