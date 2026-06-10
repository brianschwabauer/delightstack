<script lang="ts" module>
	/** Structural mirror of Starlight's SidebarEntry (utils/routing/types.ts). */
	export interface SidebarBadge {
		variant: 'note' | 'danger' | 'success' | 'caution' | 'tip' | 'default';
		text: string;
		class?: string;
	}
	export type SidebarEntry =
		| {
				type: 'link';
				label: string;
				href: string;
				isCurrent: boolean;
				badge?: SidebarBadge;
				attrs?: Record<string, string | number | boolean | undefined>;
		  }
		| {
				type: 'group';
				label: string;
				entries: SidebarEntry[];
				collapsed: boolean;
				badge?: SidebarBadge;
		  };
</script>

<script lang="ts">
	import { Tree, type TreeNode } from '@delightstack/components/display';

	/**
	 * Starlight's docs sidebar rendered with the delightstack <Tree>.
	 *
	 * Starlight does full page loads (no client router), so the tree remounts on
	 * every navigation. Expanded groups and scroll position are persisted to
	 * sessionStorage (mirroring what Starlight's built-in sidebar does with its
	 * `sl-sidebar-state` key) and restored at hydration. Node ids are derived
	 * from hrefs / label paths so they're stable across pages.
	 */
	const STORAGE_KEY = 'ds-sidebar-state';
	const SCROLLER_ID = 'starlight__sidebar';

	interface NodeData {
		href?: string;
		isCurrent?: boolean;
		badge?: SidebarBadge;
		group?: boolean;
		collapsed?: boolean;
	}

	let { entries = [] as SidebarEntry[] } = $props();

	function toNodes(list: SidebarEntry[], path: string): TreeNode[] {
		return list.map((entry, i) => {
			if (entry.type === 'link') {
				return {
					id: entry.href || `${path}/${i}`,
					label: entry.label,
					selectable: false,
					data: {
						href: entry.href,
						isCurrent: entry.isCurrent,
						badge: entry.badge,
					} satisfies NodeData,
				};
			}
			const id = `${path}/${entry.label}`;
			return {
				id,
				label: entry.label,
				selectable: false,
				children: toNodes(entry.entries, id),
				data: {
					group: true,
					collapsed: entry.collapsed,
					badge: entry.badge,
				} satisfies NodeData,
			};
		});
	}

	const nodes = toNodes(entries, '');

	/** Walk the tree once for: current link id, its ancestor group ids,
	 * groups open by default (collapsed: false), and all group ids. */
	function analyze(list: TreeNode[], ancestors: string[]) {
		const result = {
			current: undefined as string | undefined,
			current_ancestors: [] as string[],
			default_open: [] as string[],
			group_ids: [] as string[],
		};
		const walk = (items: TreeNode[], trail: string[]) => {
			for (const node of items) {
				const data = node.data as NodeData;
				if (data.group) {
					result.group_ids.push(node.id);
					if (!data.collapsed) result.default_open.push(node.id);
					walk(node.children ?? [], [...trail, node.id]);
				} else if (data.isCurrent) {
					result.current = node.id;
					result.current_ancestors = trail;
				}
			}
		};
		walk(list, ancestors);
		return result;
	}

	const info = analyze(nodes, []);

	// Structure fingerprint — stored state from an older sidebar layout is discarded.
	const hash = info.group_ids.join('\n');

	interface StoredState {
		hash: string;
		expanded: string[];
		scroll: number;
	}

	function loadStored(): StoredState | undefined {
		try {
			const raw = sessionStorage.getItem(STORAGE_KEY);
			if (!raw) return undefined;
			const parsed = JSON.parse(raw) as StoredState;
			return parsed.hash === hash ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	// Server render falls back to the config defaults + the current page's path;
	// at hydration the visitor's stored state wins (still force-opening the
	// groups that lead to the current page).
	let expanded = $state(
		Array.from(new Set([...info.default_open, ...info.current_ancestors])),
	);
	if (typeof sessionStorage !== 'undefined') {
		const stored = loadStored();
		if (stored) {
			expanded = Array.from(new Set([...stored.expanded, ...info.current_ancestors]));
		}
	}

	function save(scroll?: number) {
		try {
			const prev = loadStored();
			const state: StoredState = {
				hash,
				expanded: $state.snapshot(expanded),
				scroll: scroll ?? prev?.scroll ?? 0,
			};
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// sessionStorage unavailable — sidebar still works, just without persistence
		}
	}

	$effect(() => {
		const scroller = document.getElementById(SCROLLER_ID);

		// Restore scroll only on desktop (mobile opens the menu fresh) — same
		// guard Starlight's own persister uses.
		const stored = loadStored();
		if (scroller && stored?.scroll && window.matchMedia('(min-width: 50rem)').matches) {
			scroller.scrollTop = stored.scroll;
		}

		const persist = () => save(scroller?.scrollTop ?? 0);
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') persist();
		};
		addEventListener('pagehide', persist);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			removeEventListener('pagehide', persist);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

{#snippet nodeContent({ node, level }: { node: TreeNode; level: number })}
	{@const data = node.data as NodeData}
	{#if data.href !== undefined}
		<a
			class="sidebar-link"
			href={data.href}
			aria-current={data.isCurrent ? 'page' : undefined}>
			<span class="label">{node.label}</span>
			{#if data.badge}
				<span class="badge badge-{data.badge.variant} {data.badge.class ?? ''}">
					{data.badge.text}
				</span>
			{/if}
		</a>
	{:else}
		<span class="group-label" class:top-level={level === 1}>
			<span class="label">{node.label}</span>
			{#if data.badge}
				<span class="badge badge-{data.badge.variant} {data.badge.class ?? ''}">
					{data.badge.text}
				</span>
			{/if}
		</span>
	{/if}
{/snippet}

<div class="sidebar-tree">
	<Tree
		data={nodes}
		bind:expanded
		selected={info.current ? [info.current] : []}
		node_content={nodeContent}
		onexpand={() => save()}
		dense />
</div>

<style>
	.sidebar-tree {
		font-size: var(--sl-text-sm);
	}

	/* Rows are flex; let the link own all the remaining row width so the
	   whole row is clickable, not just the text. */
	.sidebar-link,
	.group-label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.5em;
		min-width: 0;
		padding-block: 0.1em;
	}

	.sidebar-link {
		color: var(--sl-color-gray-2);
		text-decoration: none;
	}
	.sidebar-link:hover {
		color: var(--sl-color-white);
	}
	.sidebar-link[aria-current='page'] {
		color: var(--sl-color-text-accent);
		font-weight: 600;
	}

	.group-label {
		font-weight: 600;
		color: var(--sl-color-white);
	}
	.group-label.top-level {
		font-size: var(--sl-text-base);
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		flex-shrink: 0;
		padding: 0.1em 0.5em;
		border-radius: 99em;
		font-size: 0.75em;
		font-weight: 600;
		line-height: 1.4;
		background: var(--color-bg-muted);
		color: var(--color-text);
	}
	.badge-success,
	.badge-tip {
		background: var(--color-success);
		color: var(--color-success-text);
	}
	.badge-danger,
	.badge-caution {
		background: var(--color-error);
		color: var(--color-error-text);
	}
	.badge-note {
		background: var(--color-info);
		color: white;
	}
</style>
