export async function POST({ locals, params, cookies }) {
	const { email_verification_token } = params;
	const { jwt } = await locals.auth.verifyEmail(
		email_verification_token,
		locals.authState.meta,
	);
	cookies.set('foreverfamily-session', jwt, { path: '/' });
	return new Response(null, { status: 204 });
}
