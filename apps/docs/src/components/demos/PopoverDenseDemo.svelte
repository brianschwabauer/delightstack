<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let denseEl = $state(undefined);
	let defaultEl = $state(undefined);
	let comfortableEl = $state(undefined);
	let denseOpen = $state(false);
	let defaultOpen = $state(false);
	let comfortableOpen = $state(false);
</script>

<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
	<div style="display:inline-block;" bind:this={denseEl}>
		<Button onclick={() => (denseOpen = !denseOpen)}>Dense Popover</Button>
		<Popover
			ref_element={denseEl}
			bind:opened={denseOpen}
			arrow={false}
			placement="bottom-start"
			dense>
			<p style="min-width: 150px; line-height: 1.25">Compact padding for tight spaces.</p>
		</Popover>
	</div>

	<div style="display:inline-block;" bind:this={defaultEl}>
		<Button onclick={() => (defaultOpen = !defaultOpen)}>Default</Button>
		<Popover
			ref_element={defaultEl}
			bind:opened={defaultOpen}
			arrow={false}
			placement="bottom-start">
			<p style="min-width: 200px; line-height: 1.5;">
				Standard padding for most use cases.
			</p>
		</Popover>
	</div>

	<div style="display:inline-block;" bind:this={comfortableEl}>
		<Button onclick={() => (comfortableOpen = !comfortableOpen)}>
			Comfortable Popover
		</Button>
		<Popover
			ref_element={comfortableEl}
			bind:opened={comfortableOpen}
			arrow={false}
			placement="bottom-start"
			comfortable>
			<p style="min-width: 250px; line-height: 1.5;">
				Spacious padding for relaxed layouts.
			</p>
		</Popover>
	</div>
</div>
