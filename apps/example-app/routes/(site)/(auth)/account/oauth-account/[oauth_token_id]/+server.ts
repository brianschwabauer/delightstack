import { apiError } from '@packages/lib';
import type { OauthApi, OauthToken } from '@packages/types';

export async function DELETE({ locals, params }) {
	if (!locals.authState.id) {
		throw apiError({
			status: 401,
			message: `Must be signed in to disconnect an oauth account`,
		});
	}
	const oauth_token_id = params.oauth_token_id;
	const oauth_token = (await locals.auth.getOauthToken(oauth_token_id)) as OauthToken;
	const api: OauthApi = await locals.getVendorApi(
		oauth_token.vendor as any,
		oauth_token_id,
	);
	await api.oauth.revoke().catch(() => undefined);
	await locals.auth.disconnectOauthAccount(oauth_token);
	return new Response(null, { status: 204 });
}
