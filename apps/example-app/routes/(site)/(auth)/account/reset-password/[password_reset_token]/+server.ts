import { apiError } from '@packages/lib';

export async function POST({ locals, request, params, cookies }) {
	const { password_reset_token } = params;

	const unsafe_body = await request.json<any>();
	const password = unsafe_body?.password;
	if (!password) throw apiError({ status: 400, message: `New password is required` });

	const { jwt } = await locals.auth.resetPassword(
		password_reset_token,
		password,
		locals.authState.meta,
	);
	cookies.set('foreverfamily-session', jwt, { path: '/' });
	return new Response(null, { status: 204 });
}
