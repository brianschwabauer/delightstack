import { env } from '$env/dynamic/private';
import { EmailSignUp } from '@packages/types';

export async function POST({ request, cookies, locals, url }) {
	const { auth } = locals;
	const raw_body = await request.json<EmailSignUp>();
	const body = EmailSignUp.parse(raw_body);
	let { jwt, decoded_jwt, user_session_id } = await auth.signUpWithEmail(
		body,
		locals.authState.meta,
	);
	cookies.set('foreverfamily-session', jwt, { path: '/' });

	if (!body.password) {
		const email_signin_token = await locals.auth.createEmailSignInToken(
			body.email,
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
				to: [body.email],
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
	} else {
		const email_verification_token = await locals.auth
			.createEmailVerficationToken(user_session_id, locals.authState.meta)
			.catch((error) => console.log(`Couldn't create email verification token`, error));
		if (email_verification_token) {
			const params = new URLSearchParams(url.search);
			const link = `${url.origin}/account/verify-email/${email_verification_token.jwt}${params.size ? '?' : ''}${params}`;
			await fetch(`https://api.resend.com/emails`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.RESEND_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from: `Forever Family <support@email.foreverfamily.app>`,
					to: [body.email],
					subject: `Verify your email for Forever Family`,
					html: `
						<p>Hello,</p>
						<p>Follow this link to verify your email address</p>
						<p><a href="${link}">${link}</a></p>
						<p>If you didn't ask to verify this address, you can ignore this email.</p>
						<p>Thanks,</p>
						<p>The Forever Family team</p>
					`,
				}),
			});
		}
	}

	return new Response(JSON.stringify({ jwt, decoded_jwt }));
}
