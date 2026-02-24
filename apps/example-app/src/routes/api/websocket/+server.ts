import { DelightError } from '@packages/lib';

export async function GET({ locals, request }) {
	const { ws } = locals;
	if (request.headers.get('Upgrade') === 'websocket') {
		if (!ws) {
			throw new DelightError({
				message: `Websocket server couldn't be reached`,
				status: 500,
			});
		}
		return ws.fetch(request);
	}
	return new Response(
		JSON.stringify({ status: 400, message: 'Not a websocket request' }),
		{ status: 400 },
	);
}
