import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeEventStore } from './stripe-event-store';
import { durableObjectEventStore } from '../server/billing.event-store';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Map-backed mock of the Durable Object storage API surface the store uses */
function makeStorage() {
	const data = new Map<string, number>();
	let alarm: number | null = null;
	return {
		data,
		get: vi.fn(async (key: string) => data.get(key)),
		put: vi.fn(async (key: string, value: number) => {
			data.set(key, value);
		}),
		delete: vi.fn(async (keys: string[]) => {
			for (const key of keys) data.delete(key);
		}),
		list: vi.fn(async () => new Map(data)),
		getAlarm: vi.fn(async () => alarm),
		setAlarm: vi.fn(async (at: number) => {
			alarm = at;
		}),
	};
}

function makeStore() {
	const storage = makeStorage();
	const store = new StripeEventStore(
		{ storage } as unknown as ConstructorParameters<typeof StripeEventStore>[0],
		{},
	);
	return { store, storage };
}

beforeEach(() => {
	vi.useRealTimers();
});

describe('StripeEventStore', () => {
	it('remembers processed event ids', async () => {
		const { store } = makeStore();
		expect(await store.has('evt_1')).toBe(false);
		await store.add('evt_1');
		expect(await store.has('evt_1')).toBe(true);
		expect(await store.has('evt_2')).toBe(false);
	});

	it('arms the cleanup alarm on first add only', async () => {
		const { store, storage } = makeStore();
		await store.add('evt_1');
		await store.add('evt_2');
		expect(storage.setAlarm).toHaveBeenCalledTimes(1);
	});

	it('prunes expired ids on alarm and re-arms while entries remain', async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000_000);
			const { store, storage } = makeStore();
			await store.add('evt_old');

			// Fresh entry added much later; the old one is now expired
			vi.setSystemTime(1_000_000 + WEEK_MS + 1);
			await store.add('evt_fresh');
			await store.alarm();

			expect(await store.has('evt_old')).toBe(false);
			expect(await store.has('evt_fresh')).toBe(true);
			// Re-armed because evt_fresh remains
			expect(storage.setAlarm).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not re-arm once everything is pruned', async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000_000);
			const { store, storage } = makeStore();
			await store.add('evt_old');
			vi.setSystemTime(1_000_000 + WEEK_MS + 1);
			await store.alarm();

			expect(await store.has('evt_old')).toBe(false);
			expect(storage.setAlarm).toHaveBeenCalledTimes(1); // only the add's arm
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('durableObjectEventStore adapter', () => {
	it('routes has/add through a stable named DO instance', async () => {
		const { store } = makeStore();
		const idFromName = vi.fn((name: string) => `id:${name}`);
		const get = vi.fn(() => store);
		const adapter = durableObjectEventStore({ idFromName, get });

		expect(await adapter.has('evt_a')).toBe(false);
		await adapter.add('evt_a');
		expect(await adapter.has('evt_a')).toBe(true);
		expect(idFromName).toHaveBeenCalledWith('stripe-webhook-events');
		expect(get).toHaveBeenCalledWith('id:stripe-webhook-events');
	});
});
