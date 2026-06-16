<script lang="ts">
	import { onMount } from 'svelte';
	import {
		PresenceClient,
		setPresence,
		trackCursor,
		fieldPresence,
		userColor,
		type PresenceTransport,
		type PresenceMessage,
	} from '@delightstack/presence';
	import { PresenceAvatars, Cursors, Reactions } from '@delightstack/presence/components';

	const PAGE = 'presence-demo';

	// --- A demo transport: real across browser tabs (BroadcastChannel), plus a
	// local `emit` used to drive simulated "bot" peers for solo visitors. No
	// websocket/auth needed — presence only depends on the transport interface.
	function createDemoTransport() {
		const channel = new BroadcastChannel('delightstack-presence-demo');
		let handler: ((message: PresenceMessage) => void) | null = null;
		channel.onmessage = (event) => handler?.(event.data as PresenceMessage);
		const transport: PresenceTransport = {
			get connected() {
				return true;
			},
			get sessions() {
				return [];
			},
			send: (message) => channel.postMessage(message),
			on: (cb) => {
				handler = cb;
				return () => {
					if (handler === cb) handler = null;
				};
			},
		};
		return {
			transport,
			emit: (message: PresenceMessage) => handler?.(message),
			close: () => channel.close(),
		};
	}

	// --- Local identity (a random famous computer scientist per tab).
	const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Katherine', 'Edsger'];
	const me = NAMES[Math.floor(Math.random() * NAMES.length)];
	const my_id = `you-${Math.random().toString(36).slice(2, 8)}`;
	const identity = {
		get user() {
			return { id: my_id, name: me };
		},
		get orgId() {
			return PAGE;
		},
	};

	const demo = createDemoTransport();
	const presence = new PresenceClient({
		transport: demo.transport,
		identity,
		page: () => PAGE,
	});
	setPresence(presence);

	// --- Two simulated peers with animated cursors.
	const bots = [
		{ id: 'bot-mononoke', name: 'Mononoke' },
		{ id: 'bot-totoro', name: 'Totoro' },
	].map((b) => ({ ...b, color: userColor(b), clock: 0 }));

	const EMOJIS = ['👍', '🎉', '❤️', '😂', '🔥'];

	onMount(() => {
		presence.start();

		const start = performance.now();
		let raf = 0;
		const loop = (now: number) => {
			const t = (now - start) / 1000;
			bots.forEach((bot, i) => {
				const x = 0.5 + 0.38 * Math.sin(t * 0.7 + i * 2.1);
				const y = 0.5 + 0.34 * Math.cos(t * 0.9 + i * 1.3);
				// Bot 0 periodically "focuses" the name field to show field presence.
				const focusing = i === 0 && Math.sin(t * 0.5) > 0.6;
				demo.emit({
					event: 'presence:update',
					presence_id: bot.id,
					user: { id: bot.id, name: bot.name, color: bot.color },
					state: {
						page: PAGE,
						cursor: { x, y, stage: PAGE },
						status: 'active',
						focus: focusing ? { anchor: 'demo.name', label: 'Name' } : null,
					},
					clock: ++bot.clock,
					t: Date.now(),
				});
			});
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		// Occasional bot reactions.
		const react_timer = setInterval(() => {
			const bot = bots[Math.floor(Math.random() * bots.length)];
			demo.emit({
				event: 'presence:reaction',
				presence_id: bot.id,
				user: { id: bot.id, name: bot.name, color: bot.color },
				emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
				page: PAGE,
				at: Date.now(),
			});
		}, 4000);

		return () => {
			cancelAnimationFrame(raf);
			clearInterval(react_timer);
			presence.destroy();
			demo.close();
		};
	});
</script>

<div class="demo">
	<div class="bar">
		<PresenceAvatars scope="org" size={30} />
		<span class="hint">
			You're <strong>{me}</strong>
			— open this page in a second tab to meet yourself.
		</span>
	</div>

	<div class="stage" data-presence-stage={PAGE} {@attach trackCursor({ chat: true })}>
		<p class="stage-hint">
			Move your cursor here · press <kbd>/</kbd>
			to chat
		</p>
		<div class="fields">
			<input placeholder="Name" aria-label="Name" {@attach fieldPresence('demo.name')} />
			<input
				placeholder="Email"
				aria-label="Email"
				{@attach fieldPresence('demo.email')} />
		</div>
		<Reactions bar={EMOJIS} />
	</div>

	<Cursors />
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.hint {
		font-size: 0.85rem;
		color: var(--sl-color-gray-3, #6b7280);
	}

	.stage {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 260px;
		padding: 1.5rem;
		border: 1px dashed var(--sl-color-gray-4, #cbd5e1);
		border-radius: 0.75rem;
		background: var(--sl-color-gray-7, #f8fafc);
		overflow: hidden;
	}

	.stage-hint {
		margin: 0;
		font-size: 0.9rem;
		color: var(--sl-color-gray-3, #6b7280);
	}

	kbd {
		padding: 0.05em 0.4em;
		font-family: var(--sl-font-mono, monospace);
		font-size: 0.85em;
		border: 1px solid var(--sl-color-gray-4, #cbd5e1);
		border-radius: 0.3em;
	}

	.fields {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.fields input {
		padding: 0.4rem 0.7rem;
		font: inherit;
		font-size: 0.9rem;
		color: var(--sl-color-text, inherit);
		background: var(--sl-color-bg, #fff);
		border: 1px solid var(--sl-color-gray-4, #cbd5e1);
		border-radius: 0.5rem;
		outline: none;
	}
</style>
