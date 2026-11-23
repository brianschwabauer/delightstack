<script lang="ts">
	import {
		Button,
		Popover,
		portal,
		type PopoverPlacement,
	} from '@delightstack/components/actions';
	import { Toggle } from '@delightstack/components/form';

	type Corner = { label: string; placement: PopoverPlacement; class: string };
	/* Each corner's placement points off screen, so every popover has to flip
	   on one axis and shift along the other to stay in the window. */
	const CORNERS: Corner[] = [
		{ label: 'Top left', placement: 'top', class: 'top left' },
		{ label: 'Top right', placement: 'right', class: 'top right' },
		{ label: 'Bottom right', placement: 'bottom', class: 'bottom right' },
		{ label: 'Bottom left', placement: 'left', class: 'bottom left' },
	];

	let shown = $state(false);
	let ref_elements = $state<(HTMLElement | undefined)[]>([]);
</script>

<Toggle bind:checked={shown} label="Triggers in the window corners" />

{#if shown}
	<div class="corners" use:portal={'body'}>
		{#each CORNERS as corner, index (corner.label)}
			<div class="corner {corner.class}">
				<Button dense bind:button_element={ref_elements[index]}>{corner.label}</Button>
				<Popover
					ref_element={ref_elements[index]}
					open_on_click
					arrow={false}
					placement={corner.placement}>
					<p style="width: 240px; margin: 0; line-height: 1.5;">
						An arrowless popover, placed <code>{corner.placement}</code>
						, stays inside the window.
					</p>
				</Popover>
			</div>
		{/each}
	</div>
{/if}

<style>
	.corner {
		position: fixed;
		z-index: 100;
		&.top {
			top: 4px;
		}
		&.bottom {
			bottom: 4px;
		}
		&.left {
			left: 4px;
		}
		&.right {
			right: 4px;
		}
	}
</style>
