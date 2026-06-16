import { getContext, setContext } from 'svelte';
import type { PresenceClient } from '../core';

const KEY = Symbol('delightstack.presence');

/** Provide a `PresenceClient` to descendant components and attachments. */
export function setPresence(client: PresenceClient): PresenceClient {
	return setContext(KEY, client);
}

/** Read the `PresenceClient` from context. Throws if none was provided. */
export function getPresence(): PresenceClient {
	const client = getContext<PresenceClient | undefined>(KEY);
	if (!client) {
		throw new Error(
			'No PresenceClient in context. Call setPresence(client) in a parent component.',
		);
	}
	return client;
}

/** Read the `PresenceClient` from context, or `undefined` if none was provided. */
export function tryGetPresence(): PresenceClient | undefined {
	return getContext<PresenceClient | undefined>(KEY);
}
