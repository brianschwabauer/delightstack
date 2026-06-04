<script module lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { DelightError } from '@delightstack/utilities';

	/**
	 * An action for moving a component to a different parent element
	 * Usage: <div use:portal={'css selector'}> or <div use:portal={document.body}>
	 */
	export function portal(el: HTMLElement, target: HTMLElement | string = 'body') {
		let targetEl: HTMLElement | null = null;
		async function update(newTarget: HTMLElement | string) {
			target = newTarget;
			if (target === '.portals') {
				targetEl = document.querySelector('.portals');
				if (!targetEl) {
					targetEl = document.createElement('div');
					targetEl.classList.add('portals');
					document.body.appendChild(targetEl);
				}
			} else if (typeof target === 'string') {
				targetEl = document.querySelector(target);
				if (targetEl === null) {
					await tick();
					targetEl = document.querySelector(target);
				}
				if (targetEl === null) {
					throw new DelightError(`No element found matching css selector: "${target}"`);
				}
			} else if (target instanceof HTMLElement) {
				targetEl = target;
			} else {
				throw new DelightError(
					`Unknown portal target type: ${
						target === null ? 'null' : typeof target
					}. Allowed types: string (CSS selector) or HTMLElement.`,
				);
			}
			targetEl.appendChild(el);
			el.hidden = false;
		}

		function destroy() {
			el.remove();
		}

		update(target);
		return {
			update,
			destroy,
		};
	}
</script>

<script lang="ts">
	const propId = $props.id();
	let {
		/** The DOM Element or CSS Selector where the portal elenent should be inserted */
		target = '.portals' as HTMLElement | string,

		/** The child elements to display inside the portal */
		children = undefined as undefined | Snippet,

		/** The ID of the portal element */
		id = propId,
	} = $props();
</script>

{#if children}
	<div use:portal={target} hidden class="portal" {id}>
		{@render children()}
	</div>
{/if}

<style>
	:global(.portals),
	:global(.portals .portal) {
		position: static;
		display: contents;
	}
</style>
