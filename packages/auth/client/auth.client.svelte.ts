import type {
	SessionToken,
	UserSession,
	UserSignInMethod,
	OauthAccount,
} from '../types';
import { resolveErrorCode, type AuthErrorCode } from '../types/error.type';

/** Error shape returned by AuthClient API methods */
export interface AuthClientError {
	code: AuthErrorCode;
	message: string;
	status: number;
	detail?: string;
}

/** Typed result from API methods */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthClientError };

/** Serialized form for SSR hydration */
export interface AuthClientData {
	jwt: string | null;
	session: SessionToken<'auth'> | null;
	org_id: string | null;
}

/**
 * A single reactive class combining auth state AND API methods.
 * Uses Svelte 5 `$state()` / `$derived()` runes.
 * State properties are at the top level; all API operations are nested under `.api`.
 *
 * @example
 * ```ts
 * // In +layout.ts:
 * const auth = new AuthClient(data.auth);
 * return { auth };
 *
 * // In components:
 * auth.signed_in  // reactive boolean
 * auth.name       // reactive string
 * auth.api.signIn.email({ email, password })
 * auth.api.signOut()
 * ```
 */
export class AuthClient {
	// -- Reactive state (Svelte 5 class runes) --
	jwt = $state<string | null>(null);
	session = $state<SessionToken<'auth'> | null>(null);
	private _org_id = $state<string | null>(null);

	// -- Derived state properties --
	signed_in = $derived(!!this.session);
	signed_out = $derived(!this.session);

	id = $derived(this.session?.uid ?? null);
	name = $derived(this.session?.name ?? null);
	email = $derived(this.session?.email ?? null);
	verified = $derived(this.session?.verified ?? false);

	user_auth_id = $derived(this.session?.sub ?? null);
	user_session_id = $derived(this.session?.jti ?? null);

	org_id = $derived(this._org_id);
	org = $derived.by(() => {
		if (!this.session || !this._org_id) return null;
		const org = this.session.org[this._org_id];
		if (!org) return null;
		return {
			id: this._org_id,
			name: org.name,
			role: org.role,
			db: org.db,
			plan: org.plan,
		};
	});

	orgs = $derived.by(() => {
		if (!this.session) return [];
		return Object.entries(this.session.org).map(([id, o]) => ({
			id,
			name: o.name,
			role: o.role,
			db: o.db,
			plan: o.plan,
		}));
	});

	org_ids = $derived(this.orgs.map((o) => o.id));
	token = $derived(this.session);

	// -- Config --
	private base_path: string;
	private refresh_threshold_ms: number;
	private refresh_timer: ReturnType<typeof setTimeout> | null = null;
	private fetchFn: typeof fetch;

	constructor(
		data?: AuthClientData,
		options?: {
			base_path?: string;
			refresh_threshold_ms?: number;
			fetch?: typeof fetch;
		},
	) {
		this.jwt = data?.jwt ?? null;
		this.session = data?.session ?? null;
		this._org_id = data?.org_id ?? null;
		this.base_path = options?.base_path ?? '/api/auth';
		this.refresh_threshold_ms = options?.refresh_threshold_ms ?? 600_000;
		this.fetchFn = options?.fetch ?? fetch;

		if (this.session) this.startAutoRefresh();
	}

	/** Serializes state for SSR hydration (used by `+layout.server.ts`) */
	toJSON(): AuthClientData {
		return { jwt: this.jwt, session: this.session, org_id: this._org_id };
	}

	/** Creates an AuthClient from serialized data (used by `+layout.ts`) */
	static from(
		data: AuthClientData,
		options?: { base_path?: string },
	): AuthClient {
		return new AuthClient(data, options);
	}

	/** Checks if the current org role includes the given permission bit */
	isAllowed(
		permission: string,
		permission_map?: Record<string, number>,
	): boolean {
		if (!this.org || !permission_map) return false;
		const bit = permission_map[permission];
		if (bit === undefined) return false;
		return (this.org.role & (1 << bit)) !== 0;
	}

	// -- All API methods nested under .api --
	api = {
		signIn: {
			email: async (data: {
				email: string;
				password: string;
			}): Promise<
				AuthResult<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>('/signin/email', data);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					if (result.data.org_id) this._org_id = result.data.org_id;
					this.startAutoRefresh();
				}
				return result;
			},
			emailMagicLink: async (data: {
				email: string;
			}): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(
					`${this.base_path}/signin/email/magic`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(data),
					},
				);
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			oauth: (
				vendor: string,
				options?: { redirect_to?: string },
			) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				window.location.href = `${this.base_path}/signin/${vendor}?${params}`;
			},
		},

		signUp: {
			email: async (data: {
				name: string;
				email: string;
				password?: string;
				org_name?: string;
				invitation_id?: string;
			}): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/signup/email', data);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this.startAutoRefresh();
				}
				return result;
			},
		},

		signOut: async (): Promise<AuthResult<void>> => {
			const res = await this.fetchFn(`${this.base_path}/signout`, {
				method: 'POST',
			});
			if (!res.ok) return { ok: false, error: await this.parseError(res) };
			this.jwt = null;
			this.session = null;
			this._org_id = null;
			this.stopAutoRefresh();
			return { ok: true, data: undefined };
		},

		session: {
			get: async (): Promise<
				AuthResult<{
					session: SessionToken<'auth'>;
					user: {
						id: string;
						name: string;
						email: string;
						verified: boolean;
					};
					org_id: string | null;
				}>
			> => {
				return this.get('/session');
			},
			refresh: async (): Promise<
				AuthResult<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>('/session/refresh', undefined);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					if (result.data.org_id) this._org_id = result.data.org_id;
					this.startAutoRefresh();
				}
				return result;
			},
			list: async (): Promise<
				AuthResult<{
					list: UserSession[];
					count: number;
					hasMore: boolean;
				}>
			> => {
				return this.get('/session/list');
			},
			revoke: async (session_id: string): Promise<AuthResult<void>> => {
				return this.del(`/session/${session_id}`);
			},
		},

		password: {
			reset: async (email: string): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(
					`${this.base_path}/password/reset`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email }),
					},
				);
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			confirmReset: async (
				token: string,
				password: string,
			): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/password/reset/confirm', { token, password });
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this.startAutoRefresh();
				}
				return result;
			},
			change: async (
				password: string,
			): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>
			> => {
				const result = await this.patch<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/password', { password });
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this.startAutoRefresh();
				}
				return result;
			},
			checkStrength: async (
				password: string,
			): Promise<AuthResult<{ strong: boolean }>> => {
				return this.post('/password/check', { password });
			},
		},

		email: {
			requestVerification: async (): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(`${this.base_path}/email/verify`, {
					method: 'POST',
				});
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			checkAvailability: async (
				email: string,
			): Promise<AuthResult<{ available: boolean }>> => {
				const params = new URLSearchParams({ email });
				return this.get(`/email/check?${params}`);
			},
		},

		user: {
			get: async (): Promise<
				AuthResult<{
					id: string;
					name: string;
					image?: string;
					created_at: number;
				}>
			> => {
				return this.get('/user');
			},
			update: async (data: {
				name?: string;
				image?: string;
			}): Promise<
				AuthResult<{
					id: string;
					name: string;
					image?: string;
					created_at: number;
				}>
			> => {
				return this.patch('/user', data);
			},
			delete: async (): Promise<AuthResult<void>> => {
				return this.del('/user');
			},
			listSignInMethods: async (): Promise<
				AuthResult<{
					list: UserSignInMethod[];
					count: number;
					hasMore: boolean;
				}>
			> => {
				return this.get('/user/signin-methods');
			},
			removeSignInMethod: async (
				method_id: string,
			): Promise<AuthResult<void>> => {
				return this.del(`/user/signin-methods/${method_id}`);
			},
		},

		org: {
			create: async (data: {
				name: string;
			}): Promise<
				AuthResult<{
					org_id: string;
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>
			> => {
				const result = await this.post<{
					org_id: string;
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/org', data);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this._org_id = result.data.org_id;
					this.startAutoRefresh();
				}
				return result;
			},
			switch: async (
				org_id: string,
			): Promise<
				AuthResult<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>('/org/switch', { org_id });
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this._org_id = result.data.org_id;
				}
				return result;
			},
			update: async (
				org_id: string,
				data: { name?: string; owner_id?: string },
			): Promise<AuthResult<void>> => {
				return this.patch(`/org/${org_id}`, data);
			},
			delete: async (org_id: string): Promise<AuthResult<void>> => {
				return this.del(`/org/${org_id}`);
			},
			listUsers: async (
				org_id: string,
			): Promise<
				AuthResult<{
					list: Array<{
						id: string;
						name: string;
						permission: number;
						image?: string;
					}>;
					count: number;
					hasMore: boolean;
				}>
			> => {
				return this.get(`/org/${org_id}/users`);
			},
			updateUserPermission: async (
				org_id: string,
				user_id: string,
				permission: number | string[],
			): Promise<AuthResult<void>> => {
				return this.patch(`/org/${org_id}/users/${user_id}`, {
					permission,
				});
			},
			removeUser: async (
				org_id: string,
				user_id: string,
			): Promise<AuthResult<void>> => {
				return this.del(`/org/${org_id}/users/${user_id}`);
			},
		},

		invitation: {
			list: async (): Promise<
				AuthResult<{
					list: Array<Record<string, unknown>>;
					count: number;
					hasMore: boolean;
				}>
			> => {
				return this.get('/invitation');
			},
			get: async (
				id: string,
			): Promise<AuthResult<Record<string, unknown>>> => {
				return this.get(`/invitation/${id}`);
			},
			create: async (data: {
				email?: string;
				permission: number;
				max_redemptions?: number;
				expires_at?: number;
			}): Promise<AuthResult<Record<string, unknown>>> => {
				return this.post('/invitation', data);
			},
			update: async (
				id: string,
				data: { permission?: number; max_redemptions?: number },
			): Promise<AuthResult<Record<string, unknown>>> => {
				return this.patch(`/invitation/${id}`, data);
			},
			delete: async (id: string): Promise<AuthResult<void>> => {
				return this.del(`/invitation/${id}`);
			},
			accept: async (
				id: string,
			): Promise<
				AuthResult<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>(`/invitation/${id}/accept`, undefined);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this._org_id = result.data.org_id;
				}
				return result;
			},
		},

		oauth: {
			connect: (
				vendor: string,
				options?: { redirect_to?: string; capabilities?: string[] },
			) => {
				const params = new URLSearchParams();
				if (options?.redirect_to)
					params.set('redirect', options.redirect_to);
				if (options?.capabilities)
					params.set('capabilities', options.capabilities.join(','));
				window.location.href = `${this.base_path}/oauth/${vendor}?${params}`;
			},
			listAccounts: async (): Promise<
				AuthResult<{
					list: OauthAccount[];
					count: number;
					hasMore: boolean;
				}>
			> => {
				return this.get('/oauth/accounts');
			},
			disconnectAccount: async (
				id: string,
			): Promise<AuthResult<void>> => {
				return this.del(`/oauth/accounts/${id}`);
			},
		},
	};

	// -- Auto-refresh --
	private startAutoRefresh() {
		this.stopAutoRefresh();
		if (!this.session) return;
		if (typeof setTimeout === 'undefined') return; // SSR guard
		const expires_at_ms = this.session.exp * 1000;
		const refresh_at_ms = expires_at_ms - this.refresh_threshold_ms;
		const delay = Math.max(refresh_at_ms - Date.now(), 0);
		this.refresh_timer = setTimeout(async () => {
			const result = await this.api.session.refresh();
			if (result.ok) this.startAutoRefresh();
		}, delay);
	}

	private stopAutoRefresh() {
		if (this.refresh_timer) {
			clearTimeout(this.refresh_timer);
			this.refresh_timer = null;
		}
	}

	/** Stops auto-refresh timer. Call when the AuthClient is no longer needed. */
	destroy() {
		this.stopAutoRefresh();
	}

	// -- Internal fetch helpers --
	private async post<T>(
		path: string,
		body: unknown,
	): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		return this.handleResponse<T>(res);
	}

	private async get<T>(path: string): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`);
		return this.handleResponse<T>(res);
	}

	private async patch<T>(
		path: string,
		body: unknown,
	): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return this.handleResponse<T>(res);
	}

	private async del<T = void>(path: string): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'DELETE',
		});
		return this.handleResponse<T>(res);
	}

	private async handleResponse<T>(
		res: Response,
	): Promise<AuthResult<T>> {
		if (res.status === 204) return { ok: true, data: undefined as T };
		if (!res.ok) return { ok: false, error: await this.parseError(res) };
		return { ok: true, data: (await res.json()) as T };
	}

	private async parseError(res: Response): Promise<AuthClientError> {
		try {
			const body = (await res.json()) as Record<string, unknown>;
			const code = body.code as string | undefined;
			const detail = body.detail as string | undefined;
			const message = body.message as string | undefined;
			const status = body.status as number | undefined;
			return {
				code:
					(code as AuthErrorCode) ??
					resolveErrorCode({ detail, message }),
				message: message ?? 'Unknown error',
				status: status ?? res.status,
				detail,
			};
		} catch {
			return {
				code: 'unknown',
				message: res.statusText,
				status: res.status,
			};
		}
	}
}
