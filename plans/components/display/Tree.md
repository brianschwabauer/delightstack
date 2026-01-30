# Tree

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Tree.svelte`

## Description

A hierarchical data display component for folder structures, category trees, or any nested data. Supports expand/collapse, selection, and drag-and-drop reordering.

## Visual Design

### Node Structure
- Expand/collapse chevron
- Icon (file, folder, custom)
- Label text
- Optional trailing actions

### Indentation
- Clear visual hierarchy
- Connecting lines (optional)
- Consistent indent step (16-24px)

### States
- Collapsed: chevron right, children hidden
- Expanded: chevron down, children visible
- Selected: highlighted background
- Hover: subtle background

## Props

### Tree Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TreeNode[]` | required | Tree data |
| `selected` | `string[]` | `[]` | Selected node IDs (bindable) |
| `expanded` | `string[]` | `[]` | Expanded node IDs (bindable) |
| `selectable` | `boolean` | `false` | Enable selection |
| `multiSelect` | `boolean` | `false` | Allow multiple selection |
| `checkboxes` | `boolean` | `false` | Show checkboxes for selection |
| `showLines` | `boolean` | `false` | Show connecting lines |
| `draggable` | `boolean` | `false` | Enable drag-and-drop reordering |
| `filter` | `string` | - | Filter/search term to highlight matches |
| `virtualized` | `boolean` | `false` | Virtual scrolling for large trees |
| `dense` | `boolean` | `false` | Compact node spacing |
| `comfortable` | `boolean` | `false` | Relaxed node spacing |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### TreeNode Interface
```typescript
interface TreeNode {
  id: string;
  label: string;
  icon?: Component;
  children?: TreeNode[];
  disabled?: boolean;
  data?: any;  // Custom payload
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ node, selected }` | Selection changed |
| `onexpand` | `{ node, expanded }` | Node expanded/collapsed |
| `ondrop` | `{ node, target, position }` | Node dropped |

## Features

### Expand/Collapse
- Click chevron or double-click node
- Expand all / Collapse all actions
- Remember state across sessions

### Selection
- Click to select
- Ctrl+click for multi-select
- Shift+click for range
- Checkbox mode available

### Keyboard Navigation
- Arrow Up/Down: Move between visible nodes
- Arrow Right: Expand or move to first child
- Arrow Left: Collapse or move to parent
- Enter/Space: Select or toggle expand
- Home/End: First/last node

### Drag and Drop
- Drag nodes to reorder
- Drop on node to make child
- Drop between nodes to reorder siblings
- Visual drop indicators

### Lazy Loading
```svelte
<Tree
  data={rootNodes}
  loadChildren={async (node) => {
    return await fetchChildren(node.id);
  }}
/>
```
- Load children on expand
- Loading indicator
- Handle errors

## Delightful Details

### Smooth Expand
- Children animate in
- Height transition
- Staggered reveal for many children

### Drag Preview
- Ghost of dragged node
- Clear drop indicators
- Invalid drop zones shown

### Focus Flow
- Clear focus indicator
- Focus follows selection
- Smooth scroll to focused

### Search/Filter
```svelte
<Tree data={data} filter={searchTerm} />
```
- Highlight matching nodes
- Auto-expand to show matches
- Clear filter restores state

## Accessibility

- Proper ARIA tree role
- Expanded/collapsed states announced
- Keyboard fully functional
- Focus management

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
</script>

<Tree
  data={fileTree}
  selectable
  bind:selected
  bind:expanded
  onselect={({ node }) => openFile(node)}
/>
```

## Implementation Notes

- Recursive component structure
- Use context for shared state
- Virtual scrolling for large trees
- Handle circular references
- Efficient rerender on expand/collapse
