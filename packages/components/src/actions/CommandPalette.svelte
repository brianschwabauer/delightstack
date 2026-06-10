<script lang="ts" module>
	import type { Component } from 'svelte';

	/** An option/command in the command palette */
	export interface CommandOption {
		/** Unique identifier for the command */
		id: string;

		/** Display title of the command */
		title: string;

		/** Optional description shown below the title */
		description?: string;

		/** Category for grouping commands */
		category?: string;

		/** Optional icon component */
		icon?: Component;

		/** Keyboard shortcut keys to display (e.g. ['Ctrl', 'K']) */
		shortcut?: string[];

		/** Additional search keywords */
		keywords?: string[];

		/** Whether the command is disabled */
		disabled?: boolean;

		/** Called when the command is selected */
		onselect: () => void | Promise<void>;
	}

	/** Module-level recent commands tracking */
	let recentCommandIds: string[] = $state([]);

	function trackRecent(id: string, limit: number) {
		recentCommandIds = [id, ...recentCommandIds.filter((r) => r !== id)].slice(0, limit);
	}

	/** Represents a segment of text with optional highlight */
	interface TextSegment {
		text: string;
		highlighted: boolean;
	}

	/** Represents a scored search result */
	interface ScoredCommand {
		command: CommandOption;
		score: number;
		title_segments: TextSegment[];
	}

	/** Check if characters of query appear in order within target (fuzzy) */
	function fuzzyMatch(
		query: string,
		target: string,
	): { matched: boolean; score: number; indices: number[] } {
		const lower_query = query.toLowerCase();
		const lower_target = target.toLowerCase();
		const indices: number[] = [];
		let qi = 0;
		for (let ti = 0; ti < lower_target.length && qi < lower_query.length; ti++) {
			if (lower_target[ti] === lower_query[qi]) {
				indices.push(ti);
				qi++;
			}
		}
		if (qi < lower_query.length) return { matched: false, score: 0, indices: [] };
		// Score based on how tight the match is
		const spread = indices.length > 1 ? indices[indices.length - 1] - indices[0] : 0;
		const score = Math.max(1, 10 - spread);
		return { matched: true, score, indices };
	}

	/** Score a single field against a single query word */
	function scoreField(word: string, field: string): { score: number; indices: number[] } {
		const lower_word = word.toLowerCase();
		const lower_field = field.toLowerCase();

		// Exact match
		if (lower_field === lower_word)
			return { score: 100, indices: Array.from({ length: field.length }, (_, i) => i) };

		// Starts with
		if (lower_field.startsWith(lower_word)) {
			return { score: 75, indices: Array.from({ length: word.length }, (_, i) => i) };
		}

		// Word boundary match (matches at the start of a word within the field)
		const word_boundary_regex = new RegExp(
			`(?:^|[\\s\\-_])${escapeRegex(lower_word)}`,
			'i',
		);
		const boundary_match = lower_field.match(word_boundary_regex);
		if (boundary_match) {
			const start =
				boundary_match.index! + (boundary_match[0].length - lower_word.length);
			return {
				score: 60,
				indices: Array.from({ length: word.length }, (_, i) => start + i),
			};
		}

		// Contains
		const idx = lower_field.indexOf(lower_word);
		if (idx !== -1) {
			return {
				score: 40,
				indices: Array.from({ length: word.length }, (_, i) => idx + i),
			};
		}

		// Fuzzy
		const fuzzy = fuzzyMatch(word, field);
		if (fuzzy.matched) return { score: fuzzy.score, indices: fuzzy.indices };

		return { score: 0, indices: [] };
	}

	function escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/** Build highlighted segments from title and matched character indices */
	function buildSegments(title: string, indices: Set<number>): TextSegment[] {
		if (indices.size === 0) return [{ text: title, highlighted: false }];
		const segments: TextSegment[] = [];
		let current_text = '';
		let current_highlighted = false;
		for (let i = 0; i < title.length; i++) {
			const is_hit = indices.has(i);
			if (is_hit !== current_highlighted && current_text) {
				segments.push({ text: current_text, highlighted: current_highlighted });
				current_text = '';
			}
			current_highlighted = is_hit;
			current_text += title[i];
		}
		if (current_text)
			segments.push({ text: current_text, highlighted: current_highlighted });
		return segments;
	}

	/** Search and score commands against the query */
	function searchCommands(commands: CommandOption[], query: string): ScoredCommand[] {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const words = trimmed.split(/\s+/).filter(Boolean);
		const results: ScoredCommand[] = [];

		for (const command of commands) {
			let total_score = 0;
			let all_words_matched = true;
			const title_indices = new Set<number>();

			for (const word of words) {
				let best_score = 0;

				// Score against title
				const title_result = scoreField(word, command.title);
				if (title_result.score > best_score) {
					best_score = title_result.score;
					for (const idx of title_result.indices) title_indices.add(idx);
				}

				// Score against description
				if (command.description) {
					const desc_result = scoreField(word, command.description);
					if (desc_result.score * 0.8 > best_score) {
						best_score = desc_result.score * 0.8;
					}
				}

				// Score against category
				if (command.category) {
					const cat_result = scoreField(word, command.category);
					if (cat_result.score * 0.6 > best_score) {
						best_score = cat_result.score * 0.6;
					}
				}

				// Score against keywords
				if (command.keywords) {
					for (const kw of command.keywords) {
						const kw_result = scoreField(word, kw);
						if (kw_result.score * 0.7 > best_score) {
							best_score = kw_result.score * 0.7;
						}
					}
				}

				if (best_score === 0) {
					all_words_matched = false;
					break;
				}
				total_score += best_score;
			}

			if (all_words_matched && total_score > 0) {
				results.push({
					command,
					score: total_score,
					title_segments: buildSegments(command.title, title_indices),
				});
			}
		}

		results.sort((a, b) => b.score - a.score);
		return results;
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { focusTrap, ripple } from '@delightstack/utilities';
	import { portal } from './Portal.svelte';

	const propId = $props.id();
	let {
		/** Controls visibility of the command palette */
		open = $bindable(false) as boolean,

		/** Available commands */
		commands = [] as CommandOption[],

		/** Input placeholder text */
		placeholder = 'Type a command or search...',

		/** Maximum number of recent commands to show */
		recent_limit = 5,

		/** How to group results */
		group_by = 'category' as 'category' | 'none',

		/** Compact spacing mode */
		dense = false,

		/** Called when any command is selected */
		onselect = undefined as ((command: CommandOption) => void) | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	} = $props();

	let query = $state('');
	let selected_index = $state(0);
	// Tracks whether the highlighted row comes from keyboard navigation. When
	// true the cursor row shows a persistent highlight; pointer movement turns
	// it off so the mouse hover (instant-in, fade-out) drives the highlight
	// instead — mirroring the List/ListItem interaction.
	let keyboard_nav = $state(true);
	let is_executing = $state(false);
	let input_el = $state<HTMLInputElement | undefined>(undefined);
	let listbox_el = $state<HTMLElement | undefined>(undefined);

	const listbox_id = `${id}-listbox`;

	// Compute search results
	const search_results = $derived(searchCommands(commands, query));

	// Compute recent commands (when query is empty)
	const recent_commands = $derived.by(() => {
		if (query.trim()) return [];
		return recentCommandIds
			.map((rid) => commands.find((c) => c.id === rid))
			.filter((c): c is CommandOption => c != null)
			.slice(0, recent_limit);
	});

	// The flat list of commands currently visible. When there's no query,
	// recent commands are pinned at the top of the full list (not used as
	// a replacement) so users can still browse everything else.
	const visible_commands = $derived.by((): CommandOption[] => {
		if (query.trim()) return search_results.map((r) => r.command);
		if (recent_commands.length > 0) {
			const recent_ids = new Set(recent_commands.map((c) => c.id));
			const rest = commands.filter((c) => !recent_ids.has(c.id));
			return [...recent_commands, ...rest];
		}
		return commands;
	});

	// Segments map for highlighting
	const segments_map = $derived.by((): Map<string, TextSegment[]> => {
		const map = new Map<string, TextSegment[]>();
		for (const r of search_results) {
			map.set(r.command.id, r.title_segments);
		}
		return map;
	});

	// Grouped commands for display
	interface CommandGroup {
		label: string;
		commands: CommandOption[];
	}

	const grouped_commands = $derived.by((): CommandGroup[] => {
		const cmds = visible_commands;
		const has_recent = !query.trim() && recent_commands.length > 0;
		if (group_by === 'none') {
			if (has_recent) {
				const recent_ids = new Set(recent_commands.map((c) => c.id));
				const rest = cmds.filter((c) => !recent_ids.has(c.id));
				const groups: CommandGroup[] = [{ label: 'Recent', commands: recent_commands }];
				if (rest.length) groups.push({ label: '', commands: rest });
				return groups;
			}
			return [{ label: '', commands: cmds }];
		}
		const groups = new Map<string, CommandOption[]>();
		const order: string[] = [];
		// When recents exist, put them in their own pinned group at the top.
		if (has_recent) {
			order.push('__recent__');
			groups.set('__recent__', recent_commands);
		}
		const recent_ids = new Set(recent_commands.map((c) => c.id));
		for (const cmd of cmds) {
			if (has_recent && recent_ids.has(cmd.id)) continue;
			const key = cmd.category || '';
			if (!groups.has(key)) {
				groups.set(key, []);
				order.push(key);
			}
			groups.get(key)!.push(cmd);
		}
		return order.map((key) => ({
			label: key === '__recent__' ? 'Recent' : key,
			commands: groups.get(key)!,
		}));
	});

	// The active descendant ID
	const active_descendant_id = $derived(
		visible_commands[selected_index]
			? `${id}-option-${visible_commands[selected_index].id}`
			: undefined,
	);

	// Reset selection when results change
	$effect(() => {
		// Subscribe to visible_commands changes
		// oxlint-disable-next-line no-unused-expressions
		visible_commands;
		selected_index = 0;
	});

	// Focus input when opened
	$effect(() => {
		if (open) {
			query = '';
			selected_index = 0;
			keyboard_nav = true;
			is_executing = false;
			tick().then(() => input_el?.focus());
		}
	});

	// Global Ctrl/Cmd+K listener
	$effect(() => {
		function handleGlobalKeydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				open = !open;
			}
		}
		document.addEventListener('keydown', handleGlobalKeydown);
		return () => document.removeEventListener('keydown', handleGlobalKeydown);
	});

	function close() {
		open = false;
		query = '';
		selected_index = 0;
		is_executing = false;
	}

	function scrollSelectedIntoView() {
		tick().then(() => {
			if (!listbox_el) return;
			const active = listbox_el.querySelector(`[id="${active_descendant_id}"]`);
			if (active) active.scrollIntoView({ block: 'nearest' });
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		const count = visible_commands.length;
		if (!count) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				keyboard_nav = true;
				selected_index = (selected_index + 1) % count;
				scrollSelectedIntoView();
				break;
			case 'ArrowUp':
				e.preventDefault();
				keyboard_nav = true;
				selected_index = (selected_index - 1 + count) % count;
				scrollSelectedIntoView();
				break;
			case 'Enter':
				e.preventDefault();
				if (
					visible_commands[selected_index] &&
					!visible_commands[selected_index].disabled
				) {
					executeCommand(visible_commands[selected_index]);
				}
				break;
			case 'Escape':
				e.preventDefault();
				close();
				break;
		}
	}

	async function executeCommand(command: CommandOption, viaPointer = false) {
		if (is_executing || command.disabled) return;

		trackRecent(command.id, recent_limit);
		onselect?.(command);

		const result = command.onselect();
		if (result instanceof Promise) {
			is_executing = true;
			try {
				await result;
				close();
			} catch {
				is_executing = false;
			}
		} else if (viaPointer) {
			// Let the click ripple finish animating before the palette unmounts.
			setTimeout(close, 220);
		} else {
			close();
		}
	}

	function getSegments(command: CommandOption): TextSegment[] {
		return segments_map.get(command.id) || [{ text: command.title, highlighted: false }];
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		onclick={close}
		in:fade={{ duration: 150 }}
		out:fade={{ duration: 100 }}
		use:portal>
	</div>
	<div
		{id}
		class={['palette', class_name].filter(Boolean).join(' ')}
		class:dense
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
		in:scale={{ duration: 150, start: 0.95, opacity: 0 }}
		out:scale={{ duration: 100, start: 0.95, opacity: 0 }}
		{@attach focusTrap({
			escapeDeactivates: false,
			allowOutsideClick: true,
			returnFocusOnDeactivate: true,
			initialFocus: false,
		})}
		use:portal>
		<div class="input-wrapper">
			<!-- Search icon -->
			<svg
				class="search-icon"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round">
				<circle cx="11" cy="11" r="8" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
			<input
				bind:this={input_el}
				bind:value={query}
				type="text"
				{placeholder}
				role="combobox"
				autocomplete="off"
				aria-expanded={visible_commands.length > 0}
				aria-controls={listbox_id}
				aria-activedescendant={active_descendant_id}
				aria-autocomplete="list"
				onkeydown={handleKeydown} />
			{#if is_executing}
				<div class="spinner">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round">
						<path d="M12 2a10 10 0 0 1 10 10" />
					</svg>
				</div>
			{/if}
		</div>

		<div
			bind:this={listbox_el}
			id={listbox_id}
			role="listbox"
			aria-label="Commands"
			class="results">
			{#if visible_commands.length === 0}
				<div class="empty">No results found</div>
			{:else}
				{#each grouped_commands as group}
					{#if group.label}
						<div class="group-header" role="presentation">
							{group.label}
						</div>
					{/if}
					{#each group.commands as command, group_i (command.id)}
						{@const flat_index = visible_commands.indexOf(command)}
						{@const is_selected = flat_index === selected_index}
						{@const option_id = `${id}-option-${command.id}`}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={option_id}
							role="option"
							tabindex="-1"
							aria-selected={is_selected}
							aria-disabled={command.disabled || false}
							class="item"
							class:selected={is_selected && keyboard_nav}
							class:first-in-group={group_i === 0}
							class:last-in-group={group_i === group.commands.length - 1}
							class:disabled={command.disabled}
							onpointerenter={() => {
								keyboard_nav = false;
								selected_index = flat_index;
							}}
							onclick={() => {
								if (!command.disabled) executeCommand(command, true);
							}}
							{@attach ripple({ enabled: !command.disabled, zIndex: 1 })}>
							{#if command.icon}
								<span class="item-icon">
									<command.icon />
								</span>
							{/if}
							<div class="item-content">
								<span class="item-title">
									{#each getSegments(command) as segment}
										{#if segment.highlighted}
											<mark>{segment.text}</mark>
										{:else}
											{segment.text}
										{/if}
									{/each}
								</span>
								{#if command.description}
									<span class="item-description">{command.description}</span>
								{/if}
							</div>
							{#if command.shortcut && command.shortcut.length > 0}
								<div class="item-shortcut">
									{#each command.shortcut as key}
										<kbd>{key}</kbd>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: var(--layer-popover);
		backdrop-filter: blur(8px);

		&::after {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background-color: var(--color-text);
			opacity: 0.15;
		}
	}

	.palette {
		position: fixed;
		top: 20vh;
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--layer-popover);
		width: min(600px, 90vw);
		background-color: var(--color-bg);
		border-radius: var(--radius-2xl);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-2xl) * var(--squircle-ratio, 2));
		}
		box-shadow: var(--shadow-lg);
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.input-wrapper {
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		gap: 0.75rem;

		.dense & {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
		}
	}

	.search-icon {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text);
		font-size: 1rem;
		line-height: 1.5;
		padding: 0;

		&::placeholder {
			color: var(--color-text-muted);
		}

		.dense & {
			font-size: 0.875rem;
		}
	}

	.spinner {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		color: var(--color-text-muted);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.results {
		max-height: 400px;
		overflow-y: auto;
		padding: 0.5rem 0;

		.dense & {
			padding: 0.25rem 0;
		}
	}

	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.group-header {
		padding: 0.5rem 1rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);

		.dense & {
			padding: 0.375rem 0.75rem 0.125rem;
			font-size: 0.65rem;
		}
	}

	.item {
		position: relative;
		display: flex;
		align-items: center;
		padding: 0.6rem 0.85rem;
		margin: 0 0.5rem;
		gap: 0.75rem;
		cursor: pointer;
		/* Square by default; the corners are rounded per group (top item rounded
		 * on top, last item rounded on the bottom) so each category reads as a
		 * connected block — the same idea as List/ListItem. */
		border-radius: 0;
		overflow: hidden;
		transition: transform 200ms ease;

		/* Hover/selection highlight. The base overlay fades (300ms); on hover it
		 * appears instantly and fades away on leave — matching ListItem. The
		 * keyboard cursor (.selected) uses the gentle fade in both directions. */
		&::before {
			content: '';
			position: absolute;
			inset: 0;
			background-color: var(--color-text);
			border-radius: inherit;
			@supports (corner-shape: squircle) {
				corner-shape: inherit;
			}
			opacity: 0;
			transition: opacity 300ms ease;
			pointer-events: none;
		}
		&.selected::before {
			opacity: 0.06;
		}
		&:hover:not(.disabled)::before {
			opacity: 0.06;
			transition-duration: 0ms;
		}

		&.first-in-group {
			border-top-left-radius: var(--radius-xl, 8px);
			border-top-right-radius: var(--radius-xl, 8px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-top-left-radius: calc(var(--radius-xl, 8px) * var(--squircle-ratio, 2));
				border-top-right-radius: calc(var(--radius-xl, 8px) * var(--squircle-ratio, 2));
			}
		}
		&.last-in-group {
			border-bottom-left-radius: var(--radius-xl, 8px);
			border-bottom-right-radius: var(--radius-xl, 8px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-bottom-left-radius: calc(var(--radius-xl, 8px) * var(--squircle-ratio, 2));
				border-bottom-right-radius: calc(
					var(--radius-xl, 8px) * var(--squircle-ratio, 2)
				);
			}
		}

		/* Per-item perspective so the press recedes toward the item's own
		 * center rather than the list's center (container perspective would
		 * share one vanishing point across every row). */
		&:active:not(.disabled) {
			transform: perspective(100px)
				translate3d(0px, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}

		&.disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}

		.dense & {
			padding: 0.45rem 0.7rem;
			gap: 0.5rem;
		}
	}

	.item-icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-text-muted);

		:global(svg) {
			width: 100%;
			height: 100%;
		}
	}

	.item-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.item-title {
		font-size: 0.875rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;

		:global(mark) {
			background-color: light-dark(rgba(255, 200, 0, 0.35), rgba(255, 200, 0, 0.25));
			color: inherit;
			border-radius: 2px;
			padding: 0 1px;
		}
	}

	.item-description {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;

		.dense & {
			font-size: 0.7rem;
		}
	}

	.item-shortcut {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;

		kbd {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 1.5em;
			height: 1.5em;
			padding: 0 0.35em;
			font-family: inherit;
			font-size: 0.7rem;
			font-weight: 500;
			color: var(--color-text-muted);
			background-color: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
			border: 1px solid var(--color-border);
			border-radius: var(--radius-xl);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-xl) * var(--squircle-ratio, 2));
			}
			line-height: 1;
		}
	}
</style>
