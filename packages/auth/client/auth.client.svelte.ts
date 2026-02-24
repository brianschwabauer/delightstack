import type { SessionToken, UserSession, UserSignInMethod, OauthAccount } from '../types';
import { resolveErrorCode, type AuthErrorCode } from '../types/error.type';

/** Error shape thrown by AuthClient API methods */
export interface AuthClientError {
	code: AuthErrorCode;
	message: string;
	status: number;
	detail?: string;
}

/** Serialized form for SSR hydration */
export interface AuthClientData {
	jwt: string | null;
	session: SessionToken<'auth'> | null;
	org_id: string | null;
	preferences: Record<string, unknown>;
	org_state: Record<string, unknown>;
	/** Permission names for bitwise role encoding (populated automatically from auth config) */
	permissions?: readonly string[];
}

/**
 * A single reactive class combining auth state AND API methods.
 * Uses Svelte 5 `$state()` / `$derived()` runes.
 * State properties are at the top level; all API operations are nested under `.api`.
 * API methods throw `AuthClientError` on failure and return data directly on success.
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
 * await auth.api.signIn.email({ email, password })
 * await auth.api.signOut()
 * ```
 */
export class AuthClient<P extends string = string> {
	#jwt = $state<string | null>(null);
	#session = $state<SessionToken<'auth'> | null>(null);
	#org_id = $state<string | null>(null);
	#preferences = $state<Record<string, unknown>>({});
	#org_state = $state<Record<string, unknown>>({});

	/** The raw JWT token (null if not signed in) */
	get jwt() {
		return this.#jwt;
	}

	/** The current user session - decoded from the jwt (null if not signed in) */
	get session() {
		return this.#session;
	}

	/**
	 * Global user preferences (from signed preferences cookie).
	 * Persists across signouts and is synced to the user DB for cross-device access.
	 */
	get preferences() {
		return this.#preferences;
	}

	/**
	 * Per-org state for the current org (from signed org state cookie).
	 * Cleared on signout. NOT synced to DB — intended for caching org data.
	 */
	get org_state() {
		return this.#org_state;
	}

	readonly signed_in = $derived(!!this.#session);
	readonly signed_out = $derived(!this.#session);

	/** The user's unique ID (null if not signed in) */
	readonly id = $derived(this.#session?.uid ?? null);

	/** The display name of the user */
	readonly name = $derived(this.#session?.name ?? null);

	/** The email address used to sign in the user */
	readonly email = $derived(this.#session?.email ?? null);

	/** Whether the user's email is verified or not */
	readonly verified = $derived(this.#session?.verified ?? false);

	/** The ID of the current organization the user is signed in to (null if not signed in or no org selected) */
	readonly org_id = $derived(this.#org_id);

	/** Information about the current organization the user is signed in to */
	readonly org = $derived.by(() => {
		if (!this.#session || !this.#org_id) return null;
		const org = this.#session.org[this.#org_id];
		if (!org) return null;
		return {
			id: this.#org_id,
			name: org.name,
			role: org.role,
			db: org.db,
			plan: org.plan,
		};
	});

	/** The list of organizations the user currently belongs to */
	readonly orgs = $derived.by(() => {
		if (!this.#session) return [];
		return Object.entries(this.#session.org).map(([id, o]) => ({
			id,
			name: o.name,
			role: o.role,
			db: o.db,
			plan: o.plan,
		}));
	});

	/** The list of org IDs that the user currently belongs to */
	readonly org_ids = $derived(this.orgs.map((o) => o.id));

	private base_path: string;
	private permissions: readonly P[];
	private refresh_threshold_ms: number;
	private refresh_timer: ReturnType<typeof setTimeout> | null = null;
	private fetchFn: typeof fetch;
	private onRefreshFailed?: (error: AuthClientError) => void;

	constructor(
		data?: AuthClientData,
		options?: {
			base_path?: string;
			/**
			 * Permission names for bitwise role encoding (same array passed to auth config).
			 * Required for `hasPermission()` to work. Array index = bit position.
			 */
			permissions?: readonly P[];
			refresh_threshold_ms?: number;
			fetch?: typeof fetch;
			/** Called when auto-refresh fails (e.g. session expired). Use to redirect to login. */
			onRefreshFailed?: (error: AuthClientError) => void;
		},
	) {
		this.#jwt = data?.jwt ?? null;
		this.#session = data?.session ?? null;
		this.#org_id = data?.org_id ?? null;
		this.#preferences = data?.preferences ?? {};
		this.#org_state = data?.org_state ?? {};
		this.base_path = options?.base_path ?? '/api/auth';
		this.permissions = options?.permissions ?? (data?.permissions as readonly P[]) ?? [];
		this.refresh_threshold_ms = options?.refresh_threshold_ms ?? 600_000;
		this.fetchFn = options?.fetch ?? fetch;
		this.onRefreshFailed = options?.onRefreshFailed;

		if (this.#session) this.startAutoRefresh();
	}

	/** Serializes state for SSR hydration (used by svelte's +layout files) */
	toJSON(): AuthClientData {
		return {
			jwt: this.#jwt,
			session: this.#session,
			org_id: this.#org_id,
			preferences: this.#preferences,
			org_state: this.#org_state,
			permissions: this.permissions,
		};
	}

	/** Creates an AuthClient from serialized data (used by svelte's +layout files) */
	static from<const P extends string = string>(
		data: AuthClientData,
		options?: {
			base_path?: string;
			permissions?: readonly P[];
			onRefreshFailed?: (error: AuthClientError) => void;
		},
	): AuthClient<P> {
		return new AuthClient<P>(data, options);
	}

	/** Checks if the current org role includes the given permission */
	hasPermission(permission: P): boolean {
		if (!this.org) return false;
		const bit = this.permissions.indexOf(permission);
		if (bit === -1) return false;
		return (this.org.role & (1 << bit)) !== 0;
	}

	/**
	 * Merge updates into the user preferences. Set a value to null/undefined to remove it.
	 * Preferences persist across signouts and are synced to the user DB for cross-device access.
	 * - **Browser**: sends PATCH /preference to persist to both signed cookie and user DB.
	 * - **Server**: updates local state only (for SSR rendering). Use `locals.setPreferences()` to persist.
	 */
	async setPreferences(
		updates: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		if (typeof window === 'undefined') {
			const merged = { ...this.#preferences };
			for (const [key, value] of Object.entries(updates)) {
				if (value === undefined || value === null) {
					delete merged[key];
				} else {
					merged[key] = value;
				}
			}
			this.#preferences = merged;
			return this.#preferences;
		}
		const result = await this.patch<Record<string, unknown>>('/preference', updates);
		this.#preferences = result;
		return result;
	}

	/**
	 * Merge updates into an org's state. Set a value to null/undefined to remove it.
	 * Defaults to the current org if `org_id` is omitted.
	 * Org state is cleared on signout and NOT synced to DB — intended for caching org data.
	 * - **Browser**: sends PATCH /org/:id/state to persist the signed cookie.
	 * - **Server**: updates local state only (for SSR rendering). Use `locals.setOrgState()` to persist.
	 */
	async setOrgState(
		updates: Record<string, unknown>,
		org_id?: string,
	): Promise<Record<string, unknown>> {
		const target = org_id ?? this.#org_id;
		if (!target) {
			throw {
				code: 'unknown',
				message: 'No organization selected',
				status: 400,
			} satisfies AuthClientError;
		}
		if (typeof window === 'undefined') {
			if (target === this.#org_id) {
				const merged = { ...this.#org_state };
				for (const [key, value] of Object.entries(updates)) {
					if (value === undefined || value === null) {
						delete merged[key];
					} else {
						merged[key] = value;
					}
				}
				this.#org_state = merged;
			}
			return target === this.#org_id ? this.#org_state : {};
		}
		const result = await this.patch<Record<string, unknown>>(
			`/org/${target}/state`,
			updates,
		);
		if (target === this.#org_id) {
			this.#org_state = result;
		}
		return result;
	}

	/** All API methods nested under .api */
	readonly api = {
		signIn: {
			email: async (data: {
				email: string;
				password: string;
			}): Promise<{
				jwt: string;
				decoded_jwt: SessionToken<'auth'>;
				org_id?: string;
			}> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>('/signin/email', data);
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				if (result.org_id) this.#org_id = result.org_id;
				this.startAutoRefresh();
				return result;
			},
			emailMagicLink: async (data: { email: string }): Promise<void> => {
				await this.post<void>('/signin/email/magic', data);
			},
			oauth: (vendor: string, options?: { redirect_to?: string }) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				window.location.href = `${this.base_path}/signin/${vendor}?${params}`;
			},
		} as const,

		signUp: {
			email: async (data: {
				name: string;
				email: string;
				password?: string;
				org_name?: string;
				invitation_id?: string;
			}): Promise<{ jwt: string; decoded_jwt: SessionToken<'auth'> }> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/signup/email', data);
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.startAutoRefresh();
				return result;
			},
		} as const,

		signOut: async (): Promise<void> => {
			await this.post<void>('/signout', undefined);
			this.#jwt = null;
			this.#session = null;
			this.#org_id = null;
			// Preferences intentionally kept — they persist across signouts (e.g. dark mode)
			this.#org_state = {};
			this.stopAutoRefresh();
		},

		session: {
			get: async (): Promise<{
				session: SessionToken<'auth'>;
				user: {
					id: string;
					name: string;
					email: string;
					verified: boolean;
				};
				org_id: string | null;
			}> => {
				return this.get('/session');
			},
			refresh: async (): Promise<{
				jwt: string;
				decoded_jwt: SessionToken<'auth'>;
				org_id?: string;
			}> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>('/session/refresh', undefined);
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				if (result.org_id) this.#org_id = result.org_id;
				this.startAutoRefresh();
				return result;
			},
			list: async (options?: {
				offset?: number;
				limit?: number;
			}): Promise<{
				list: UserSession[];
				count: number;
				hasMore: boolean;
			}> => {
				const params = new URLSearchParams();
				if (options?.offset != null) params.set('offset', String(options.offset));
				if (options?.limit != null) params.set('limit', String(options.limit));
				const qs = params.toString();
				return this.get(`/session/list${qs ? `?${qs}` : ''}`);
			},
			revoke: async (session_id: string): Promise<void> => {
				return this.delete(`/session/${session_id}`);
			},
		} as const,

		password: {
			reset: async (email: string): Promise<void> => {
				await this.post<void>('/password/reset', { email });
			},
			confirmReset: async (
				token: string,
				password: string,
			): Promise<{ jwt: string; decoded_jwt: SessionToken<'auth'> }> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/password/reset/confirm', { token, password });
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.startAutoRefresh();
				return result;
			},
			change: async (
				password: string,
			): Promise<{ jwt: string; decoded_jwt: SessionToken<'auth'> }> => {
				const result = await this.patch<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/password', { password });
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.startAutoRefresh();
				return result;
			},
			checkStrength: async (password: string): Promise<{ strong: boolean }> => {
				return this.post('/password/check', { password });
			},
		} as const,

		email: {
			requestVerification: async (): Promise<void> => {
				await this.post<void>('/email/verify', undefined);
			},
			checkAvailability: async (email: string): Promise<{ available: boolean }> => {
				const params = new URLSearchParams({ email });
				return this.get(`/email/check?${params}`);
			},
		} as const,

		user: {
			get: async (): Promise<{
				id: string;
				name: string;
				image?: string;
				created_at: number;
			}> => {
				return this.get('/user');
			},
			update: async (data: {
				name?: string;
				image?: string;
			}): Promise<{
				id: string;
				name: string;
				image?: string;
				created_at: number;
			}> => {
				return this.patch('/user', data);
			},
			delete: async (): Promise<void> => {
				return this.delete('/user');
			},
			listSignInMethods: async (): Promise<{
				list: UserSignInMethod[];
				count: number;
				hasMore: boolean;
			}> => {
				return this.get('/user/signin-method');
			},
			removeSignInMethod: async (method_id: string): Promise<void> => {
				return this.delete(`/user/signin-method/${method_id}`);
			},
		} as const,

		org: {
			create: async (data: {
				name: string;
			}): Promise<{
				org_id: string;
				jwt: string;
				decoded_jwt: SessionToken<'auth'>;
			}> => {
				const result = await this.post<{
					org_id: string;
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
				}>('/org', data);
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.#org_id = result.org_id;
				this.startAutoRefresh();
				return result;
			},
			switch: async (
				org_id: string,
			): Promise<{
				jwt: string;
				decoded_jwt: SessionToken<'auth'>;
				org_id: string;
			}> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>('/org/switch', { org_id });
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.#org_id = result.org_id;
				return result;
			},
			update: async (
				org_id: string,
				data: { name?: string; owner_id?: string },
			): Promise<void> => {
				return this.patch(`/org/${org_id}`, data);
			},
			delete: async (org_id: string): Promise<void> => {
				return this.delete(`/org/${org_id}`);
			},
			listUsers: async (
				org_id: string,
			): Promise<{
				list: Array<{
					id: string;
					name: string;
					permission: number;
					image?: string;
				}>;
				count: number;
				hasMore: boolean;
			}> => {
				return this.get(`/org/${org_id}/user`);
			},
			updateUserPermission: async (
				org_id: string,
				user_id: string,
				permission: number | string[],
			): Promise<void> => {
				return this.patch(`/org/${org_id}/user/${user_id}`, {
					permission,
				});
			},
			removeUser: async (org_id: string, user_id: string): Promise<void> => {
				return this.delete(`/org/${org_id}/user/${user_id}`);
			},
		} as const,

		invitation: {
			list: async (): Promise<{
				list: Array<Record<string, unknown>>;
				count: number;
				hasMore: boolean;
			}> => {
				return this.get('/invitation');
			},
			get: async (id: string): Promise<Record<string, unknown>> => {
				return this.get(`/invitation/${id}`);
			},
			create: async (data: {
				email?: string;
				permission: number;
				max_redemptions?: number;
				expires_at?: number;
			}): Promise<Record<string, unknown>> => {
				return this.post('/invitation', data);
			},
			update: async (
				id: string,
				data: { permission?: number; max_redemptions?: number },
			): Promise<Record<string, unknown>> => {
				return this.patch(`/invitation/${id}`, data);
			},
			delete: async (id: string): Promise<void> => {
				return this.delete(`/invitation/${id}`);
			},
			accept: async (
				id: string,
			): Promise<{
				jwt: string;
				decoded_jwt: SessionToken<'auth'>;
				org_id: string;
			}> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>(`/invitation/${id}/accept`, undefined);
				this.#jwt = result.jwt;
				this.#session = result.decoded_jwt;
				this.#org_id = result.org_id;
				return result;
			},
		} as const,

		oauth: {
			connect: (
				vendor: string,
				options?: { redirect_to?: string; capabilities?: string[] },
			) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				if (options?.capabilities)
					params.set('capabilities', options.capabilities.join(','));
				window.location.href = `${this.base_path}/oauth/${vendor}?${params}`;
			},
			listAccounts: async (): Promise<{
				list: OauthAccount[];
				count: number;
				hasMore: boolean;
			}> => {
				return this.get('/oauth/account');
			},
			disconnectAccount: async (id: string): Promise<void> => {
				return this.delete(`/oauth/account/${id}`);
			},
		},
	} as const;

	/** Auto-refresh session tokens when they are about to expire, to keep the user signed in without interruption. */
	private startAutoRefresh() {
		this.stopAutoRefresh();
		if (!this.#session) return;
		if (typeof setTimeout === 'undefined') return; // SSR guard
		const expires_at_ms = this.#session.exp * 1000;
		const refresh_at_ms = expires_at_ms - this.refresh_threshold_ms;
		const delay = Math.max(refresh_at_ms - Date.now(), 0);
		this.refresh_timer = setTimeout(async () => {
			try {
				await this.api.session.refresh();
			} catch (error) {
				this.onRefreshFailed?.(error as AuthClientError);
			}
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
	private async post<T>(path: string, body: unknown): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		return this.handleResponse<T>(res);
	}

	private async get<T>(path: string): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`);
		return this.handleResponse<T>(res);
	}

	private async patch<T>(path: string, body: unknown): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return this.handleResponse<T>(res);
	}

	private async delete<T = void>(path: string): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'DELETE',
		});
		return this.handleResponse<T>(res);
	}

	private async handleResponse<T>(res: Response): Promise<T> {
		if (res.status === 204) return undefined as T;
		if (!res.ok) throw await this.parseError(res);
		return (await res.json()) as T;
	}

	private async parseError(res: Response): Promise<AuthClientError> {
		try {
			const body = (await res.json()) as Record<string, unknown>;
			const code = body.code as string | undefined;
			const detail = body.detail as string | undefined;
			const message = body.message as string | undefined;
			const status = body.status as number | undefined;
			return {
				code: (code as AuthErrorCode) ?? resolveErrorCode({ detail, message }),
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
