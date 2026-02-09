# Tree

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Tree.svelte`

## Description

A full-featured hierarchical data display component for folder structures, category trees, or any nested data. Supports expand/collapse with animations, checkbox selection, drag-and-drop reordering via the `sortable` utility, lazy loading of children, virtual scrolling for large trees, search/filter, and full keyboard navigation. Accepts both nested object data and flat lists with parent IDs.

## Dependencies

- **Components**: `Expand` (for animated expand/collapse)
- **Utilities**: `@delightstack/utilities` -- `sortable` (attachment, for drag-and-drop reordering)
- **Libraries**: none

## Visual Design

### Node Structure
- Expand/collapse chevron (rotates on toggle)
- Optional icon (file, folder, custom)
- Label text
- Optional trailing actions or badges

### Indentation
- Clear visual hierarchy via nested indentation
- Optional connecting lines between parent and children
- Consistent indent step (20px per level)

### States
- **Collapsed**: Chevron pointing right, children hidden
- **Expanded**: Chevron rotated 90 degrees, children visible with Expand animation
- **Selected**: Highlighted background
- **Hover**: Subtle background highlight
- **Disabled**: Reduced opacity, non-interactive
- **Drop target**: Accent border/highlight when a node is dragged over it

## Props

### Tree Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TreeNode[] \| FlatTreeNode[]` | required | Tree data (nested or flat) |
| `selected` | `string[]` | `[]` | Selected node IDs, bindable |
| `expanded` | `string[]` | `[]` | Expanded node IDs, bindable |
| `selectable` | `boolean` | `false` | Enable node selection |
| `multiSelect` | `boolean` | `false` | Allow multiple selection |
| `checkboxes` | `boolean` | `false` | Show checkboxes for selection |
| `showLines` | `boolean` | `false` | Show connecting lines between nodes |
| `draggable` | `boolean` | `false` | Enable drag-and-drop reordering |
| `filter` | `string` | - | Search/filter term to highlight and filter matches |
| `virtualized` | `boolean` | `false` | Virtual scrolling for large trees |
| `dense` | `boolean` | `false` | Compact node spacing |
| `comfortable` | `boolean` | `false` | Relaxed node spacing |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `5` | Number of skeleton nodes |
| `skeletonDepth` | `number` | `2` | Nesting depth of skeleton nodes |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `loadChildren` | `(node: TreeNode) => Promise<TreeNode[]>` | - | Lazy load children on expand |
| `nodeContent` | `Snippet<[{ node: TreeNode; level: number }]>` | - | Custom node content renderer |

### TreeNode Interface (Nested)
```typescript
interface TreeNode {
  id: string;
  label: string;
  icon?: Component;
  children?: TreeNode[];
  disabled?: boolean;
  data?: any; // Custom payload
}
```

### FlatTreeNode Interface (Flat with parent IDs)
```typescript
interface FlatTreeNode {
  id: string;
  parentId: string | null;
  label: string;
  icon?: Component;
  disabled?: boolean;
  data?: any;
}
```

The component detects the data format automatically: if the first item has a `parentId` property, it treats the array as flat and builds the tree structure internally.

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ node: TreeNode, selected: string[] }` | Selection changed |
| `onexpand` | `{ node: TreeNode, expanded: boolean }` | Node expanded or collapsed |
| `ondrop` | `{ node: TreeNode, target: TreeNode, position: 'before' \| 'after' \| 'inside' }` | Node dropped after drag |
| `onfilter` | `{ matches: TreeNode[] }` | Filter results changed |

## Keyboard Navigation

| Key | Action |
|-----|--------|
| **Arrow Down** | Move focus to next visible node |
| **Arrow Up** | Move focus to previous visible node |
| **Arrow Right** | Expand focused node, or move to first child if already expanded |
| **Arrow Left** | Collapse focused node, or move to parent if already collapsed |
| **Enter / Space** | Select or toggle checkbox on focused node |
| **Home** | Move focus to first visible node |
| **End** | Move focus to last visible node |
| **\*** (asterisk) | Expand all siblings of the focused node |

## Selection

### Click Selection
- Click a node to select it
- Ctrl+Click (Cmd+Click on Mac) for multi-select
- Shift+Click for range selection (selects all visible nodes between last selected and clicked)

### Checkbox Selection
When `checkboxes` is true:
- Each node shows a checkbox
- Parent checkboxes reflect children state (checked, unchecked, indeterminate)
- Checking a parent checks all children
- Unchecking a parent unchecks all children
- Indeterminate state shown when some children are checked

## Drag-and-Drop

When `draggable` is true, the `sortable` attachment from `@delightstack/utilities` is used:
- Drag a node to reorder within siblings
- Drop on a node to make it a child
- Drop between nodes to reorder
- Visual indicators show valid drop positions (before, after, inside)
- Animated transitions as nodes move
- The `ondrop` event fires with the new position; the consumer updates the data

## Lazy Loading

```svelte
<Tree
  data={rootNodes}
  loadChildren={async (node) => {
    return await fetchChildren(node.id);
  }}
/>
```

- When a node is expanded and has no children loaded, `loadChildren` is called
- A loading spinner replaces the chevron while loading
- Loaded children are cached and not re-fetched on subsequent expansions
- Errors are handled gracefully (show error indicator, allow retry)

## Search/Filter

When `filter` is set:
- Nodes matching the filter term are highlighted (bold text or background)
- Non-matching nodes without matching descendants are hidden
- Parent nodes auto-expand to reveal matches
- Match count displayed (optional, via `onfilter` event)
- Clearing the filter restores the previous expand state

## Virtual Scrolling

When `virtualized` is true:
- Only visible nodes are rendered in the DOM
- Calculates total height based on visible (expanded) node count
- Handles expand/collapse by recalculating visible nodes
- Smooth scrolling with overscan
- Efficiently handles trees with tens of thousands of nodes

## Expand/Collapse Animation

Each node's children are wrapped in the Expand component for smooth height animation:
- Chevron rotates 90 degrees with CSS transition
- Children container animates height via CSS Grid `0fr` to `1fr`
- Staggered reveal for many children (subtle)

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder nodes:
- Shimmer bars for labels
- Circular placeholders for icons/chevrons
- Some nodes show indented children (up to `skeletonDepth` levels)
- Maintains tree layout appearance

## Accessibility

- `role="tree"` on the container, `role="treeitem"` on each node
- `aria-expanded` on expandable nodes
- `aria-selected` on selectable nodes
- `aria-level` indicating nesting depth
- Full keyboard navigation (arrow keys, Home, End, Enter, Space)
- Focus management with `aria-activedescendant`

## CSS Approach

```css
.tree {
  padding: 0;
  margin: 0;
  list-style: none;
}

.tree-node {
  position: relative;
}

.tree-node .node-content {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-2);
  cursor: pointer;
  user-select: none;
}

.tree-node .node-content:hover {
  background: color-mix(in oklch, var(--color-text), transparent 96%);
}

.tree-node .node-content.selected {
  background: color-mix(in oklch, var(--color-action), transparent 90%);
}

.tree-node .node-content:focus-visible {
  outline: 2px solid var(--color-action);
  outline-offset: -2px;
}

.tree-node .chevron {
  width: 1rem;
  height: 1rem;
  transition: transform 200ms ease;
  flex-shrink: 0;
}

.tree-node .chevron.expanded {
  transform: rotate(90deg);
}

.tree-node .children {
  padding-left: 1.25rem;
}

.tree-node .connecting-line {
  position: absolute;
  left: 0.5rem;
  top: 1.75rem;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
}

.tree-node .checkbox {
  flex-shrink: 0;
}

.tree-node .drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-action);
}
```

## Code Example

```svelte
<script>
  import { Tree } from '@delightstack/components';
  import FolderIcon from '~icons/mdi/folder';
  import FileIcon from '~icons/mdi/file';

  const fileTree = [
    {
      id: '1',
      label: 'src',
      icon: FolderIcon,
      children: [
        {
          id: '1-1',
          label: 'components',
          icon: FolderIcon,
          children: [
            { id: '1-1-1', label: 'Button.svelte', icon: FileIcon },
            { id: '1-1-2', label: 'Modal.svelte', icon: FileIcon }
          ]
        },
        { id: '1-2', label: 'app.ts', icon: FileIcon }
      ]
    },
    { id: '2', label: 'package.json', icon: FileIcon }
  ];

  let selected = $state<string[]>([]);
  let expanded = $state<string[]>(['1']);
  let searchTerm = $state('');
</script>

<!-- Basic tree -->
<Tree
  data={fileTree}
  selectable
  bind:selected
  bind:expanded
  onselect={({ node }) => openFile(node)}
/>

<!-- With checkboxes -->
<Tree data={categories} checkboxes bind:selected multiSelect />

<!-- With search/filter -->
<input bind:value={searchTerm} placeholder="Search..." />
<Tree data={fileTree} filter={searchTerm} />

<!-- Draggable -->
<Tree
  data={fileTree}
  draggable
  ondrop={({ node, target, position }) => updateTree(node, target, position)}
/>

<!-- Flat data with parent IDs -->
<Tree
  data={[
    { id: '1', parentId: null, label: 'Root' },
    { id: '2', parentId: '1', label: 'Child 1' },
    { id: '3', parentId: '1', label: 'Child 2' },
    { id: '4', parentId: '2', label: 'Grandchild' },
  ]}
  selectable
/>

<!-- Lazy loading -->
<Tree
  data={rootNodes}
  loadChildren={async (node) => await fetchChildren(node.id)}
/>

<!-- Virtual scrolling for large tree -->
<Tree data={largeTree} virtualized />

<!-- Skeleton loading -->
<Tree skeleton skeletonCount={6} skeletonDepth={2} />

<!-- With connecting lines -->
<Tree data={fileTree} showLines bind:expanded />

<!-- Custom node content -->
{#snippet customNode({ node, level })}
  <span>{node.label}</span>
  {#if node.data?.badge}
    <Badge>{node.data.badge}</Badge>
  {/if}
{/snippet}

<Tree data={fileTree} nodeContent={customNode} />
```

## Implementation Notes

- Recursive component structure (TreeNode renders itself for children)
- Use `setContext`/`getContext` for shared tree state (selection, expansion, drag state)
- Expand animation via the Expand component wrapping each node's children
- Drag-and-drop via `sortable` attachment from `@delightstack/utilities`
- Flat data conversion: build a Map of `id -> node` and reconstruct the tree on initialization
- Virtual scrolling: flatten the visible (expanded) tree into a list and render only visible items
- Search/filter: recursively check nodes and their descendants for matches
- Checkbox indeterminate: compute from children's checked state using a bottom-up traversal
- Handle circular references by tracking visited node IDs
