import { env } from '$env/dynamic/private';
import { EmailPasswordSignIn } from '@packages/types';

export async function POST({ url, request, cookies, locals }) {
	const { auth, authState } = locals;

	// The user is trying to refresh their token instead of creating a new session
	if (request.headers.get('Content-Length') === '0') {
		if (authState.token) {
			const refreshed = await auth
				.refreshSession(authState.token.jti, locals.authState.meta)
				.catch(() => undefined);
			if (refreshed?.jwt) {
				cookies.set('foreverfamily-session', refreshed.jwt, { path: '/' });
				return new Response(
					JSON.stringify({
						jwt: refreshed.jwt,
						decoded_jwt: refreshed.decoded_jwt,
						orgID: authState.orgID,
					}),
				);
			}
			cookies.delete('foreverfamily-session', { path: '/' });
			cookies.delete('foreverfamily-org', { path: '/' });
			return new Response(
				JSON.stringify({
					status: 401,
					message: `Refresh token expired or invalid`,
				}),
				{ status: 401 },
			);
		}
		return new Response(
			JSON.stringify({
				status: 401,
				message: `Must provide email/password or refresh token`,
			}),
			{ status: 401 },
		);
	}

	const raw_body = await request.json<EmailPasswordSignIn>();

	// The user is trying to sign in with an email address only (via magic link)
	if (!raw_body.password) {
		const email_signin_token = await locals.auth.createEmailSignInToken(
			raw_body.email,
			locals.authState.meta,
		);
		const params = new URLSearchParams(url.search);
		params.set('token', email_signin_token.jwt);
		const link = `${url.origin}/signin?${params}`;
		await fetch(`https://api.resend.com/emails`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.RESEND_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				from: `Forever Family <support@email.foreverfamily.app>`,
				to: [raw_body.email],
				subject: `Sign in to Forever Family`,
				html: `
					<p>Hello,</p>
					<p>Follow this link to sign in to your Forever Family account.</p>
					<p><a href="${link}">${link}</a></p>
					<p>If you didn't ask to sign in to this email address, you can ignore this email.</p>
					<p>Thanks,</p>
					<p>The Forever Family team</p>
				`,
			}),
		});
		return new Response(null, { status: 204 });
	}

	// The user is trying to sign in with an email and password
	const body = EmailPasswordSignIn.parse(raw_body);
	const { jwt, decoded_jwt } = await auth.signInWithEmail(body, locals.authState.meta);

	// Determine the orgID from the request
	let orgID =
		url.pathname.match(/\/org\/(\w+)/)?.[1] ||
		request.headers.get('Org-ID') ||
		request.headers.get('OrgID') ||
		url.searchParams.get('orgID') ||
		request.headers.get('Org') ||
		url.searchParams.get('org') ||
		undefined;
	if (orgID === undefined) {
		const orgs = Array.from(new Set([...Object.keys(decoded_jwt?.org || {})])).sort(
			(a, b) => (decoded_jwt?.org?.[b]?.role || 0) - (decoded_jwt?.org?.[a]?.role || 0),
		);
		if (orgs.length === 1) orgID = orgs[0];
	}
	orgID = orgID !== 'null' ? orgID : undefined;
	if (orgID && !decoded_jwt.org?.[orgID]?.role) orgID = undefined;
	if (jwt) cookies.set('foreverfamily-session', jwt, { path: '/' });
	if (orgID) cookies.set('foreverfamily-org', orgID, { path: '/' });
	return new Response(JSON.stringify({ jwt, decoded_jwt, orgID }));
}
