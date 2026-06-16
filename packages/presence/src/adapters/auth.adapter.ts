import type { AuthClient } from '@delightstack/auth/client';
import type { PresenceIdentity, IdentityUser } from '../types';

/**
 * Wrap a `@delightstack/auth` client as a {@link PresenceIdentity}.
 *
 * Note: the auth JWT does not currently carry the avatar image, so `image` is
 * only populated if a custom session token includes it; otherwise presence UI
 * falls back to initials.
 */
export function authIdentity(auth: AuthClient): PresenceIdentity {
	return {
		get user(): IdentityUser | null {
			if (!auth.id || !auth.name) return null;
			const image = (auth.session as Record<string, unknown> | null)?.image as
				| string
				| undefined;
			return { id: auth.id, name: auth.name, image };
		},
		get orgId() {
			return auth.org_id;
		},
	};
}
