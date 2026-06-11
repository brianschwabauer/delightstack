<script lang="ts" module>
	export interface TreeNode {
		id: string;
		label: string;
		icon?: import('svelte').Component;
		children?: TreeNode[];
		disabled?: boolean;
		/** Whether this node can be selected. When undefined, inherits from the tree's selectable prop. Set to false to make clicking expand/collapse instead. */
		selectable?: boolean;
		/** Whether this node can accept children via drag-and-drop (defaults to true if node has children array) */
		allowChildren?: boolean;
		data?: unknown;
	}

	export interface FlatTreeNode {
		id: string;
		parentId: string | null;
		label: string;
		icon?: import('svelte').Component;
		disabled?: boolean;
		/** Whether this node can be selected. When undefined, inherits from the tree's selectable prop. */
		selectable?: boolean;
		data?: unknown;
	}
</script>

<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	const propId = $props.id();

	let {
		/** Tree data — nested TreeNode[] or flat FlatTreeNode[] */
		data,

		/** Selected node IDs, bindable */
		selected = $bindable([]) as string[],

		/** Expanded node IDs, bindable */
		expanded = $bindable([]) as string[],

		/** Enable node selection */
		selectable = false,

		/** Allow multiple selection */
		multi_select = false,

		/** Show checkboxes next to nodes */
		checkboxes = false,

		/** Show connecting lines between siblings */
		show_lines = false,

		/** Enable drag-and-drop reordering */
		draggable = false,

		/** Search/filter term */
		filter = undefined as string | undefined,

		/** Compact spacing */
		dense = false,

		/** Relaxed spacing */
		comfortable = false,

		/** Show loading skeleton */
		skeleton = false,

		/** Number of skeleton nodes */
		skeleton_count = 5,

		/** Skeleton nesting depth */
		skeleton_depth = 2,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: class_name = '',

		/** Lazy load children for a node */
		load_children = undefined as ((node: TreeNode) => Promise<TreeNode[]>) | undefined,

		/** Custom node content renderer */
		node_content = undefined as Snippet<[{ node: TreeNode; level: number }]> | undefined,

		/** Called when selection changes */
		onselect = undefined as
			| ((detail: { node: TreeNode; selected: string[] }) => void)
			| undefined,

		/** Called when a node is expanded/collapsed */
		onexpand = undefined as
			| ((detail: { node: TreeNode; expanded: boolean }) => void)
			| undefined,

		/** Called when a node is dropped onto a target */
		ondrop = undefined as
			| ((detail: {
					node: TreeNode;
					target: TreeNode;
					position: 'before' | 'after' | 'inside';
			  }) => void)
			| undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Detect flat vs nested data and build tree                         */
	/* ------------------------------------------------------------------ */

	function isFlat(d: TreeNode[] | FlatTreeNode[]): d is FlatTreeNode[] {
		return d.length > 0 && 'parentId' in d[0];
	}

	function buildTreeFromFlat(flat: FlatTreeNode[]): TreeNode[] {
		const map = new Map<string, TreeNode>();
		const roots: TreeNode[] = [];

		for (const item of flat) {
			map.set(item.id, {
				id: item.id,
				label: item.label,
				icon: item.icon,
				disabled: item.disabled,
				selectable: item.selectable,
				data: item.data,
				children: [],
			});
		}

		for (const item of flat) {
			const node = map.get(item.id)!;
			if (item.parentId === null) {
				roots.push(node);
			} else {
				const parent = map.get(item.parentId);
				if (parent) {
					parent.children!.push(node);
				}
			}
		}

		return roots;
	}

	const tree = $derived(isFlat(data) ? buildTreeFromFlat(data) : data);

	/* ------------------------------------------------------------------ */
	/*  Node ID lookup map                                                */
	/* ------------------------------------------------------------------ */

	function buildNodeMap(nodes: TreeNode[], map: Map<string, TreeNode>) {
		for (const node of nodes) {
			map.set(node.id, node);
			if (node.children) buildNodeMap(node.children, map);
		}
	}

	const node_map = $derived.by(() => {
		const m = new Map<string, TreeNode>();
		buildNodeMap(tree, m);
		return m;
	});

	/* ------------------------------------------------------------------ */
	/*  Parent map                                                        */
	/* ------------------------------------------------------------------ */

	function buildParentMap(
		nodes: TreeNode[],
		parent: TreeNode | null,
		map: Map<string, TreeNode | null>,
	) {
		for (const node of nodes) {
			map.set(node.id, parent);
			if (node.children) buildParentMap(node.children, node, map);
		}
	}

	const parent_map = $derived.by(() => {
		const m = new Map<string, TreeNode | null>();
		buildParentMap(tree, null, m);
		return m;
	});

	/* ------------------------------------------------------------------ */
	/*  Filtering                                                         */
	/* ------------------------------------------------------------------ */

	function nodeMatchesFilter(node: TreeNode, term: string): boolean {
		return node.label.toLowerCase().includes(term);
	}

	function subtreeMatchesFilter(node: TreeNode, term: string): boolean {
		if (nodeMatchesFilter(node, term)) return true;
		if (node.children) {
			return node.children.some((c) => subtreeMatchesFilter(c, term));
		}
		return false;
	}

	const filter_term = $derived(filter?.toLowerCase().trim() ?? '');
	const is_filtering = $derived(filter_term.length > 0);

	/** Set of IDs that pass the filter (node itself or a descendant matches) */
	const visible_ids = $derived.by(() => {
		if (!is_filtering) return null;
		const ids = new Set<string>();

		function collect(node: TreeNode): boolean {
			const matches = subtreeMatchesFilter(node, filter_term);
			if (matches) {
				ids.add(node.id);
				// Also include all ancestors
				let parent = parent_map.get(node.id) ?? null;
				while (parent) {
					ids.add(parent.id);
					parent = parent_map.get(parent.id) ?? null;
				}
				// Include matching children too
				if (node.children) {
					for (const c of node.children) collect(c);
				}
			}
			return matches;
		}

		for (const node of tree) collect(node);
		return ids;
	});

	/** IDs of nodes whose children should be force-expanded during filter */
	const filter_expanded_ids = $derived.by(() => {
		if (!is_filtering || !visible_ids) return new Set<string>();
		const ids = new Set<string>();
		function walk(node: TreeNode) {
			if (!visible_ids!.has(node.id)) return;
			if (node.children && node.children.some((c) => visible_ids!.has(c.id))) {
				ids.add(node.id);
			}
			if (node.children) {
				for (const c of node.children) walk(c);
			}
		}
		for (const n of tree) walk(n);
		return ids;
	});

	function isNodeVisible(node: TreeNode): boolean {
		if (!is_filtering || !visible_ids) return true;
		return visible_ids.has(node.id);
	}

	/* ------------------------------------------------------------------ */
	/*  Expand / Collapse                                                 */
	/* ------------------------------------------------------------------ */

	/** Cache of lazily loaded children keyed by node ID */
	let lazy_cache = $state(new Map<string, TreeNode[]>());
	let loading_ids = $state(new Set<string>());

	function isExpanded(node_id: string): boolean {
		if (is_filtering && filter_expanded_ids.has(node_id)) return true;
		return expanded.includes(node_id);
	}

	function hasChildren(node: TreeNode): boolean {
		if (lazy_cache.has(node.id)) return true;
		return !!node.children && node.children.length > 0;
	}

	function hasLoadableChildren(node: TreeNode): boolean {
		return !!load_children && !node.children?.length && !lazy_cache.has(node.id);
	}

	function getVisibleChildren(node: TreeNode): TreeNode[] {
		const cached = lazy_cache.get(node.id);
		const children = cached ?? node.children ?? [];
		if (!is_filtering) return children;
		return children.filter((c) => isNodeVisible(c));
	}

	async function toggleExpand(node: TreeNode) {
		if (node.disabled) return;
		const was_expanded = isExpanded(node.id);

		if (!was_expanded && hasLoadableChildren(node)) {
			loading_ids.add(node.id);
			loading_ids = new Set(loading_ids);
			try {
				const children = await load_children!(node);
				lazy_cache.set(node.id, children);
				lazy_cache = new Map(lazy_cache);
			} finally {
				loading_ids.delete(node.id);
				loading_ids = new Set(loading_ids);
			}
		}

		if (was_expanded) {
			expanded = expanded.filter((id) => id !== node.id);
		} else {
			expanded = [...expanded, node.id];
		}

		onexpand?.({ node, expanded: !was_expanded });
	}

	/* ------------------------------------------------------------------ */
	/*  Selection                                                         */
	/* ------------------------------------------------------------------ */

	function getAllDescendantIds(node: TreeNode): string[] {
		const ids: string[] = [];
		if (node.children) {
			for (const c of node.children) {
				if (!c.disabled) {
					ids.push(c.id);
					ids.push(...getAllDescendantIds(c));
				}
			}
		}
		const cached = lazy_cache.get(node.id);
		if (cached) {
			for (const c of cached) {
				if (!c.disabled) {
					ids.push(c.id);
					ids.push(...getAllDescendantIds(c));
				}
			}
		}
		return ids;
	}

	function getCheckState(node: TreeNode): 'checked' | 'unchecked' | 'indeterminate' {
		const descendant_ids = getAllDescendantIds(node);
		if (descendant_ids.length === 0) {
			return selected.includes(node.id) ? 'checked' : 'unchecked';
		}
		const self_checked = selected.includes(node.id);
		const all_checked =
			descendant_ids.every((id) => selected.includes(id)) && self_checked;
		const some_checked =
			descendant_ids.some((id) => selected.includes(id)) || self_checked;
		if (all_checked) return 'checked';
		if (some_checked) return 'indeterminate';
		return 'unchecked';
	}

	function isNodeSelectable(node: TreeNode): boolean {
		if (node.selectable !== undefined) return node.selectable;
		return selectable;
	}

	function selectNode(node: TreeNode, e?: MouseEvent | KeyboardEvent) {
		if (!isNodeSelectable(node) || node.disabled) return;

		if (checkboxes) {
			const state = getCheckState(node);
			const descendant_ids = getAllDescendantIds(node);
			const all_ids = [node.id, ...descendant_ids];

			if (state === 'checked') {
				// Uncheck this node and all descendants
				selected = selected.filter((id) => !all_ids.includes(id));
			} else {
				// Check this node and all descendants
				const new_selected = new Set(selected);
				for (const id of all_ids) new_selected.add(id);
				selected = [...new_selected];
			}

			// Walk up: sync parent check states
			syncParentCheckState(node);

			onselect?.({ node, selected });
			return;
		}

		if (multi_select && e && (e.ctrlKey || e.metaKey)) {
			if (selected.includes(node.id)) {
				selected = selected.filter((id) => id !== node.id);
			} else {
				selected = [...selected, node.id];
			}
		} else if (multi_select && e && e.shiftKey) {
			// Range select based on visible order
			const visible = getVisibleNodeOrder();
			const last_selected = selected.length > 0 ? selected[selected.length - 1] : null;
			if (last_selected) {
				const from_idx = visible.indexOf(last_selected);
				const to_idx = visible.indexOf(node.id);
				if (from_idx !== -1 && to_idx !== -1) {
					const start = Math.min(from_idx, to_idx);
					const end = Math.max(from_idx, to_idx);
					const range = visible.slice(start, end + 1);
					const new_selected = new Set(selected);
					for (const id of range) new_selected.add(id);
					selected = [...new_selected];
				} else {
					selected = [node.id];
				}
			} else {
				selected = [node.id];
			}
		} else {
			selected = [node.id];
		}

		onselect?.({ node, selected });
	}

	function syncParentCheckState(node: TreeNode) {
		let parent = parent_map.get(node.id) ?? null;
		while (parent) {
			if (parent.disabled) break;
			const descendant_ids = getAllDescendantIds(parent);
			const all_descendants_checked = descendant_ids.every((id) => selected.includes(id));

			if (all_descendants_checked && !selected.includes(parent.id)) {
				selected = [...selected, parent.id];
			} else if (!all_descendants_checked && selected.includes(parent.id)) {
				selected = selected.filter((id) => id !== parent!.id);
			}

			parent = parent_map.get(parent.id) ?? null;
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Visible node ordering (for keyboard navigation & shift-select)    */
	/* ------------------------------------------------------------------ */

	function getVisibleNodeOrder(): string[] {
		const order: string[] = [];
		function walk(nodes: TreeNode[]) {
			for (const node of nodes) {
				if (!isNodeVisible(node)) continue;
				order.push(node.id);
				if (isExpanded(node.id)) {
					const children = getVisibleChildren(node);
					walk(children);
				}
			}
		}
		walk(tree);
		return order;
	}

	/* ------------------------------------------------------------------ */
	/*  Adjacent-highlighted corner flattening                            */
	/* ------------------------------------------------------------------ */

	let hovered_id = $state<string | null>(null);

	/** Selected + hovered nodes — any two adjacent highlighted nodes flatten their touching corners */
	const highlighted_set = $derived.by(() => {
		const s = new Set(selected);
		if (hovered_id) s.add(hovered_id);
		return s;
	});

	const adj_top = $derived.by(() => {
		const s = new Set<string>();
		const order = getVisibleNodeOrder();
		for (let i = 1; i < order.length; i++) {
			if (highlighted_set.has(order[i]) && highlighted_set.has(order[i - 1])) {
				s.add(order[i]);
			}
		}
		return s;
	});

	const adj_bottom = $derived.by(() => {
		const s = new Set<string>();
		const order = getVisibleNodeOrder();
		for (let i = 0; i < order.length - 1; i++) {
			if (highlighted_set.has(order[i]) && highlighted_set.has(order[i + 1])) {
				s.add(order[i]);
			}
		}
		return s;
	});

	/* ------------------------------------------------------------------ */
	/*  Focus management                                                  */
	/* ------------------------------------------------------------------ */

	let focused_id = $state<string | null>(null);
	let keyboard_nav = $state(false);
	let tree_element: HTMLElement | undefined = $state(undefined);

	function focusNode(node_id: string) {
		focused_id = node_id;
		// Scroll the focused element into view
		if (tree_element) {
			const el = tree_element.querySelector(`[data-node-id="${node_id}"]`) as HTMLElement;
			el?.scrollIntoView({ block: 'nearest' });
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Keyboard navigation                                               */
	/* ------------------------------------------------------------------ */

	function handleTreeKeyDown(e: KeyboardEvent) {
		keyboard_nav = true;
		const visible = getVisibleNodeOrder();
		if (visible.length === 0) return;

		const current_idx = focused_id ? visible.indexOf(focused_id) : -1;
		const current_node = focused_id ? node_map.get(focused_id) : null;

		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				const next = current_idx + 1;
				if (next < visible.length) {
					focusNode(visible[next]);
				}
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				const prev = current_idx - 1;
				if (prev >= 0) {
					focusNode(visible[prev]);
				}
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				if (!current_node) break;
				if (
					(hasChildren(current_node) || hasLoadableChildren(current_node)) &&
					!isExpanded(current_node.id)
				) {
					toggleExpand(current_node);
				} else if (isExpanded(current_node.id)) {
					const children = getVisibleChildren(current_node);
					if (children.length > 0) {
						focusNode(children[0].id);
					}
				}
				break;
			}
			case 'ArrowLeft': {
				e.preventDefault();
				if (!current_node) break;
				if (isExpanded(current_node.id)) {
					toggleExpand(current_node);
				} else {
					const parent = parent_map.get(current_node.id);
					if (parent) {
						focusNode(parent.id);
					}
				}
				break;
			}
			case 'Enter':
			case ' ': {
				e.preventDefault();
				if (current_node) {
					if (isNodeSelectable(current_node)) {
						selectNode(current_node, e);
					} else if (hasChildren(current_node) || hasLoadableChildren(current_node)) {
						toggleExpand(current_node);
					}
				}
				break;
			}
			case 'Home': {
				e.preventDefault();
				if (visible.length > 0) {
					focusNode(visible[0]);
				}
				break;
			}
			case 'End': {
				e.preventDefault();
				if (visible.length > 0) {
					focusNode(visible[visible.length - 1]);
				}
				break;
			}
			case '*': {
				e.preventDefault();
				// Expand all siblings of current node
				if (current_node) {
					const parent = parent_map.get(current_node.id);
					const siblings = parent ? getVisibleChildren(parent) : tree;
					const ids_to_expand = siblings
						.filter(
							(s: TreeNode) =>
								(hasChildren(s) || hasLoadableChildren(s)) && !isExpanded(s.id),
						)
						.map((s: TreeNode) => s.id);
					if (ids_to_expand.length > 0) {
						expanded = [...expanded, ...ids_to_expand];
					}
				}
				break;
			}
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Drag-and-drop                                                     */
	/* ------------------------------------------------------------------ */

	let drag_node_id = $state<string | null>(null);
	let drop_target_id = $state<string | null>(null);
	let drop_position = $state<'before' | 'after' | 'inside'>('inside');

	function handleDragStart(e: DragEvent, node: TreeNode) {
		if (!draggable || node.disabled) {
			e.preventDefault();
			return;
		}
		e.stopPropagation();
		drag_node_id = node.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', node.id);
		}
	}

	function handleDragOver(e: DragEvent, node: TreeNode) {
		if (!draggable || !drag_node_id || drag_node_id === node.id) return;

		// Prevent dropping onto a descendant
		if (isDescendant(drag_node_id, node.id)) return;

		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		drop_target_id = node.id;

		// Determine drop position based on mouse position within the element
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const y = e.clientY - rect.top;
		const height = rect.height;
		const threshold = height / 4;

		const can_have_children =
			node.allowChildren !== undefined ? node.allowChildren : !!node.children;

		if (y < threshold) {
			drop_position = 'before';
		} else if (y > height - threshold) {
			drop_position = 'after';
		} else if (can_have_children) {
			drop_position = 'inside';
		} else {
			// Can't drop inside a leaf — snap to nearest edge
			drop_position = y < height / 2 ? 'before' : 'after';
		}
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear if we're leaving the node element, not entering a child
		const related = e.relatedTarget as HTMLElement | null;
		const current = e.currentTarget as HTMLElement;
		if (related && current.contains(related)) return;
		if (drop_target_id) {
			const leaving_node = (e.currentTarget as HTMLElement).dataset.nodeId;
			if (leaving_node === drop_target_id) {
				drop_target_id = null;
			}
		}
	}

	function handleDrop(e: DragEvent, node: TreeNode) {
		e.preventDefault();
		if (!draggable || !drag_node_id || drag_node_id === node.id) return;
		if (isDescendant(drag_node_id, node.id)) return;

		const drag_node = node_map.get(drag_node_id);
		if (drag_node) {
			ondrop?.({
				node: drag_node,
				target: node,
				position: drop_position,
			});
		}

		drag_node_id = null;
		drop_target_id = null;
	}

	function handleDragEnd() {
		drag_node_id = null;
		drop_target_id = null;
	}

	function isDescendant(ancestor_id: string, node_id: string): boolean {
		const ancestor = node_map.get(ancestor_id);
		if (!ancestor) return false;
		const descendants = getAllDescendantIds(ancestor);
		return descendants.includes(node_id);
	}

	/* ------------------------------------------------------------------ */
	/*  Filter text highlighting                                          */
	/* ------------------------------------------------------------------ */

	function highlightMatch(
		label: string,
		term: string,
	): { text: string; bold: boolean }[] {
		if (!term) return [{ text: label, bold: false }];
		const lower = label.toLowerCase();
		const idx = lower.indexOf(term);
		if (idx === -1) return [{ text: label, bold: false }];
		const parts: { text: string; bold: boolean }[] = [];
		if (idx > 0) parts.push({ text: label.slice(0, idx), bold: false });
		parts.push({ text: label.slice(idx, idx + term.length), bold: true });
		if (idx + term.length < label.length) {
			parts.push({ text: label.slice(idx + term.length), bold: false });
		}
		return parts;
	}

	/* ------------------------------------------------------------------ */
	/*  Context for potential sub-components                              */
	/* ------------------------------------------------------------------ */

	setContext('tree', {
		get selectable() {
			return selectable;
		},
		get checkboxes() {
			return checkboxes;
		},
		get dense() {
			return dense;
		},
		get comfortable() {
			return comfortable;
		},
	});

	/* ------------------------------------------------------------------ */
	/*  Skeleton helpers                                                  */
	/* ------------------------------------------------------------------ */

	function generateSkeletonNodes(
		count: number,
		depth: number,
	): { level: number; width: number }[] {
		const nodes: { level: number; width: number }[] = [];
		let current_level = 0;

		for (let i = 0; i < count; i++) {
			// Pseudo-random width between 40% and 80%
			const width = 40 + ((i * 37 + 13) % 41);
			nodes.push({ level: current_level, width });

			// Vary the nesting level
			if (i < count - 1) {
				if (current_level < depth - 1 && i % 3 !== 2) {
					current_level = Math.min(current_level + 1, depth - 1);
				} else if (current_level > 0) {
					current_level = Math.max(current_level - 1, 0);
				}
			}
		}
		return nodes;
	}

	const skeleton_nodes = $derived(generateSkeletonNodes(skeleton_count, skeleton_depth));
</script>

{#if skeleton}
	<!-- Skeleton loading state -->
	<div
		class={['tree skeleton', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		{id}
		aria-hidden="true">
		{#each skeleton_nodes as skel, i}
			<div
				class="skeleton-node"
				style:padding-left="calc({skel.level} * var(--_indent))"
				style:--shimmer-delay="{i * 120}ms">
				<div class="skeleton-chevron"></div>
				<div class="skeleton-bar" style:width="{skel.width}%"></div>
			</div>
		{/each}
	</div>
{:else}
	<!-- Tree -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<ul
		class={['tree', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:show-lines={show_lines}
		class:dragging={drag_node_id !== null}
		{id}
		role="tree"
		aria-activedescendant={focused_id ? `${id}-node-${focused_id}` : undefined}
		aria-multiselectable={multi_select || undefined}
		tabindex="0"
		bind:this={tree_element}
		onkeydown={handleTreeKeyDown}
		onfocusin={() => {
			if (!focused_id) {
				const visible = getVisibleNodeOrder();
				if (visible.length > 0) focused_id = visible[0];
			}
		}}
		onfocusout={(e) => {
			if (!tree_element?.contains(e.relatedTarget as Node)) {
				focused_id = null;
			}
		}}>
		{#each tree as node, root_index (node.id)}
			{@render treeNode(node, 1, root_index)}
		{/each}
	</ul>
{/if}

{#snippet treeNode(node: TreeNode, level: number, index: number)}
	{#if isNodeVisible(node)}
		{@const node_expanded = isExpanded(node.id)}
		{@const children = getVisibleChildren(node)}
		{@const has_kids = hasChildren(node) || hasLoadableChildren(node)}
		{@const is_loading = loading_ids.has(node.id)}
		{@const is_selected = selected.includes(node.id)}
		{@const is_focused = focused_id === node.id}
		{@const check_state = checkboxes ? getCheckState(node) : null}
		{@const is_drag_target = drop_target_id === node.id}
		<li
			role="treeitem"
			aria-expanded={has_kids ? node_expanded : undefined}
			aria-selected={selectable ? is_selected : undefined}
			aria-level={level}
			aria-disabled={node.disabled || undefined}
			id="{id}-node-{node.id}"
			data-node-id={node.id}
			class="tree-node"
			class:expanded={node_expanded}
			class:selected={is_selected}
			class:focused={is_focused && keyboard_nav}
			class:disabled={node.disabled}
			class:dragged={drag_node_id === node.id}
			class:drop-before={is_drag_target && drop_position === 'before'}
			class:drop-after={is_drag_target && drop_position === 'after'}
			class:drop-inside={is_drag_target && drop_position === 'inside'}
			style:--i={index}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="node-row"
				class:adj-top={adj_top.has(node.id)}
				class:adj-bottom={adj_bottom.has(node.id)}
				style:padding-left="calc({level - 1} * var(--_indent))"
				onmouseenter={() => (hovered_id = node.id)}
				onmouseleave={() => {
					if (hovered_id === node.id) hovered_id = null;
				}}
				draggable={draggable && !node.disabled ? 'true' : undefined}
				ondragstart={(e) => handleDragStart(e, node)}
				ondragover={(e) => {
					e.stopPropagation();
					handleDragOver(e, node);
				}}
				ondragleave={handleDragLeave}
				ondrop={(e) => {
					e.stopPropagation();
					handleDrop(e, node);
				}}
				ondragend={handleDragEnd}
				onpointerdown={() => {
					keyboard_nav = false;
				}}
				onclick={(e) => {
					if (isNodeSelectable(node)) {
						selectNode(node, e);
					} else if (has_kids || hasLoadableChildren(node)) {
						toggleExpand(node);
					}
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						if (isNodeSelectable(node)) selectNode(node, e);
						else if (has_kids) toggleExpand(node);
					}
				}}
				onfocusin={() => focusNode(node.id)}>
				<!-- Chevron / Expand toggle -->
				<button
					class="chevron-btn"
					class:has-children={has_kids || hasLoadableChildren(node)}
					tabindex={-1}
					type="button"
					aria-hidden="true"
					onclick={(e) => {
						e.stopPropagation();
						if (has_kids || hasLoadableChildren(node)) toggleExpand(node);
					}}>
					{#if is_loading}
						<svg class="spinner" width="16" height="16" viewBox="0 0 16 16" fill="none">
							<circle
								cx="8"
								cy="8"
								r="6"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-dasharray="28"
								stroke-dashoffset="8"
								stroke-linecap="round" />
						</svg>
					{:else if has_kids || hasLoadableChildren(node)}
						<svg
							class="chevron-icon"
							class:rotated={node_expanded}
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none">
							<path
								d="M6 3L11 8L6 13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						</svg>
					{/if}
				</button>

				<!-- Checkbox -->
				{#if checkboxes}
					<button
						class="tree-checkbox"
						tabindex={-1}
						type="button"
						aria-hidden="true"
						onclick={(e) => {
							e.stopPropagation();
							selectNode(node);
						}}>
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none">
							<rect
								class="check-box"
								class:checked={check_state === 'checked'}
								class:indeterminate={check_state === 'indeterminate'}
								x="2"
								y="2"
								width="20"
								height="20"
								rx="3"
								stroke-width="2" />
							{#if check_state === 'indeterminate'}
								<line
									class="check-dash"
									x1="7"
									y1="12"
									x2="17"
									y2="12"
									stroke-width="2.5"
									stroke-linecap="round" />
							{:else if check_state === 'checked'}
								<path
									class="check-mark"
									d="M6 12.5 L10 16.5 L18 8"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round" />
							{/if}
						</svg>
					</button>
				{/if}

				<!-- Node content -->
				{#if node_content}
					{@render node_content({ node, level })}
				{:else}
					<span class="node-content">
						{#if node.icon}
							<span class="node-icon">
								<node.icon />
							</span>
						{/if}
						<span class="node-label">
							{#if is_filtering}
								{#each highlightMatch(node.label, filter_term) as part}
									{#if part.bold}<mark>{part.text}</mark>{:else}{part.text}{/if}
								{/each}
							{:else}
								{node.label}
							{/if}
						</span>
					</span>
				{/if}
			</div>

			<!-- Children container with grid expand animation -->
			{#if has_kids && children.length > 0}
				<div class="children-container" class:show={node_expanded}>
					<ul role="group" style:--line-offset="calc({level - 1} * var(--_indent))">
						{#each children as child, child_index (child.id)}
							{@render treeNode(child, level + 1, child_index)}
						{/each}
					</ul>
				</div>
			{/if}
		</li>
	{/if}
{/snippet}

<style>
	/* Registered so the active-path tint can ease out as an interpolated
	   color (unsupported browsers degrade to a discrete switch) */
	@property --_tree-rail {
		syntax: '<color>';
		inherits: true;
		initial-value: transparent;
	}

	/* ========== Tree Container ========== */
	.tree {
		/* Per-level indentation step — override with --tree-indent */
		--_indent: var(--tree-indent, 0.75rem);
		width: 100%;
		list-style: none;
		margin: 0;
		padding: 0;
		outline: none;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		font-size: 0.875rem;
		-webkit-user-select: none;
		user-select: none;

		&:focus-visible {
			box-shadow: inset 0 0 0 2px var(--color-action, #1976d2);
			border-radius: 8px;
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(8px * var(--squircle-ratio, 2));
			}
		}
	}

	/* ========== Tree Node ========== */
	.tree-node {
		list-style: none;
		position: relative;
		perspective: 100px;
	}

	/* ========== Node Row ========== */
	.node-row {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.25rem 0.5rem 0.25rem 0;
		cursor: pointer;
		border-radius: 8px;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(8px * var(--squircle-ratio, 2));
		}
		position: relative;
		min-height: 1.75rem;
		transition:
			background-color 100ms ease,
			translate 200ms ease;
	}

	.node-row:hover {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.06),
			rgb(from var(--color-text, #fff) r g b / 0.08)
		);
		transition: translate 200ms ease;
	}

	.node-row:active {
		translate: 0px 4px clamp(-5px, calc(0.2em - 5px), -2px);
	}

	.tree-node.disabled > .node-row:active {
		translate: none;
	}

	.tree-node.selected > .node-row {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.1),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.15)
		);
	}

	/* Flatten touching corners between visually adjacent highlighted nodes */
	.tree-node.selected > .node-row.adj-bottom,
	.node-row:hover.adj-bottom {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.tree-node.selected > .node-row.adj-top,
	.node-row:hover.adj-top {
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.tree-node.selected > .node-row:hover {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.15),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.22)
		);
		transition: translate 200ms ease;
	}

	.tree-node.focused > .node-row {
		outline: 2px solid var(--color-action, #1976d2);
		outline-offset: -2px;
		border-radius: var(--radius-md, 4px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 4px) * var(--squircle-ratio, 2));
		}
	}

	.tree-node.disabled > .node-row {
		opacity: 0.5;
		pointer-events: none;
	}

	/* ========== Dense / Comfortable ========== */
	.tree.dense .node-row {
		padding-top: 0.0625rem;
		padding-bottom: 0.0625rem;
		min-height: 1.375rem;
		font-size: 0.8125rem;
	}

	.tree.comfortable .node-row {
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
		min-height: 2.25rem;
	}

	/* ========== Chevron Button ========== */
	.chevron-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
		padding: 0;
		margin: 0;
		border: none;
		background: none;
		cursor: pointer;
		color: light-dark(var(--color-text-muted, #888), var(--color-text-muted, #999));
		border-radius: var(--radius-md, 4px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 4px) * var(--squircle-ratio, 2));
		}

		&:not(.has-children) {
			visibility: hidden;
		}

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.08),
				rgb(from var(--color-text, #fff) r g b / 0.1)
			);
			transition: none;
		}
	}

	.chevron-icon {
		transition: transform 200ms ease;
	}

	.chevron-icon.rotated {
		transform: rotate(90deg);
	}

	/* ========== Spinner ==========
	 * Combines a non-linear rotation with a dasharray sweep to mimic the
	 * easing used by <Progress />. The rotation uses cubic-bezier for an
	 * organic pace; the stroke offset/length animation gives the typical
	 * "elastic chase" look found on Material-style indeterminate spinners. */
	.spinner {
		color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		animation: tree-spin 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	.spinner circle {
		transform-origin: center;
		animation: tree-spinner-dash 1.4s ease-in-out infinite;
	}

	@keyframes tree-spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
	@keyframes tree-spinner-dash {
		0% {
			stroke-dasharray: 1, 38;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 22, 38;
			stroke-dashoffset: -9;
		}
		100% {
			stroke-dasharray: 22, 38;
			stroke-dashoffset: -28;
		}
	}

	/* ========== Checkbox ========== */
	.tree-checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		margin: 0 0.125rem;
		border: none;
		background: none;
		cursor: pointer;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
	}

	.check-box {
		stroke: light-dark(var(--color-text-muted, #999), var(--color-text-muted, #777));
		fill: transparent;
		transition:
			stroke 150ms ease,
			fill 150ms ease;
	}

	.check-box.checked,
	.check-box.indeterminate {
		stroke: var(--color-action, #1976d2);
		fill: var(--color-action, #1976d2);
	}

	.check-mark {
		stroke: var(--color-bg, #fff);
		fill: none;
	}

	.check-dash {
		stroke: var(--color-bg, #fff);
	}

	/* ========== Node Content ========== */
	.node-content {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.node-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: light-dark(var(--color-text-muted, #666), var(--color-text-muted, #aaa));
	}

	.node-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.node-label mark {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.2),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.3)
		);
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
	}

	/* ========== Children Container (Expand Animation) ========== */
	.children-container {
		display: grid;
		grid-template-rows: min-content 0fr;
		transition:
			grid-template-rows 200ms ease,
			opacity 150ms;
		opacity: 0;

		&::before {
			content: '';
		}

		> :global(ul) {
			overflow: hidden;
			visibility: hidden;
			transition-behavior: allow-discrete;
			transition: visibility 0ms 200ms;
			list-style: none;
			margin: 0;
			padding: 0;
		}
	}

	.children-container.show {
		grid-template-rows: min-content 1fr;
		opacity: 1;

		> :global(ul) {
			visibility: visible;
			transition: visibility 0ms;
		}
	}

	/* ========== Connecting Lines ========== */
	/* Each group's rail color lives in --_tree-rail on its ul; the pseudo
	   elements below just borrow it via var(). Every ul sets its own value,
	   so a tinted group never leaks into nested groups. The transition here
	   governs the OUT fade of the active-path tint (the IN snaps, below). */
	.tree.show-lines .children-container > :global(ul) {
		position: relative;
		--_tree-rail: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.15),
			rgb(from var(--color-text, #fff) r g b / 0.2)
		);
		transition: --_tree-rail 200ms ease;
	}

	/*
	 * Guides are drawn per child: every node but the last carries a vertical
	 * segment spanning its full height (subtree included), and the last
	 * child carries an L running from its top to the vertical center of its
	 * own row before curving toward the label — so the foot stays centered
	 * on the text no matter how tall the row renders. clip-path reveals
	 * each segment top-to-bottom with a per-row stagger (--i) on expand.
	 */
	.tree.show-lines
		.tree-node
		> .children-container
		> :global(ul > .tree-node:not(:last-child))::before,
	.tree.show-lines
		.tree-node
		> .children-container
		> :global(ul > .tree-node:last-child > .node-row)::before {
		content: '';
		position: absolute;
		top: 0;
		left: calc(0.625rem + var(--line-offset, 0px));
		border-left: 1.5px solid var(--_tree-rail);
		pointer-events: none;
		clip-path: inset(0 0 100% 0);
		/* governs the retract on collapse */
		transition: clip-path 150ms ease;
	}

	.tree.show-lines
		.tree-node
		> .children-container
		> :global(ul > .tree-node:not(:last-child))::before {
		bottom: 0;
	}

	.tree.show-lines
		.tree-node
		> .children-container
		> :global(ul > .tree-node:last-child > .node-row)::before {
		height: 50%;
		width: 0.5rem;
		border-bottom: 1.5px solid var(--_tree-rail);
		border-bottom-left-radius: 0.375rem;
	}

	/* Soften where a multi-row rail emerges from its parent row */
	.tree.show-lines
		.tree-node
		> .children-container
		> :global(ul > .tree-node:first-child:not(:last-child))::before {
		mask-image: linear-gradient(to bottom, transparent, #000 0.5rem);
	}

	.tree.show-lines
		.tree-node
		> .children-container.show
		> :global(ul > .tree-node:not(:last-child))::before,
	.tree.show-lines
		.tree-node
		> .children-container.show
		> :global(ul > .tree-node:last-child > .node-row)::before {
		clip-path: inset(0 0 0 0);
		transition: clip-path 200ms ease-out calc(min(80ms + var(--i, 0) * 40ms, 400ms));
	}

	/* Active path: tint the rail of the group containing the hovered,
	   selected, or keyboard-focused row — snap in (transition: none here),
	   ease out (the --_tree-rail transition on the base ul rule above) */
	.tree.show-lines .children-container > :global(ul:has(> .tree-node > .node-row:hover)),
	.tree.show-lines .children-container > :global(ul:has(> .tree-node.selected)),
	.tree.show-lines .children-container > :global(ul:has(> .tree-node.focused)) {
		--_tree-rail: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.5),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.55)
		);
		transition: none;
	}

	/* ========== Drag-and-Drop Indicators ========== */
	.tree-node.dragged {
		opacity: 0.4;
	}

	/* Both drop indicators share ::after (they're mutually exclusive states)
	   because ::before holds the connecting-line L on last children */
	.tree-node.drop-before > .node-row::after,
	.tree-node.drop-after > .node-row::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-action, #1976d2);
		border-radius: 1px;
		z-index: 1;
	}

	/* Drawn fully inside the row — straddling the boundary (top: -1px) lets
	   group overflow clipping shave the bar to 1px on a group's edge rows */
	.tree-node.drop-before > .node-row::after {
		top: 0;
	}

	.tree-node.drop-after > .node-row::after {
		bottom: 0;
	}

	.tree-node.drop-inside > .node-row {
		outline: 2px solid var(--color-action, #1976d2);
		outline-offset: -2px;
		border-radius: 8px;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(8px * var(--squircle-ratio, 2));
		}
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.08),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.12)
		);
	}

	.tree.dragging {
		cursor: grabbing;
	}

	.tree.dragging .node-row {
		cursor: grabbing;
	}

	/* ========== Skeleton ========== */
	.tree.skeleton {
		pointer-events: none;
	}

	/* Mirrors .node-row metrics (incl. dense/comfortable) so each placeholder
	   row is exactly the height of the real row it stands in for. */
	.skeleton-node {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.25rem 0.5rem 0.25rem 0;
		min-height: 1.75rem;
	}

	.tree.dense .skeleton-node {
		padding-top: 0.0625rem;
		padding-bottom: 0.0625rem;
		min-height: 1.375rem;
		font-size: 0.8125rem;
	}

	.tree.comfortable .skeleton-node {
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
		min-height: 2.25rem;
	}

	.skeleton-chevron,
	.skeleton-bar {
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}

	/* The real chevron button occupies a 1.25rem slot; the visible placeholder
	   is the icon-sized square centered inside it. */
	.skeleton-chevron {
		width: 0.875rem;
		height: 0.875rem;
		margin: 0.1875rem;
		flex-shrink: 0;
		border-radius: var(--radius-sm, 2px);
	}

	.skeleton-bar {
		height: 0.7em;
		border-radius: var(--radius-full, 1e5px);
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-chevron::after,
		.skeleton-bar::after {
			animation: none;
		}
		.chevron-icon {
			transition: none;
		}
		.children-container {
			transition: none;
		}
		.spinner {
			animation: none;
		}
		.tree.show-lines
			.tree-node
			> .children-container
			> :global(ul > .tree-node:not(:last-child))::before,
		.tree.show-lines
			.tree-node
			> .children-container
			> :global(ul > .tree-node:last-child > .node-row)::before,
		.tree.show-lines
			.tree-node
			> .children-container.show
			> :global(ul > .tree-node:not(:last-child))::before,
		.tree.show-lines
			.tree-node
			> .children-container.show
			> :global(ul > .tree-node:last-child > .node-row)::before {
			clip-path: none;
			transition: none;
		}
	}
</style>
