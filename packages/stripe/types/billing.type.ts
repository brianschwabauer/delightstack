import type Stripe from 'stripe';

/** Current subscription state — returned from sync and stored reactively on the client */
export interface SubscriptionState {
	subscription_id: string;
	status: Stripe.Subscription.Status;
	plan_ids: string[];
	entitlements: string[];
	current_period_start: number;
	current_period_end: number;
	cancel_at?: number;
	canceled_at?: number;
	trial_start?: number;
	trial_end?: number;
}

/** Client-safe plan information */
export interface PlanInfo {
	id: string;
	name: string;
	description?: string;
	amount: number;
	currency: string;
	interval: 'month' | 'year' | 'week' | 'day';
	interval_count: number;
	entitlements: string[];
	trial_days?: number;
}

/** Formatted payment method info for client display */
export interface PaymentMethodInfo {
	id: string;
	type: string;
	brand?: string;
	last4?: string;
	exp_month?: number;
	exp_year?: number;
	display_name: string;
	is_default: boolean;
}

/** Formatted invoice info for client display */
export interface InvoiceInfo {
	id: string;
	number: string | null;
	status: string | null;
	amount_paid: number;
	amount_due: number;
	total: number;
	currency: string;
	created: number;
	due_date: number | null;
	period_start: number | null;
	period_end: number | null;
	pdf: string | null;
	hosted_invoice_url: string | null;
}
