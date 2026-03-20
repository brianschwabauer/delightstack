<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface AlertOptions {
		title?: string;
		message: string;
		cancelText?: string;
		continueText?: string;
		destructive?: boolean;
		icon?: Component<Record<string, never>>;
	}

	/**
	 * Programmatic API: creates an Alert dialog imperatively and returns a Promise
	 * resolving to `true` (confirmed) or `false` (cancelled).
	 */
	export async function alert(options: AlertOptions): Promise<boolean> {
		const { mount, unmount } = await import('svelte');
		const mod = await import('./Alert.svelte');
		const AlertComponent = mod.default;

		return new Promise((resolve) => {
			let container = document.querySelector('.portals');
			if (!container) {
				container = document.createElement('div');
				container.classList.add('portals');
				document.body.appendChild(container);
			}
			const wrapper = document.createElement('div');
			container.appendChild(wrapper);

			let instance: Record<string, unknown>;

			function cleanup(result: boolean) {
				resolve(result);
				try {
					unmount(instance);
				} catch {
					// already unmounted
				}
				wrapper.remove();
			}

			instance = mount(AlertComponent, {
				target: wrapper,
				props: {
					open: true,
					title: options.title || 'Confirm',
					message: options.message,
					cancelText: options.cancelText || 'Cancel',
					continueText: options.continueText || 'Continue',
					destructive: options.destructive || false,
					icon: options.icon,
					oncancel: () => cleanup(false),
					oncontinue: () => cleanup(true),
				},
			});
		});
	}
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

	const propId = $props.id();
	let {
		/** Controls visibility */
		open = $bindable(false) as boolean,

		/** Alert title */
		title = 'Confirm',

		/** Alert message / question */
		message = '',

		/** Cancel button label */
		cancelText = 'Cancel',

		/** Confirm button label */
		continueText = 'Continue',

		/** Style confirm button with error color */
		destructive = false,

		/** Optional icon displayed above the title */
		icon: Icon = undefined as Component<Record<string, never>> | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Called when Cancel is clicked */
		oncancel = undefined as (() => void) | undefined,

		/** Called when Confirm is clicked; promise-aware */
		oncontinue = undefined as (() => void | Promise<void>) | undefined,
	} = $props();

	function handleCancel() {
		open = false;
		oncancel?.();
	}

	function handleBackdropClick() {
		handleCancel();
	}

	function handleClose() {
		handleCancel();
		return true;
	}
</script>

<Modal
	bind:open
	title=""
	closable
	disableCloseIcon
	width="400px"
	maxWidth="calc(100vw - 2rem)"
	onclose={handleClose}
	onbackdropclick={handleBackdropClick}
	{id}
	class="alert-modal {className}">
	<div class="alert">
		{#if Icon}
			<div class="alert-icon" class:destructive>
				<Icon />
			</div>
		{/if}
		{#if title}
			<h3 class="alert-title">{title}</h3>
		{/if}
		{#if message}
			<p class="alert-message">{message}</p>
		{/if}
		<div class="alert-actions">
			<Button accent={!destructive} error={destructive} fullWidth onclick={oncontinue}>
				{continueText}
			</Button>
			<Button translucent fullWidth onclick={handleCancel}>
				{cancelText}
			</Button>
		</div>
	</div>
</Modal>

<style>
	.alert {
		text-align: center;
		padding: 0.5rem 0;
	}

	.alert-icon {
		display: flex;
		justify-content: center;
		margin-bottom: 0.75rem;
		color: var(--color-text-muted);
		font-size: 2rem;

		&.destructive {
			color: var(--color-error);
		}
	}

	.alert-title {
		font-size: var(--text-lg, 1.125rem);
		font-weight: var(--font-weight-semibold, 600);
		color: var(--color-text);
		margin: 0 0 0.5rem;
	}

	.alert-message {
		font-size: var(--text-base, 1rem);
		color: var(--color-text-muted);
		line-height: var(--leading-relaxed, 1.75);
		margin: 0;
	}

	.alert-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 1.5rem;
	}
</style>
