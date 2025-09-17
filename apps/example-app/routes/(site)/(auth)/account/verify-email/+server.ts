import { env } from '$env/dynamic/private';
import { apiError } from '@packages/lib';

export async function POST({ locals, url }) {
	if (!locals.authState.user_session_id || !locals.authState.email) {
		throw apiError({ status: 401, message: `Unauthorized` });
	}
	if (locals.authState.verified) return new Response(null, { status: 204 });

	const email_verification_token = await locals.auth.createEmailVerficationToken(
		locals.authState.user_session_id,
		locals.authState.meta,
	);
	const link = new URL(
		`${url.origin}/account/verify-email/${email_verification_token.jwt}`,
	);
	if (url.searchParams.get('redirect')) {
		link.searchParams.set('redirect', url.searchParams.get('redirect') || '');
	}
	const response = await fetch(`https://api.resend.com/emails`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.RESEND_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			from: `Forever Family <support@email.foreverfamily.app>`,
			to: [locals.authState.email],
			subject: `Verify your email for Forever Family`,
			html: `
				<p>Hello,</p>
				<p>Follow this link to verify your email address</p>
				<p><a href="${link.href}">${link.href}</a></p>
				<p>If you didn't ask to verify this address, you can ignore this email.</p>
				<p>Thanks,</p>
				<p>The Forever Family team</p>
			`,
		}),
	});
	if (!response.ok) {
		throw apiError({ status: 500, message: `Failed to send email verification email` });
	}
	return new Response(null, { status: 204 });
}
