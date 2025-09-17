import { env } from '$env/dynamic/private';
import { apiError } from '@packages/lib';

export async function POST({ locals, request, url }) {
	const unsafe_body = await request.json<any>();
	const email = unsafe_body.email?.trim()?.toLowerCase();
	if (!email) throw apiError({ status: 400, message: `Email is required` });

	const password_reset_token = await locals.auth.createPasswordResetToken(
		email,
		locals.authState.meta,
	);
	const link = new URL(
		`${url.origin}/account/reset-password/${password_reset_token.jwt}`,
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
			to: [email],
			subject: `Reset your password for Forever Family`,
			html: `
				<p>Hello,</p>
				<p>Follow this link to reset your password for your ${email} account</p>
				<p><a href="${link.href}">${link.href}</a></p>
				<p>If you didn't ask to reset your password, you can ignore this email.</p>
				<p>Thanks,</p>
				<p>The Forever Family team</p>
			`,
		}),
	});
	if (!response.ok) {
		throw apiError({ status: 500, message: `Failed to send password reset email` });
	}
	return new Response(null, { status: 204 });
}
