import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import type { AuthLocals } from '../server/auth.handler';
import { decodePermissions } from '../types';

interface GuardOptions {
	/** URL to redirect unauthenticated users to @default '/signin' */
	redirect_to?: string;
}

/**
 * Creates typed auth guard functions bound to your permissions and entitlements arrays.
 *
 * @example
 * ```ts
 * const { requireAuth, requireOrg, requirePermission, requireEntitlement } = createAuthGuards({
 *   permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'] as const,
 *   entitlements: ['premium', 'video-uploads'] as const,
 * });
 *
 * // In +layout.server.ts:
 * export const load = requireAuth(({ locals }) => ({ user: locals.user }));
 * export const load = requirePermission('org:admin', ({ locals }) => ({ user: locals.user }));
 * export const load = requireEntitlement('premium', ({ locals }) => ({ org: locals.org }));
 * ```
 */
export function createAuthGuards<
	const P extends string,
	const E extends string = never,
>(options: { permissions: readonly P[]; entitlements?: readonly E[] }) {
	const { permissions, entitlements = [] } = options;
	type Permission = P;
	type Entitlement = E;

	function requireAuth<T>(
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		guardOptions?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	function requireOrg<T>(
		loadFn: (
			event: ServerLoadEvent & {
				locals: AuthLocals & { org_id: string; org: NonNullable<AuthLocals['org']> };
			},
		) => T | Promise<T>,
		guardOptions?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			return loadFn(
				event as ServerLoadEvent & {
					locals: AuthLocals & { org_id: string; org: NonNullable<AuthLocals['org']> };
				},
			);
		};
	}

	function requirePermission<T>(
		permission: Permission,
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		guardOptions?: GuardOptions & { forbidden_redirect?: string },
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			const decoded = decodePermissions(permissions, locals.org.permissions);
			if (!decoded.includes(permission)) {
				throw redirect(302, guardOptions?.forbidden_redirect ?? '/403');
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	function requireEntitlement<T>(
		entitlement: Entitlement,
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		guardOptions?: GuardOptions & { forbidden_redirect?: string },
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			if (locals.org.entitlements == null) {
				throw redirect(302, guardOptions?.forbidden_redirect ?? '/403');
			}
			const decoded = decodePermissions(entitlements, locals.org.entitlements);
			if (!decoded.includes(entitlement)) {
				throw redirect(302, guardOptions?.forbidden_redirect ?? '/403');
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	return { requireAuth, requireOrg, requirePermission, requireEntitlement };
}
