/** WebSocket event types broadcast by the billing system */

export interface BillingSubscriptionChangedEvent {
	event: 'billing:subscription:changed';
	subscription_id: string;
	status: string;
	plan_ids: string[];
	entitlements: string[];
}

export interface BillingPaymentSucceededEvent {
	event: 'billing:payment:succeeded';
	invoice_id: string;
	amount: number;
	currency: string;
}

export interface BillingPaymentFailedEvent {
	event: 'billing:payment:failed';
	invoice_id: string;
	amount: number;
	currency: string;
}

export type BillingWebsocketEvent =
	| BillingSubscriptionChangedEvent
	| BillingPaymentSucceededEvent
	| BillingPaymentFailedEvent;
