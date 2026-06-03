<script>
	import { FileUpload } from '@delightstack/components/form';

	let files = $state([]);
</script>

<div style="width: 100%;">
	<FileUpload bind:files multiple label="Upload files">
		{#snippet file_item({ file, index, remove })}
			<div
				style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--color-border, #ddd); border-radius: 0.375rem; margin-top: 0.5rem;">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
				</svg>
				<div style="flex: 1; min-width: 0;">
					<div
						style="font-size: 0.875rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
						{file.name}
					</div>
					<div style="font-size: 0.75rem; color: var(--sl-color-gray-3);">
						{(file.size / 1024).toFixed(1)} KB
					</div>
				</div>
				<button
					onclick={remove}
					style="background: none; border: none; cursor: pointer; padding: 0.25rem; color: var(--c-error, hsl(0 70% 55%)); display: flex;">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
		{/snippet}
	</FileUpload>
</div>
