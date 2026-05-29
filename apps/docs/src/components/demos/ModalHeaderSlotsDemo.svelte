<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Document</Button>

<Modal bind:open title="Document">
	{#snippet headerStart()}
		<span
			style="background: var(--color-accent); color: var(--color-accent-text); padding: 0.15em 0.5em; border-radius: var(--radius-2); font-size: 0.75em; font-weight: 600;">
			Draft
		</span>
	{/snippet}

	{#snippet headerEnd()}
		<Button transparent dense icon size="0" aria-label="Share">
			<svg viewBox="0 0 24 24" fill="currentColor">
				<path
					d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
			</svg>
		</Button>
	{/snippet}

	<div style="display: flex; flex-direction: column; gap: 0.75em; max-width: 38em; color: var(--color-text);">
		<p style="margin: 0;">
			Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
			tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
			veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
			commodo consequat.
		</p>
		<p style="margin: 0;">
			Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
			dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non
			proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
		</p>
		<p style="margin: 0;">
			Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium
			doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo
			inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
		</p>
	</div>
</Modal>
