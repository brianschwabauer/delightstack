<script lang="ts">
	import { type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** The list of selected files */
		files = $bindable([]) as File[],

		/** Accepted file types (e.g. "image/*,.pdf") */
		accept = undefined as string | undefined,

		/** Whether multiple files can be selected */
		multiple = false,

		/** Maximum file size in bytes */
		maxSize = undefined as number | undefined,

		/** Maximum number of files allowed */
		maxFiles = undefined as number | undefined,

		/** Whether the file upload is disabled */
		disabled = false,

		/** Whether to show image previews */
		preview = true,

		/** Large drop area variant (default) */
		dropzone = true,

		/** Button-style compact variant */
		compact = false,

		/** Circular avatar variant */
		avatar = false,

		/** Size preset: 0=small, 1=medium, 2=large */
		size = '1' as '0' | '1' | '2',

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** Label text displayed above the upload area */
		label = undefined as string | undefined,

		/** Error message displayed below the upload area */
		error = undefined as string | undefined,

		/** Whether to use dense spacing */
		dense = false,

		/** Whether to use comfortable spacing */
		comfortable = false,

		/** The id of the file input element */
		id = propId,

		/** The name attribute for the file input */
		name = undefined as string | undefined,

		/** Custom class name */
		class: class_name = '',

		/** Called when files are selected */
		onselect = undefined as ((detail: { files: File[] }) => void) | undefined,

		/** Called when a file is removed */
		onremove = undefined as ((detail: { file: File; index: number }) => void) | undefined,

		/** Called when a file fails validation */
		onerror = undefined as ((detail: { file: File; error: string }) => void) | undefined,

		/** Custom snippet for rendering each file item */
		fileItem = undefined as
			| Snippet<[{ file: File; index: number; remove: () => void }]>
			| undefined,
	} = $props();

	let drag_counter = $state(0);
	let input_element = $state<HTMLInputElement | undefined>(undefined);
	let preview_urls = $state<Map<File, string>>(new Map());

	const is_drag_over = $derived(drag_counter > 0);

	const variant = $derived(avatar ? 'avatar' : compact ? 'compact' : 'dropzone');

	const avatar_preview_url = $derived(
		avatar && files.length > 0 && isImage(files[0])
			? preview_urls.get(files[0])
			: undefined,
	);

	/**
	 * Sync preview_urls with the given file list:
	 * - Create object URLs for new image files
	 * - Revoke object URLs for files that are no longer present
	 * Called imperatively from validateAndAddFiles/removeFile/etc.
	 */
	function syncPreviewUrls(next_files: File[]) {
		const next = new Map<File, string>();
		for (const file of next_files) {
			if (!isImage(file)) continue;
			const existing = preview_urls.get(file);
			next.set(file, existing ?? URL.createObjectURL(file));
		}
		// Revoke URLs for files that have been removed
		for (const [file, url] of preview_urls) {
			if (next.get(file) !== url) URL.revokeObjectURL(url);
		}
		preview_urls = next;
	}

	// Note: remaining object URLs are left to be garbage-collected by the
	// browser when the page unloads; revoking them here would require reading
	// the reactive `preview_urls` state which caused effect loops.

	function isImage(file: File): boolean {
		return file.type.startsWith('image/');
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function matchesAccept(file: File, accept_str: string): boolean {
		const tokens = accept_str.split(',').map((t) => t.trim().toLowerCase());
		const file_type = file.type.toLowerCase();
		const file_ext = '.' + file.name.split('.').pop()?.toLowerCase();

		for (const token of tokens) {
			if (token.startsWith('.')) {
				if (file_ext === token) return true;
			} else if (token.endsWith('/*')) {
				const category = token.slice(0, token.indexOf('/'));
				if (file_type.startsWith(category + '/')) return true;
			} else {
				if (file_type === token) return true;
			}
		}
		return false;
	}

	function validateAndAddFiles(incoming: File[]) {
		const valid_files: File[] = [];

		for (const file of incoming) {
			// Type validation
			if (accept && !matchesAccept(file, accept)) {
				onerror?.({
					file,
					error: `File type "${file.type || file.name}" is not accepted`,
				});
				continue;
			}

			// Size validation
			if (maxSize && file.size > maxSize) {
				onerror?.({ file, error: `File exceeds maximum size of ${formatSize(maxSize)}` });
				continue;
			}

			valid_files.push(file);
		}

		if (valid_files.length === 0) return;

		// For avatar, always replace
		if (avatar) {
			const next = [valid_files[0]];
			files = next;
			syncPreviewUrls(next);
			onselect?.({ files: next });
			return;
		}

		let new_files: File[];
		if (multiple) {
			new_files = [...files, ...valid_files];
			// Count validation
			if (maxFiles && new_files.length > maxFiles) {
				const excess = new_files.slice(maxFiles);
				for (const file of excess) {
					onerror?.({ file, error: `Maximum of ${maxFiles} files allowed` });
				}
				new_files = new_files.slice(0, maxFiles);
			}
		} else {
			new_files = [valid_files[0]];
		}

		files = new_files;
		syncPreviewUrls(new_files);
		onselect?.({ files: new_files });
	}

	function removeFile(index: number) {
		const file = files[index];
		if (!file) return;
		const next = files.filter((_, i) => i !== index);
		files = next;
		syncPreviewUrls(next);
		onremove?.({ file, index });
	}

	function openFilePicker() {
		if (disabled || skeleton) return;
		input_element?.click();
	}

	function onInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length) return;
		validateAndAddFiles(Array.from(input.files));
		// Reset input so same file can be re-selected
		input.value = '';
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openFilePicker();
		}
	}

	function onDragEnter(e: DragEvent) {
		e.preventDefault();
		if (disabled || skeleton) return;
		drag_counter++;
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function onDragLeave(e: DragEvent) {
		e.preventDefault();
		if (disabled || skeleton) return;
		drag_counter--;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (disabled || skeleton) return;
		drag_counter = 0;
		if (!e.dataTransfer?.files?.length) return;
		validateAndAddFiles(Array.from(e.dataTransfer.files));
	}

	const error_id = `${id}-error`;
	const label_id = `${id}-label`;
</script>

<div
	class={['file-upload', `size-${size}`, `variant-${variant}`, class_name]
		.filter(Boolean)
		.join(' ')}
	class:disabled
	class:dense
	class:comfortable
	class:skeleton
	class:has-error={!!error}>
	{#if label}
		<label class="label" id={label_id} for={id}>{label}</label>
	{/if}

	<input
		type="file"
		class="sr-only"
		bind:this={input_element}
		{id}
		{name}
		{accept}
		multiple={avatar ? false : multiple}
		{disabled}
		onchange={onInputChange}
		tabindex={-1}
		aria-hidden="true" />

	{#if variant === 'avatar'}
		<!-- Avatar variant: circular preview area -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="avatar-upload"
			class:drag-over={is_drag_over}
			role="button"
			tabindex={disabled ? -1 : 0}
			aria-label={label || 'Upload avatar'}
			ondragenter={onDragEnter}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
			onclick={openFilePicker}
			onkeydown={onKeyDown}>
			{#if avatar_preview_url}
				<img class="avatar-preview" src={avatar_preview_url} alt="Avatar preview" />
			{/if}
			<div class="avatar-overlay">
				<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
					<path
						d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
						stroke="currentColor"
						stroke-width="2"
						fill="none" />
					<circle
						cx="12"
						cy="13"
						r="4"
						stroke="currentColor"
						stroke-width="2"
						fill="none" />
				</svg>
			</div>
		</div>
	{:else if variant === 'compact'}
		<!-- Compact variant: button-style trigger -->
		<button
			type="button"
			class="compact-trigger"
			class:drag-over={is_drag_over}
			{disabled}
			aria-label={label || 'Choose files'}
			ondragenter={onDragEnter}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
			onclick={openFilePicker}>
			<svg
				class="upload-icon"
				viewBox="0 0 24 24"
				width="16"
				height="16"
				aria-hidden="true">
				<path
					d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					fill="none" />
			</svg>
			<span>Choose file{multiple ? 's' : ''}</span>
		</button>
	{:else}
		<!-- Dropzone variant: large dashed border area -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="dropzone"
			class:drag-over={is_drag_over}
			role="button"
			tabindex={disabled ? -1 : 0}
			aria-label={label || 'Drop files here or click to browse'}
			ondragenter={onDragEnter}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
			onclick={openFilePicker}
			onkeydown={onKeyDown}>
			<svg class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					fill="none" />
			</svg>
			<p class="dropzone-text">
				Drop files here or <span class="browse-link">browse</span>
			</p>
			{#if accept}
				<p class="dropzone-hint">{accept}</p>
			{/if}
		</div>
	{/if}

	<!-- File list (shown for dropzone and compact variants) -->
	{#if !avatar && files.length > 0}
		<div class="file-list" role="list" aria-label="Selected files">
			{#each files as file, index (file)}
				{#if fileItem}
					{@render fileItem({ file, index, remove: () => removeFile(index) })}
				{:else}
					<div class="file-item" role="listitem">
						{#if preview && isImage(file) && preview_urls.get(file)}
							<img class="file-preview" src={preview_urls.get(file)} alt={file.name} />
						{/if}
						<div class="file-info">
							<span class="file-name">{file.name}</span>
							<span class="file-size">{formatSize(file.size)}</span>
						</div>
						<button
							type="button"
							class="remove-button"
							aria-label="Remove {file.name}"
							onclick={() => removeFile(index)}>
							<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
								<path
									d="M18 6L6 18M6 6l12 12"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									fill="none" />
							</svg>
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	{#if error}
		<p class="error-message" id={error_id} role="alert">{error}</p>
	{/if}
</div>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.file-upload {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5em;
		font-size: 1em;
	}

	.file-upload.dense {
		gap: 0.25em;
	}
	.file-upload.comfortable {
		gap: 0.75em;
	}

	/* Sizes */
	.file-upload.size-0 {
		font-size: var(--font-size-0, 0.75rem);
	}
	.file-upload.size-1 {
		font-size: var(--font-size-1, 0.875rem);
	}
	.file-upload.size-2 {
		font-size: var(--font-size-2, 1rem);
	}

	/* Skeleton */
	.file-upload.skeleton {
		pointer-events: none;
	}
	.file-upload.skeleton .dropzone,
	.file-upload.skeleton .compact-trigger,
	.file-upload.skeleton .avatar-upload,
	.file-upload.skeleton .label {
		background: var(--c-bg-4, hsl(0 0% 90%));
		color: transparent;
		border-color: transparent;
		border-radius: var(--radius-2, 4px);
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}
	.file-upload.skeleton .dropzone *,
	.file-upload.skeleton .compact-trigger *,
	.file-upload.skeleton .avatar-upload * {
		visibility: hidden;
	}
	@keyframes skeleton-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* Label */
	.label {
		font-weight: 600;
		font-size: 0.875em;
		color: var(--c-text, inherit);
		line-height: 1.4;
	}

	/* Dropzone variant */
	.dropzone {
		border: 2px dashed var(--color-border, var(--c-outline, hsl(0 0% 80%)));
		border-radius: var(--radius-md, var(--radius-3, 8px));
		padding: 2rem;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 200ms,
			background 200ms;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5em;
		outline: none;
		-webkit-tap-highlight-color: transparent;
	}

	.dropzone:hover {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		transition: none;
	}

	.dropzone:focus-visible {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	.dropzone.drag-over {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		background: color-mix(
			in oklch,
			var(--color-action, var(--c-action, hsl(220 70% 55%))) 5%,
			transparent
		);
		transition: none;
	}

	.disabled .dropzone {
		opacity: 0.5;
		pointer-events: none;
	}

	.upload-icon {
		width: 2em;
		height: 2em;
		color: var(--c-text-2, hsl(0 0% 45%));
	}

	.dropzone-text {
		margin: 0;
		color: var(--c-text-2, hsl(0 0% 45%));
		font-size: 0.9em;
	}

	.browse-link {
		color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		text-decoration: underline;
		font-weight: 500;
	}

	.dropzone-hint {
		margin: 0;
		color: var(--c-text-3, hsl(0 0% 60%));
		font-size: 0.75em;
	}

	/* Compact variant */
	.compact-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		padding: 0.5em 1em;
		border: 1px solid var(--color-border, var(--c-outline, hsl(0 0% 80%)));
		border-radius: var(--radius-sm, var(--radius-2, 4px));
		background: var(--c-bg, white);
		color: var(--c-text, inherit);
		font-size: 0.875em;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 200ms,
			background 200ms;
		outline: none;
	}

	.compact-trigger:hover:not(:disabled) {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		transition: none;
	}

	.compact-trigger:focus-visible {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	.compact-trigger.drag-over {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		background: color-mix(
			in oklch,
			var(--color-action, var(--c-action, hsl(220 70% 55%))) 5%,
			transparent
		);
	}

	.compact-trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.compact-trigger .upload-icon {
		width: 1em;
		height: 1em;
	}

	/* Avatar variant */
	.avatar-upload {
		width: 6rem;
		height: 6rem;
		border-radius: 9999px;
		overflow: hidden;
		position: relative;
		cursor: pointer;
		border: 2px dashed var(--color-border, var(--c-outline, hsl(0 0% 80%)));
		background: light-dark(
			var(--color-bg-subtle, #f5f5f5),
			var(--color-bg-subtle, #1a1a1a)
		);
		transition: border-color 200ms;
		outline: none;
		-webkit-tap-highlight-color: transparent;
	}

	.avatar-upload:hover {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		transition: none;
	}

	.avatar-upload:focus-visible {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	.avatar-upload.drag-over {
		border-color: var(--color-action, var(--c-action, hsl(220 70% 55%)));
		transition: none;
	}

	.disabled .avatar-upload {
		opacity: 0.5;
		pointer-events: none;
	}

	.avatar-preview {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 0);
		color: white;
		transition: background 200ms;
		opacity: 0;
	}

	.avatar-upload:hover .avatar-overlay,
	.avatar-upload:focus-visible .avatar-overlay {
		background: rgb(0 0 0 / 0.4);
		opacity: 1;
	}

	/* File list */
	.file-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.file-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius-sm, var(--radius-2, 4px));
		background: light-dark(
			var(--color-bg-subtle, #f5f5f5),
			var(--color-bg-subtle, #1a1a1a)
		);
	}

	.file-preview {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-sm, var(--radius-2, 4px));
		object-fit: cover;
		flex-shrink: 0;
	}

	.file-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125em;
	}

	.file-name {
		font-size: 0.875em;
		color: var(--c-text, inherit);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-size {
		font-size: 0.75em;
		color: var(--c-text-2, hsl(0 0% 45%));
	}

	.remove-button {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: none;
		background: none;
		color: var(--c-text-2, hsl(0 0% 45%));
		cursor: pointer;
		border-radius: var(--radius-sm, var(--radius-2, 4px));
		transition:
			color 150ms,
			background 150ms;
		flex-shrink: 0;
	}

	.remove-button:hover {
		color: var(--c-error, hsl(0 70% 55%));
		background: color-mix(in oklch, var(--c-error, hsl(0 70% 55%)) 10%, transparent);
		transition: none;
	}

	.remove-button:focus-visible {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	/* Error state */
	.has-error .dropzone,
	.has-error .compact-trigger,
	.has-error .avatar-upload {
		border-color: var(--c-error, hsl(0 70% 55%));
	}

	.error-message {
		margin: 0;
		font-size: 0.8em;
		color: var(--c-error, hsl(0 70% 55%));
		line-height: 1.4;
	}
</style>
