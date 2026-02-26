import type {
	SubscriptionState,
	PlanInfo,
	PaymentMethodInfo,
	InvoiceInfo,
} from '../types';

/** Serialized data for SSR hydration */
export interface BillingClientData {
	subscription: SubscriptionState | null;
	plans: PlanInfo[];
	publishable_key: string;
	portal_enabled: boolean;
}

/** Error shape thrown by BillingClient API methods */
export interface BillingClientError {
	code: string;
	message: string;
	status: number;
	detail?: string;
}

/**
 * Reactive billing client for Svelte 5.
 * Manages subscription state, payment methods, and invoices.
 *
 * @example
 * ```ts
 * // In +layout.ts:
 * const billing = new BillingClient(data.billing);
 * return { billing };
 *
 * // In components:
 * billing.subscribed           // reactive boolean
 * billing.plan_ids             // reactive string[]
 * billing.hasEntitlement('premium')
 * await billing.api.subscribe('pro-monthly')
 * await billing.api.cancel()
 * ```
 */
export class BillingClient {
	#subscription = $state<SubscriptionState | null>(null);
	#plans = $state<PlanInfo[]>([]);
	#publishable_key: string;
	#portal_enabled: boolean;

	private base_path: string;
	private fetchFn: typeof fetch;

	// ── Reactive state ─────────────────────────────────────────────

	/** The current subscription state (null if no subscription) */
	get subscription() {
		return this.#subscription;
	}

	/** Whether the user/org has an active or trialing subscription */
	readonly subscribed = $derived(
		this.#subscription?.status === 'active' ||
			this.#subscription?.status === 'trialing',
	);

	/** Whether the subscription is in a trial period */
	readonly trialing = $derived(
		this.#subscription?.status === 'trialing',
	);

	/** Current subscription status (null if no subscription) */
	readonly status = $derived(this.#subscription?.status ?? null);

	/** The plan IDs currently subscribed to */
	readonly plan_ids = $derived(this.#subscription?.plan_ids ?? []);

	/** The entitlement names granted by the current subscription */
	readonly active_entitlements = $derived(
		this.#subscription?.entitlements ?? [],
	);

	/** Available plans for subscription */
	get plans() {
		return this.#plans;
	}

	/** Stripe publishable key (for Stripe.js initialization) */
	get publishable_key() {
		return this.#publishable_key;
	}

	/** Whether the Stripe Billing Portal is enabled */
	get portal_enabled() {
		return this.#portal_enabled;
	}

	/** Trial end timestamp in ms (null if not trialing) */
	readonly trial_end = $derived(
		this.#subscription?.trial_end ?? null,
	);

	/** Current period end timestamp in ms */
	readonly period_end = $derived(
		this.#subscription?.current_period_end ?? null,
	);

	/** Whether subscription is scheduled for cancellation */
	readonly canceling = $derived(!!this.#subscription?.cancel_at);

	constructor(
		data?: BillingClientData,
		options?: {
			base_path?: string;
			fetch?: typeof fetch;
		},
	) {
		this.#subscription = data?.subscription ?? null;
		this.#plans = data?.plans ?? [];
		this.#publishable_key = data?.publishable_key ?? '';
		this.#portal_enabled = data?.portal_enabled ?? false;
		this.base_path = options?.base_path ?? '/api/billing';
		this.fetchFn = options?.fetch ?? fetch;
	}

	/** Check if the current subscription grants a specific entitlement */
	hasEntitlement(name: string): boolean {
		return this.active_entitlements.includes(name);
	}

	/** Check if currently subscribed to a specific plan */
	hasPlan(plan_id: string): boolean {
		return this.plan_ids.includes(plan_id);
	}

	/** Serializes state for SSR hydration */
	toJSON(): BillingClientData {
		return {
			subscription: this.#subscription,
			plans: this.#plans,
			publishable_key: this.#publishable_key,
			portal_enabled: this.#portal_enabled,
		};
	}

	/**
	 * Apply a WebSocket billing event to update reactive state.
	 * Wire this into your WebSocket client:
	 *
	 * ```ts
	 * ws.on('billing:subscription:changed', (msg) => billing.handleEvent(msg));
	 * ```
	 */
	handleEvent(message: { event: string; [key: string]: unknown }): void {
		if (message.event === 'billing:subscription:changed') {
			if (this.#subscription) {
				this.#subscription = {
					...this.#subscription,
					status: message.status as SubscriptionState['status'],
					plan_ids: message.plan_ids as string[],
					entitlements: message.entitlements as string[],
				};
			} else {
				// New subscription event when we had none — trigger a full refresh
				this.api.refreshSubscription().catch(() => {});
				return;
			}
			// Also trigger a full refresh for accuracy
			this.api.refreshSubscription().catch(() => {});
		}
	}

	/**
	 * Returns hooks for wiring WebSocket events into the billing client.
	 *
	 * ```ts
	 * const ws = new WebsocketClient();
	 * const billing = new BillingClient(data.billing);
	 * const hooks = billing.websocketHooks();
	 *
	 * ws.on('billing:subscription:changed', hooks.onSubscriptionChanged);
	 * ws.on('billing:payment:succeeded', hooks.onPaymentSucceeded);
	 * ws.on('billing:payment:failed', hooks.onPaymentFailed);
	 * ```
	 */
	websocketHooks() {
		return {
			onSubscriptionChanged: (msg: Record<string, unknown>) => {
				this.handleEvent({
					event: 'billing:subscription:changed',
					...msg,
				});
			},
			onPaymentSucceeded: (_msg: Record<string, unknown>) => {
				// Refresh subscription state after a successful payment
				this.api.refreshSubscription().catch(() => {});
			},
			onPaymentFailed: (_msg: Record<string, unknown>) => {
				// Refresh subscription state after a failed payment
				this.api.refreshSubscription().catch(() => {});
			},
		};
	}

	// ── API methods ────────────────────────────────────────────────

	readonly api = {
		/** Subscribe to a plan */
		subscribe: async (
			plan_id: string,
			options?: {
				payment_method_id?: string;
				coupon?: string;
			},
		): Promise<SubscriptionState | null> => {
			const result = await this.post<{
				subscription: SubscriptionState | null;
			}>('/subscription', { plan_id, ...options });
			this.#subscription = result.subscription;
			return result.subscription;
		},

		/** Cancel the current subscription */
		cancel: async (): Promise<void> => {
			await this.del('/subscription');
			this.#subscription = null;
		},

		/** Refresh subscription state from the server */
		refreshSubscription: async (): Promise<SubscriptionState | null> => {
			const result = await this.get<{
				subscription: SubscriptionState | null;
			}>('/subscription');
			this.#subscription = result.subscription;
			return result.subscription;
		},

		/** Force sync subscription state (fetches from Stripe and updates auth entitlements) */
		syncSubscription: async (): Promise<SubscriptionState | null> => {
			const result = await this.post<{
				subscription: SubscriptionState | null;
			}>('/sync', {});
			this.#subscription = result.subscription;
			return result.subscription;
		},

		/** List invoices */
		listInvoices: async (options?: {
			limit?: number;
		}): Promise<InvoiceInfo[]> => {
			const params = new URLSearchParams();
			if (options?.limit) params.set('limit', String(options.limit));
			const qs = params.toString();
			const result = await this.get<{ invoices: InvoiceInfo[] }>(
				`/invoice${qs ? `?${qs}` : ''}`,
			);
			return result.invoices;
		},

		/** List payment methods */
		listPaymentMethods: async (): Promise<PaymentMethodInfo[]> => {
			const result = await this.get<{
				payment_methods: PaymentMethodInfo[];
			}>('/payment-method');
			return result.payment_methods;
		},

		/** Create a setup session for adding a payment method */
		createPaymentMethodSession: async (): Promise<{
			client_secret: string;
		}> => {
			return this.post('/payment-method', {});
		},

		/** Remove a payment method */
		removePaymentMethod: async (id: string): Promise<void> => {
			await this.del(`/payment-method/${id}`);
		},

		/** Set a payment method as default */
		setDefaultPaymentMethod: async (id: string): Promise<void> => {
			await this.patch(`/payment-method/${id}`, {});
		},

		/** Create a Billing Portal session */
		createPortalSession: async (
			return_url?: string,
		): Promise<{ url: string }> => {
			return this.post('/portal', { return_url });
		},

		/** Open the Billing Portal in a new tab */
		openPortal: async (return_url?: string): Promise<void> => {
			const { url } = await this.api.createPortalSession(return_url);
			window.open(url, '_blank');
		},

		/** Create a Checkout session for a plan */
		createCheckoutSession: async (
			plan_id: string,
			return_url?: string,
		): Promise<{ client_secret: string }> => {
			return this.post('/checkout', { plan_id, return_url });
		},

		/** Fetch available plans */
		listPlans: async (): Promise<PlanInfo[]> => {
			const result = await this.get<{ plans: PlanInfo[] }>('/plan');
			this.#plans = result.plans;
			return result.plans;
		},
	} as const;

	// ── Internal fetch helpers ─────────────────────────────────────

	private async post<T>(path: string, body: unknown): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return this.handleResponse<T>(res);
	}

	private async get<T>(path: string): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`);
		return this.handleResponse<T>(res);
	}

	private async del<T = void>(path: string): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'DELETE',
		});
		return this.handleResponse<T>(res);
	}

	private async patch<T>(
		path: string,
		body: unknown,
	): Promise<T> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return this.handleResponse<T>(res);
	}

	private async handleResponse<T>(res: Response): Promise<T> {
		if (res.status === 204) return undefined as T;
		if (!res.ok) throw await this.parseError(res);
		return (await res.json()) as T;
	}

	private async parseError(res: Response): Promise<BillingClientError> {
		try {
			const body = (await res.json()) as Record<string, unknown>;
			return {
				code: (body.code as string) ?? 'unknown',
				message: (body.message as string) ?? 'Unknown error',
				status: (body.status as number) ?? res.status,
				detail: body.detail as string | undefined,
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
