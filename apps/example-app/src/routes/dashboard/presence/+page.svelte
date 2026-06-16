<script lang="ts">
	import { getPresence, fieldPresence } from '@delightstack/presence';
	import { PresenceAvatars } from '@delightstack/presence/components';

	const presence = getPresence();

	const here = $derived(presence.users.filter((u) => u.here));
	const reactions = ['👍', '🎉', '❤️', '😂', '😮', '🔥'];

	let name = $state('');
	let email = $state('');
</script>

<div class="page">
	<header>
		<h1>Presence</h1>
		<p>
			Live cursors, an online roster, reactions, and field presence — powered by
			<code>@delightstack/presence</code>
			.
		</p>
	</header>

	<section class="card">
		<div class="card-head">
			<h3>Who's here</h3>
			<PresenceAvatars scope="org" size={36} />
		</div>
		<p class="muted">
			{here.length}
			{here.length === 1 ? 'person is' : 'people are'} on this page right now.
			{#if here.length <= 1}
				Open this page in a second browser tab (or sign in as another family member) to
				see live cursors move between them.
			{/if}
		</p>
	</section>

	<section class="card">
		<h3>Live cursors &amp; cursor chat</h3>
		<p class="muted">
			Move your mouse anywhere in this area — everyone else on this page sees your cursor.
			Press <kbd>/</kbd>
			to type a message that floats alongside it.
		</p>
		<div class="cursor-pad">
			<span>move your cursor here ✨</span>
		</div>
	</section>

	<section class="card">
		<h3>Reactions</h3>
		<p class="muted">Send a reaction — it floats up for everyone on the page.</p>
		<div class="reactions">
			{#each reactions as emoji (emoji)}
				<button
					type="button"
					onclick={() => presence.react(emoji)}
					aria-label="React {emoji}">
					{emoji}
				</button>
			{/each}
		</div>
	</section>

	<section class="card">
		<h3>Field presence</h3>
		<p class="muted">
			Focus a field below. Others on this page see a colored ring and your name on it — a
			gentle "someone's editing this" cue.
		</p>
		<div class="fields">
			<label>
				<span>Name</span>
				<input
					bind:value={name}
					placeholder="Your name"
					{@attach fieldPresence('demo.name', { label: 'Name' })} />
			</label>
			<label>
				<span>Email</span>
				<input
					bind:value={email}
					type="email"
					placeholder="you@example.com"
					{@attach fieldPresence('demo.email', { label: 'Email' })} />
			</label>
		</div>
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}

	header h1 {
		font-family: var(--font-serif);
	}
	header p {
		color: var(--color-text-disabled);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		background: var(--color-bg-0);
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--size-3);
	}

	.muted {
		color: var(--color-text-disabled);
		font-size: var(--font-size-1);
	}

	kbd {
		padding: 0.05em 0.4em;
		font-family: var(--font-mono, monospace);
		font-size: 0.85em;
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-1);
		background: var(--color-bg-1);
	}

	.cursor-pad {
		display: grid;
		place-items: center;
		min-height: 180px;
		border: 1px dashed var(--color-outline);
		border-radius: var(--radius-2);
		color: var(--color-text-disabled);
		background: var(--color-bg-1);
	}

	.reactions {
		display: flex;
		gap: var(--size-2);
		flex-wrap: wrap;
		button {
			display: grid;
			place-items: center;
			width: 2.75rem;
			height: 2.75rem;
			font-size: 1.4rem;
			line-height: 1;
			border: 1px solid var(--color-outline);
			border-radius: var(--radius-2);
			background: var(--color-bg-1);
			cursor: pointer;
			transition:
				transform 0.12s ease,
				background 0.12s ease;
			&:hover {
				transform: scale(1.1);
				background: var(--color-bg-2);
				/* Snap the tint in; keep the scale easing (design system convention). */
				transition: transform 0.12s ease;
			}
			&:active {
				transform: scale(0.95);
			}
		}
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--size-3);
		label {
			display: flex;
			flex-direction: column;
			gap: var(--size-1);
			font-size: var(--font-size-0);
			color: var(--color-text-disabled);
		}
		input {
			padding: var(--size-2) var(--size-3);
			font-size: var(--font-size-1);
			color: var(--color-text);
			border: 1px solid var(--color-outline);
			border-radius: var(--radius-2);
			background: var(--color-bg-1);
			outline: none;
			&:focus {
				border-color: var(--color-action);
			}
		}
	}
</style>
