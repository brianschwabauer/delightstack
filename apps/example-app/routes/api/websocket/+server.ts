import { apiError } from '@packages/lib';

export async function GET({ locals, request }) {
	const { ws } = locals;
	if (request.headers.get('Upgrade') === 'websocket') {
		if (!ws) {
			throw apiError({ status: 500, message: `Websocket server couldn't be reached` });
		}
		return ws.fetch(request);
	}
	return new Response(
		JSON.stringify({ status: 400, message: 'Not a websocket request' }),
		{ status: 400 },
	);
}
