import type { RequestEvent } from '@sveltejs/kit';

/**
 * A plan definition that maps to a Stripe Product + Price.
 * Defined in code, synced to Stripe.
 */
export interface PlanDefinition {
	/** Unique plan identifier (used in code, stored as Stripe product metadata) */
	id: string;
	/** Human-readable name (synced to Stripe product name) */
	name: string;
	/** Plan description (synced to Stripe product description) */
	description?: string;

	/** Stripe lookup_key for the price. Allows price migration without code changes. */
	lookup_key: string;

	/** Price amount in smallest currency unit (e.g. 999 = $9.99) */
	amount: number;
	/** Currency code (lowercase) @default 'usd' */
	currency?: string;
	/**
	 * Billing interval. Omit for a ONE-TIME plan (single payment, `mode: 'payment'`
	 * checkout) — grant its effects via the `onOneTimePurchase` hook.
	 */
	interval?: 'month' | 'year' | 'week' | 'day';
	/** Number of intervals between billings @default 1 */
	interval_count?: number;

	/**
	 * Entitlement names this plan grants.
	 * Maps to the auth package's entitlements array.
	 * @example ['premium', 'video-uploads']
	 */
	entitlements?: readonly string[];

	/** Trial period in days @default undefined (no trial) */
	trial_days?: number;

	/** Whether this plan is archived (hidden from new subscriptions) */
	archived?: boolean;

	/** Additional Stripe product metadata */
	metadata?: Record<string, string>;
}

/**
 * A usage meter definition for billing based on consumption.
 * Maps to Stripe Billing Meters.
 */
export interface MeterDefinition {
	/** Unique meter identifier */
	id: string;
	/** Human-readable display name */
	display_name: string;
	/** Event name used in meter event API */
	event_name: string;
	/** Aggregation formula */
	aggregation: 'sum' | 'count' | 'max' | 'last';
	/** Value key in the event payload @default 'value' */
	value_key?: string;
}

/** Minimal RPC interface for the auth server (avoids hard dependency) */
export interface AuthServerRpc {
	updateOrg(id: string, data: { plan?: number; json?: string }): unknown;
	/**
	 * Optional read of the org record. When provided, the billing package
	 * read-modify-writes the org's `json` metadata instead of overwriting it.
	 */
	getOrg?(
		id: string,
	):
		| { json?: string | null }
		| null
		| undefined
		| Promise<{ json?: string | null } | null | undefined>;
}

/**
 * Store used to deduplicate Stripe webhook events by event ID.
 * Provide a durable implementation (e.g. Durable Object storage) for
 * multi-isolate deployments. Defaults to an in-memory store with a TTL/cap.
 */
export interface WebhookEventStore {
	/** Returns true if the given Stripe event ID was already processed */
	has(event_id: string): boolean | Promise<boolean>;
	/** Marks the given Stripe event ID as processed */
	add(event_id: string): void | Promise<void>;
}

/** Minimal RPC interface for the websocket server (avoids hard dependency) */
export interface WebsocketRpc {
	broadcast(message: Record<string, unknown>): void;
}

/**
 * Configuration for the billing/stripe integration.
 * Pass to `defineBillingConfig()` to fill in defaults.
 */
export interface BillingConfig<E extends string = string> {
	/** Stripe secret key (sk_live_... or sk_test_...) */
	secret_key: string;

	/** Stripe publishable key (pk_live_... or pk_test_...) */
	publishable_key: string;

	/**
	 * Stripe webhook signing secret. If omitted, webhooks are
	 * auto-registered and the secret is derived from the registration.
	 * Provide this to use a manually configured webhook.
	 */
	webhook_secret?: string;

	/** Whether the app is in dev mode @default false */
	dev?: boolean;

	/** Base path for billing API routes @default '/api/billing' */
	base_path?: string;

	/** Plan definitions — products and prices defined in code */
	plans?: PlanDefinition[];

	/** Usage meter definitions */
	meters?: MeterDefinition[];

	/**
	 * Entitlement names that correspond to the auth package's entitlements array.
	 * Array index = bit position. Must match the auth config's entitlements array.
	 * Used to map plan entitlements to the auth system's bitwise encoding.
	 * @example ['premium', 'video-uploads', 'extra-usage']
	 */
	entitlements?: readonly E[];

	/**
	 * Whether billing is scoped to orgs or users.
	 * - 'org': Stripe customer = org. Subscription managed by org owner.
	 * - 'user': Stripe customer = user. Each user manages their own subscription.
	 * @default 'org'
	 */
	billing_scope?: 'org' | 'user';

	/**
	 * The public URL of the app (used for webhook registration and Billing Portal return URL).
	 * If omitted, derived from the first request's origin.
	 */
	app_url?: string;

	/**
	 * Additional origins that a client-provided `return_url` may point to
	 * (for Billing Portal and Checkout). The app's own origin is always allowed.
	 * Any other origin is rejected to prevent open-redirect/phishing.
	 * @example ['https://app.example.com']
	 */
	allowed_return_origins?: string[];

	/**
	 * Store used to deduplicate Stripe webhook events (idempotency).
	 * Defaults to an in-memory store (per-isolate, 24h TTL, capped size).
	 * Provide a durable implementation for multi-isolate deployments.
	 */
	webhook_event_store?: WebhookEventStore;

	/**
	 * Billing Portal configuration.
	 * @default { enabled: true }
	 */
	portal?: {
		/** Enable the Stripe Billing Portal @default true */
		enabled?: boolean;
	};

	/** Lifecycle hooks for billing events */
	hooks?: {
		/** Called after a subscription is created, updated, canceled, or deleted */
		onSubscriptionChange?: (ctx: {
			customer_id: string;
			subscription_id: string;
			status: string;
			plan_id: string | null;
			entitlements: string[];
			event: RequestEvent;
		}) => void | Promise<void>;

		/**
		 * Called when a one-time plan's checkout completes (`mode: 'payment'`).
		 * The package cannot know what a purchase grants (a credit, a timed pass,
		 * a permanent entitlement) — apply it here. `amount` is an integer in the
		 * smallest currency unit (cents).
		 */
		onOneTimePurchase?: (ctx: {
			customer_id: string;
			/** Resolved from the customer's metadata; null when billing is user-scoped or unknown */
			org_id: string | null;
			plan_id: string;
			/** Integer amount in the smallest currency unit (e.g. cents) */
			amount: number;
			currency: string;
			checkout_session_id: string;
			event: RequestEvent;
		}) => void | Promise<void>;

		/** Called after a payment succeeds. `amount` is an integer in the smallest currency unit (cents). */
		onPaymentSuccess?: (ctx: {
			customer_id: string;
			/** Integer amount in the smallest currency unit (e.g. cents) */
			amount: number;
			currency: string;
			invoice_id: string;
		}) => void | Promise<void>;

		/** Called after a payment fails. `amount` is an integer in the smallest currency unit (cents). */
		onPaymentFailed?: (ctx: {
			customer_id: string;
			/** Integer amount in the smallest currency unit (e.g. cents) */
			amount: number;
			currency: string;
			invoice_id: string;
		}) => void | Promise<void>;

		/** Called when a customer is created in Stripe */
		onCustomerCreated?: (ctx: {
			customer_id: string;
			org_id?: string;
			user_id?: string;
		}) => void | Promise<void>;
	};
}

/** Resolved billing config with all defaults filled in */
export interface ResolvedBillingConfig<
	E extends string = string,
> extends BillingConfig<E> {
	base_path: string;
	billing_scope: 'org' | 'user';
	portal: Required<NonNullable<BillingConfig['portal']>>;
}

/** Creates a billing config with sensible defaults */
export function defineBillingConfig<const E extends string>(
	config: BillingConfig<E>,
): ResolvedBillingConfig<E> {
	if (!config.secret_key?.startsWith('sk_')) {
		throw new Error(
			'Billing config: secret_key must be a valid Stripe secret key (sk_...)',
		);
	}
	if (!config.publishable_key?.startsWith('pk_')) {
		throw new Error(
			'Billing config: publishable_key must be a valid Stripe publishable key (pk_...)',
		);
	}

	// Validate plan definitions
	if (config.plans) {
		const ids = new Set<string>();
		const keys = new Set<string>();
		for (const plan of config.plans) {
			if (ids.has(plan.id)) {
				throw new Error(`Billing config: duplicate plan id '${plan.id}'`);
			}
			if (keys.has(plan.lookup_key)) {
				throw new Error(`Billing config: duplicate lookup_key '${plan.lookup_key}'`);
			}
			ids.add(plan.id);
			keys.add(plan.lookup_key);
		}
	}

	// Validate entitlements limit
	if (config.entitlements && config.entitlements.length > 32) {
		throw new Error(
			`Billing config: entitlements array exceeds 32 entries (got ${config.entitlements.length}). ` +
				'Bitwise encoding uses a 32-bit integer.',
		);
	}

	return {
		...config,
		base_path: config.base_path ?? '/api/billing',
		billing_scope: config.billing_scope ?? 'org',
		portal: {
			enabled: config.portal?.enabled ?? true,
		},
	};
}
