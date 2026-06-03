import type { Handle, RequestEvent } from '@sveltejs/kit';
import type {
	BillingConfig,
	ResolvedBillingConfig,
	AuthServerRpc,
	WebsocketRpc,
} from './billing.config';
import { DelightError } from '@delightstack/utilities';
import { defineBillingConfig } from './billing.config';
import { handleBillingRoute } from './billing.routes';
import { handleWebhook } from './billing.webhook';
import { syncAll } from './billing.products';

/** Options for `createBillingHandle()` */
export interface BillingHandleOptions<Config extends BillingConfig = BillingConfig> {
	/** The billing configuration (pass result of `defineBillingConfig()` or raw config) */
	config: Config;

	/**
	 * Get the auth server for entitlement updates.
	 * Return undefined if not using auth integration.
	 */
	getAuthServer?: (event: RequestEvent) => AuthServerRpc | undefined;

	/**
	 * Get the WebSocket server for real-time billing events.
	 * Return undefined if not using WebSocket integration.
	 */
	getWebsocket?: (event: RequestEvent) => WebsocketRpc | undefined;

	/** Whether the app is building (static build step) @default false */
	building?: boolean;

	/**
	 * Sync product/price/meter definitions to Stripe on first request.
	 * @default false
	 */
	sync_on_startup?: boolean;
}

/**
 * Creates a SvelteKit Handle for billing.
 * Composable with SvelteKit's `sequence()`.
 *
 * Routes handled:
 * - POST   /api/billing/webhook              Stripe webhook endpoint
 * - GET    /api/billing/subscription          Get current subscription
 * - POST   /api/billing/subscription          Create/update subscription
 * - DELETE  /api/billing/subscription          Cancel subscription
 * - GET    /api/billing/invoice               List invoices
 * - GET    /api/billing/payment-method        List payment methods
 * - POST   /api/billing/payment-method        Add payment method (create setup session)
 * - PATCH  /api/billing/payment-method/:id    Set default payment method
 * - DELETE  /api/billing/payment-method/:id    Remove payment method
 * - POST   /api/billing/portal                Create Billing Portal session
 * - POST   /api/billing/checkout              Create Checkout session
 * - GET    /api/billing/plan                  List available plans
 * - POST   /api/billing/sync                  Force subscription sync
 * - GET    /api/billing/config                Get client-safe config
 */
export function createBillingHandle<Config extends BillingConfig>(
	options: BillingHandleOptions<Config>,
): Handle {
	const config = defineBillingConfig(options.config) as ResolvedBillingConfig;

	let product_sync_started = false;

	return async ({ event, resolve }) => {
		if (options.building) return resolve(event);

		// Trigger product sync once on first request (non-blocking)
		if (options.sync_on_startup && !product_sync_started) {
			product_sync_started = true;
			syncAll(config).catch((err) => {
				console.error('[@delightstack/stripe] Product sync failed:', err);
			});
		}

		const pathname = event.url.pathname;
		const base_path = config.base_path;

		if (!pathname.startsWith(base_path)) {
			return resolve(event);
		}

		const route_path = pathname.slice(base_path.length) || '/';
		const method = event.request.method;

		// Webhook route does NOT require auth (Stripe sends it)
		if (route_path === '/webhook' && method === 'POST') {
			try {
				return await handleWebhook(event, config, {
					getAuthServer: options.getAuthServer,
					getWebsocket: options.getWebsocket,
				});
			} catch (error) {
				return DelightError.from(error).toResponse();
			}
		}

		// All other routes require authentication
		const locals = event.locals as Record<string, unknown>;
		if (!locals.session) {
			return DelightError.unauthorized('Authentication required').toResponse();
		}

		try {
			return await handleBillingRoute(event, config, route_path, method, {
				getAuthServer: options.getAuthServer,
				getWebsocket: options.getWebsocket,
			});
		} catch (error) {
			return DelightError.from(error).toResponse();
		}
	};
}
