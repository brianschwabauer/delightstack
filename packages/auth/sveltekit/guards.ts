import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import type { AuthLocals } from '../server/auth.handler';
import { decodePermissions } from '../types';

interface GuardOptions {
	/** URL to redirect unauthenticated users to @default '/signin' */
	redirect_to?: string;
}

/**
 * Creates typed auth guard functions bound to your permissions array.
 *
 * @example
 * ```ts
 * const { requireAuth, requireOrg, requirePermission } = createAuthGuards(
 *   ['org:read', 'org:write', 'org:admin', 'org:owner'] as const,
 * );
 *
 * // In +layout.server.ts:
 * export const load = requireAuth(({ locals }) => ({ user: locals.user }));
 * export const load = requirePermission('org:admin', ({ locals }) => ({ user: locals.user }));
 * ```
 */
export function createAuthGuards<const P extends string>(permissions: readonly P[]) {
	type Permission = P;

	function requireAuth<T>(
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		options?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = options?.redirect_to ?? '/signin';
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
		options?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = options?.redirect_to ?? '/signin';
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
		options?: GuardOptions & { forbidden_redirect?: string },
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = options?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			const decoded = decodePermissions(permissions, locals.org.role);
			if (!decoded.includes(permission)) {
				throw redirect(302, options?.forbidden_redirect ?? '/403');
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	return { requireAuth, requireOrg, requirePermission };
}
