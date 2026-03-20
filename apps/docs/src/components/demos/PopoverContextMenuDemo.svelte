<script>
	import { Popover } from '@delightstack/components/actions';

	let opened = $state(false);
	let menuX = $state(0);
	let menuY = $state(0);

	function onContextMenu(e) {
		e.preventDefault();
		menuX = e.clientX;
		menuY = e.clientY;
		opened = true;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	oncontextmenu={onContextMenu}
	style="padding: 2rem; border: 1px dashed var(--color-border, rgba(255,255,255,0.15)); border-radius: var(--radius-3, 8px); color: var(--color-text); text-align: center; user-select: none; cursor: context-menu;">
	Right-click anywhere in this area
</div>
<Popover bind:opened x={menuX} y={menuY} strategy="fixed" arrow={false} dense>
	<div style="min-width: 140px; color: var(--color-text);">
		<button style="display:block;width:100%;text-align:left;padding:0.375rem 0.5rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;border-radius:4px;" onclick={() => (opened = false)} onmouseenter={(e) => e.currentTarget.style.background='var(--color-bg-2,rgba(255,255,255,0.05))'} onmouseleave={(e) => e.currentTarget.style.background='none'}>Cut</button>
		<button style="display:block;width:100%;text-align:left;padding:0.375rem 0.5rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;border-radius:4px;" onclick={() => (opened = false)} onmouseenter={(e) => e.currentTarget.style.background='var(--color-bg-2,rgba(255,255,255,0.05))'} onmouseleave={(e) => e.currentTarget.style.background='none'}>Copy</button>
		<button style="display:block;width:100%;text-align:left;padding:0.375rem 0.5rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;border-radius:4px;" onclick={() => (opened = false)} onmouseenter={(e) => e.currentTarget.style.background='var(--color-bg-2,rgba(255,255,255,0.05))'} onmouseleave={(e) => e.currentTarget.style.background='none'}>Paste</button>
	</div>
</Popover>
