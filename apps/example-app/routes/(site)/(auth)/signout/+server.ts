export async function POST({ locals, cookies }) {
	const { auth, authState } = locals;
	if (!authState.token) {
		return new Response(null, { status: 401 });
	}
	await auth.revokeSession(authState.token.jti).catch(() => undefined);
	cookies.delete('foreverfamily-session', { path: '/' });
	cookies.delete('foreverfamily-org', { path: '/' });
	return new Response(null, { status: 204 });
}
