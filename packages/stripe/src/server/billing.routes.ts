import type { RequestEvent } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type {
	ResolvedBillingConfig,
	AuthServerRpc,
	WebsocketRpc,
} from './billing.config';
import { DelightError } from '@delightstack/utilities';
import {
	getStripe,
	stripeCall,
	formatPaymentMethod,
	formatInvoice,
	parseBody,
	getAppUrl,
	resolveReturnUrl,
} from './billing.stripe';
import { syncSubscription, fetchSubscriptionState, activePlanIds } from './billing.sync';

export interface RouteContext {
	getAuthServer?: (event: RequestEvent) => AuthServerRpc | undefined;
	getWebsocket?: (event: RequestEvent) => WebsocketRpc | undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Get org_id from locals when billing_scope is 'org' */
function getOrgId(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): string | undefined {
	if (config.billing_scope !== 'org') return undefined;
	const locals = event.locals as Record<string, unknown>;
	const org_id = (locals.org_id as string) ?? undefined;
	return org_id;
}

/** Get user_id from locals when billing_scope is 'user' */
function getUserId(event: RequestEvent): string | undefined {
	const locals = event.locals as Record<string, unknown>;
	const user = locals.user as { id: string } | null;
	return user?.id ?? undefined;
}

/** Get the org_state cookie writer from locals (org scope only) */
function getSetOrgState(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): ((updates: Record<string, unknown>) => void) | undefined {
	if (config.billing_scope !== 'org') return undefined;
	const locals = event.locals as Record<string, unknown>;
	return locals.setOrgState as ((updates: Record<string, unknown>) => void) | undefined;
}

/** Resolve customer_id from org_state or user metadata */
function resolveCustomerId(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): string | null {
	const locals = event.locals as Record<string, unknown>;

	if (config.billing_scope === 'org') {
		const org_state = locals.org_state as Record<string, unknown> | undefined;
		if (org_state?.customer_id) return org_state.customer_id as string;
	}

	return null;
}

/** Resolve customer_id, checking org_state then Stripe (by metadata search) */
async function resolveCustomerIdAsync(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): Promise<string | null> {
	// First check cached customer_id
	const cached = resolveCustomerId(event, config);
	if (cached) return cached;

	// Search Stripe by org_id or user_id metadata
	const stripe = getStripe(config);
	const org_id = getOrgId(event, config);
	const user_id = getUserId(event);

	const search_key = config.billing_scope === 'org' ? 'org_id' : 'user_id';
	const search_value = config.billing_scope === 'org' ? org_id : user_id;

	if (!search_value) return null;

	// Guard against Stripe search query injection/breakage — ids from the auth
	// system should never contain quotes or backslashes
	if (/['"\\]/.test(search_value)) {
		throw DelightError.badRequest('Invalid billing identifier');
	}

	const customers = await stripeCall(() =>
		stripe.customers.search({
			query: `metadata['${search_key}']:'${search_value}'`,
			limit: 1,
		}),
	);

	const customer = customers.data[0];
	if (!customer) return null;

	// Cache in org_state for future requests
	cacheCustomerId(event, config, customer.id);

	return customer.id;
}

/** Create a Stripe customer and cache the customer_id */
async function ensureCustomer(
	event: RequestEvent,
	config: ResolvedBillingConfig,
	ctx: RouteContext,
): Promise<string> {
	const existing = await resolveCustomerIdAsync(event, config);
	if (existing) return existing;

	const stripe = getStripe(config);
	const locals = event.locals as Record<string, unknown>;
	const user = locals.user as { id: string; name: string; email: string } | null;
	const org = locals.org as { id: string; name: string; json?: string | null } | null;
	const org_id = getOrgId(event, config);
	const user_id = getUserId(event);

	const metadata: Record<string, string> = {};
	if (org_id) metadata.org_id = org_id;
	if (user_id) metadata.user_id = user_id;

	const customer = await stripeCall(() =>
		stripe.customers.create({
			email: user?.email,
			name: config.billing_scope === 'org' ? org?.name : user?.name,
			metadata,
		}),
	);

	// Cache the customer_id
	cacheCustomerId(event, config, customer.id);

	// Store customer_id in auth org metadata (read-modify-write — never
	// overwrite existing org JSON metadata from other features)
	if (org_id && ctx.getAuthServer) {
		const auth = ctx.getAuthServer(event);
		if (auth) {
			try {
				const existing_record = auth.getOrg ? await auth.getOrg(org_id) : org;
				let existing_json: Record<string, unknown> = {};
				if (existing_record?.json) {
					try {
						const parsed = JSON.parse(existing_record.json) as unknown;
						if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
							existing_json = parsed as Record<string, unknown>;
						}
					} catch {
						// Unparseable existing json — keep it from being silently
						// destroyed by skipping the write entirely
						throw new Error('Existing org json is not valid JSON');
					}
				}
				await auth.updateOrg(org_id, {
					json: JSON.stringify({ ...existing_json, customer_id: customer.id }),
				});
			} catch {
				// Non-critical — customer_id is also discoverable via Stripe search
			}
		}
	}

	if (config.hooks?.onCustomerCreated) {
		await config.hooks.onCustomerCreated({
			customer_id: customer.id,
			org_id,
			user_id,
		});
	}

	return customer.id;
}

/** Cache customer_id in org_state cookie */
function cacheCustomerId(
	event: RequestEvent,
	config: ResolvedBillingConfig,
	customer_id: string,
): void {
	if (config.billing_scope !== 'org') return;
	const locals = event.locals as Record<string, unknown>;
	const setOrgState = locals.setOrgState as
		| ((updates: Record<string, unknown>) => void)
		| undefined;
	if (setOrgState) {
		setOrgState({ customer_id });
	}
}

export async function handleBillingRoute(
	event: RequestEvent,
	config: ResolvedBillingConfig,
	route_path: string,
	method: string,
	ctx: RouteContext,
): Promise<Response> {
	const stripe = getStripe(config);

	// Handle parameterized routes (e.g., /payment-method/:id)
	const payment_method_match = route_path.match(/^\/payment-method\/(.+)$/);

	if (payment_method_match) {
		const pm_id = payment_method_match[1];

		if (method === 'DELETE' || method === 'PATCH') {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) throw DelightError.badRequest('No customer found');

			// Verify the payment method belongs to the caller's customer before
			// acting on it — otherwise any authed user could detach others' cards
			const pm = await stripeCall(() => stripe.paymentMethods.retrieve(pm_id));
			const pm_customer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
			if (pm_customer !== customer_id) {
				throw DelightError.notFound('Payment method not found');
			}

			if (method === 'DELETE') {
				await stripeCall(() => stripe.paymentMethods.detach(pm_id));
				return new Response(null, { status: 204 });
			}

			await stripeCall(() =>
				stripe.customers.update(customer_id, {
					invoice_settings: { default_payment_method: pm_id },
				}),
			);
			return jsonResponse({ ok: true });
		}

		throw DelightError.notFound('Route not found');
	}

	switch (`${method} ${route_path}`) {
		// ── Subscription ───────────────────────────────────────────────

		case 'GET /subscription': {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) return jsonResponse({ subscription: null });

			// Lightweight read — no entitlement writes or broadcasts here.
			// Use POST /sync for a full sync.
			const state = await fetchSubscriptionState(config, customer_id);

			// Still cache active plan ids so requirePlan() guards stay fresh
			getSetOrgState(event, config)?.({ billing_plan_ids: activePlanIds(state) });

			return jsonResponse({ subscription: state });
		}

		case 'POST /subscription': {
			const body = await parseBody(event.request);
			const plan_id = body.plan_id as string;
			const payment_method_id = body.payment_method_id as string | undefined;
			const coupon = body.coupon as string | undefined;

			if (!plan_id) throw DelightError.badRequest('plan_id is required');

			const plan = config.plans?.find((p) => p.id === plan_id);
			if (!plan) throw DelightError.badRequest(`Unknown plan: ${plan_id}`);

			const customer_id = await ensureCustomer(event, config, ctx);

			// Look up the price by lookup_key
			const prices = await stripeCall(() =>
				stripe.prices.list({
					lookup_keys: [plan.lookup_key],
					limit: 1,
				}),
			);
			const price = prices.data[0];
			if (!price) throw DelightError.badRequest(`Price not found for plan: ${plan_id}`);

			// Check for existing active subscription
			const subs = await stripeCall(() =>
				stripe.subscriptions.list({
					customer: customer_id,
					status: 'active',
					limit: 1,
				}),
			);

			if (subs.data.length > 0) {
				// Update existing subscription
				const existing = subs.data[0];
				await stripeCall(() =>
					stripe.subscriptions.update(existing.id, {
						items: [
							...existing.items.data.map((item) => ({
								id: item.id,
								deleted: true as const,
							})),
							{ price: price.id },
						],
						...(payment_method_id ? { default_payment_method: payment_method_id } : {}),
						proration_behavior: 'create_prorations',
						...(coupon ? { coupon } : {}),
					}),
				);
			} else {
				// Create new subscription
				await stripeCall(() =>
					stripe.subscriptions.create({
						customer: customer_id,
						items: [{ price: price.id }],
						...(payment_method_id ? { default_payment_method: payment_method_id } : {}),
						...(plan.trial_days ? { trial_period_days: plan.trial_days } : {}),
						...(coupon ? { coupon } : {}),
					}),
				);
			}

			// Sync and return updated state
			const state = await syncSubscription({
				config,
				customer_id,
				org_id: getOrgId(event, config),
				user_id: getUserId(event),
				auth: ctx.getAuthServer?.(event),
				ws: ctx.getWebsocket?.(event),
				setOrgState: getSetOrgState(event, config),
			});

			if (config.hooks?.onSubscriptionChange && state) {
				await config.hooks.onSubscriptionChange({
					customer_id,
					subscription_id: state.subscription_id,
					status: state.status,
					plan_id: state.plan_ids[0] ?? null,
					entitlements: state.entitlements,
					event,
				});
			}

			return jsonResponse({ subscription: state });
		}

		case 'DELETE /subscription': {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) throw DelightError.badRequest('No customer found');

			// Optional body: { cancel_at_period_end?: boolean }
			const body = await parseBody(event.request).catch(
				() => ({}) as Record<string, unknown>,
			);
			const cancel_at_period_end = body.cancel_at_period_end === true;

			// Default list excludes canceled — include trialing/past_due, not just active
			const subs = await stripeCall(() =>
				stripe.subscriptions.list({
					customer: customer_id,
					limit: 100,
				}),
			);
			const cancellable = subs.data.find((s) =>
				['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status),
			);

			if (cancellable) {
				if (cancel_at_period_end) {
					await stripeCall(() =>
						stripe.subscriptions.update(cancellable.id, {
							cancel_at_period_end: true,
						}),
					);
				} else {
					await stripeCall(() =>
						stripe.subscriptions.cancel(cancellable.id, {
							invoice_now: true,
							prorate: true,
						}),
					);
				}
			}

			// Sync to clear entitlements
			const state = await syncSubscription({
				config,
				customer_id,
				org_id: getOrgId(event, config),
				user_id: getUserId(event),
				auth: ctx.getAuthServer?.(event),
				ws: ctx.getWebsocket?.(event),
				setOrgState: getSetOrgState(event, config),
			});

			// Fire the lifecycle hook for cancellations too — when nothing remains,
			// report the canceled subscription explicitly
			if (config.hooks?.onSubscriptionChange && cancellable) {
				await config.hooks.onSubscriptionChange({
					customer_id,
					subscription_id: state?.subscription_id ?? cancellable.id,
					status: state?.status ?? 'canceled',
					plan_id: state?.plan_ids[0] ?? null,
					entitlements: state?.entitlements ?? [],
					event,
				});
			}

			return new Response(null, { status: 204 });
		}

		// ── Invoices ───────────────────────────────────────────────────

		case 'GET /invoice': {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) return jsonResponse({ invoices: [] });

			const limit = parseInt(event.url.searchParams.get('limit') ?? '10', 10);
			const invoices = await stripeCall(() =>
				stripe.invoices.list({
					customer: customer_id,
					limit: Math.min(limit, 100),
				}),
			);
			return jsonResponse({
				invoices: invoices.data.map(formatInvoice),
			});
		}

		// ── Payment Methods ────────────────────────────────────────────

		case 'GET /payment-method': {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) return jsonResponse({ payment_methods: [] });

			const methods = await stripeCall(() =>
				stripe.paymentMethods.list({ customer: customer_id }),
			);
			const customer = (await stripeCall(() =>
				stripe.customers.retrieve(customer_id),
			)) as Stripe.Customer;
			const default_pm = customer.invoice_settings?.default_payment_method;

			return jsonResponse({
				payment_methods: methods.data.map((m) => formatPaymentMethod(m, default_pm)),
			});
		}

		case 'POST /payment-method': {
			const customer_id = await ensureCustomer(event, config, ctx);

			const session = await stripeCall(() =>
				stripe.checkout.sessions.create({
					mode: 'setup',
					customer: customer_id,
					currency: 'usd',
					ui_mode: 'embedded',
					return_url: `${getAppUrl(event, config)}/billing/complete?session_id={CHECKOUT_SESSION_ID}`,
				}),
			);

			return jsonResponse({ client_secret: session.client_secret }, 201);
		}

		// ── Billing Portal ─────────────────────────────────────────────

		case 'POST /portal': {
			if (!config.portal.enabled) {
				throw DelightError.badRequest('Billing Portal is not enabled');
			}

			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) throw DelightError.badRequest('No customer found');

			const body = await parseBody(event.request).catch(
				() => ({}) as Record<string, unknown>,
			);
			// Validate the user-provided return_url (open-redirect protection)
			const return_url =
				resolveReturnUrl(event, config, body.return_url) ?? getAppUrl(event, config);

			const session = await stripeCall(() =>
				stripe.billingPortal.sessions.create({
					customer: customer_id,
					return_url,
				}),
			);

			return jsonResponse({ url: session.url });
		}

		// ── Checkout ───────────────────────────────────────────────────

		case 'POST /checkout': {
			const body = await parseBody(event.request);
			const plan_id = body.plan_id as string;

			if (!plan_id) throw DelightError.badRequest('plan_id is required');

			const plan = config.plans?.find((p) => p.id === plan_id);
			if (!plan) throw DelightError.badRequest(`Unknown plan: ${plan_id}`);

			// Validate the user-provided return_url (open-redirect protection)
			// before making any Stripe calls
			const return_url =
				resolveReturnUrl(event, config, body.return_url) ??
				`${getAppUrl(event, config)}/billing/complete?session_id={CHECKOUT_SESSION_ID}`;

			const customer_id = await ensureCustomer(event, config, ctx);

			const prices = await stripeCall(() =>
				stripe.prices.list({
					lookup_keys: [plan.lookup_key],
					limit: 1,
				}),
			);
			const price = prices.data[0];
			if (!price) throw DelightError.badRequest(`Price not found for plan: ${plan_id}`);

			const session = await stripeCall(() =>
				stripe.checkout.sessions.create({
					mode: 'subscription',
					customer: customer_id,
					line_items: [{ price: price.id, quantity: 1 }],
					ui_mode: 'embedded',
					return_url,
					...(plan.trial_days
						? {
								subscription_data: {
									trial_period_days: plan.trial_days,
								},
							}
						: {}),
				}),
			);

			return jsonResponse({ client_secret: session.client_secret });
		}

		// ── Plans (public info) ────────────────────────────────────────

		case 'GET /plan': {
			const plans = (config.plans ?? [])
				.filter((p) => !p.archived)
				.map((p) => ({
					id: p.id,
					name: p.name,
					description: p.description,
					amount: p.amount,
					currency: p.currency ?? 'usd',
					interval: p.interval,
					interval_count: p.interval_count ?? 1,
					entitlements: p.entitlements ?? [],
					trial_days: p.trial_days,
				}));
			return jsonResponse({ plans });
		}

		// ── Config (client-safe) ───────────────────────────────────────

		case 'GET /config': {
			return jsonResponse({
				publishable_key: config.publishable_key,
				portal_enabled: config.portal.enabled,
			});
		}

		// ── Force sync ─────────────────────────────────────────────────

		case 'POST /sync': {
			const customer_id = await resolveCustomerIdAsync(event, config);
			if (!customer_id) return jsonResponse({ subscription: null });

			const state = await syncSubscription({
				config,
				customer_id,
				org_id: getOrgId(event, config),
				user_id: getUserId(event),
				auth: ctx.getAuthServer?.(event),
				ws: ctx.getWebsocket?.(event),
				setOrgState: getSetOrgState(event, config),
			});
			return jsonResponse({ subscription: state });
		}

		default:
			throw DelightError.notFound('Route not found');
	}
}
