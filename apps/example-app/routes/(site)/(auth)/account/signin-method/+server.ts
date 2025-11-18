import { env } from '$env/dynamic/private';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id) {
		throw apiError({ status: 401, message: `Must be signed in to view sign in methods` });
	}
	const methods = await locals.auth.listSignInMethods(locals.authState.id);
	return json(methods);
}

export async function POST({ locals, request, url }) {
	if (!locals.authState.id) {
		throw apiError({ status: 401, message: `Must be signed in to add sign in methods` });
	}
	const method = await request.json<any>();
	if (!method?.email) {
		throw apiError({ status: 400, message: `Must provide an email address` });
	}
	const { user_auth_id, user_id, decoded_jwt, user_session_id } =
		await locals.auth.createEmailSignIn(
			locals.authState.id,
			method.email,
			method.password,
			locals.authState.meta,
		);

	try {
		if (method.password) {
			const email_verification_token = await locals.auth.createEmailVerficationToken(
				user_session_id,
				locals.authState.meta,
			);
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
					to: [method.email],
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
		} else {
			const email_signin_token = await locals.auth.createEmailSignInToken(
				method.email,
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
					to: [method.email],
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
		}

		const methods = await locals.auth.listSignInMethods(user_id);
		const notify_users = methods.list.filter(
			(method) =>
				method.id !== user_auth_id &&
				!!method.verified_at &&
				method.email &&
				method.email !== decoded_jwt.email,
		);
		if (notify_users.length) {
			await fetch(`https://api.resend.com/emails`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.RESEND_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from: `Forever Family <support@email.foreverfamily.app>`,
					to: notify_users.map((user) => user.email),
					subject: `New sign-in method for Forever Family`,
					html: `
						<p>Hello,</p>
						<p>A new sign in method was added to your Forever Family account with the email: ${decoded_jwt.email}.</p>
						<p>If you didn't intend to add that email to your account, you can remove it in your account settings.</p>
						<p>Thanks,</p>
						<p>The Forever Family team</p>
					`,
				}),
			});
		}
	} catch (error) {}

	return new Response(null, { status: 204 });
}
