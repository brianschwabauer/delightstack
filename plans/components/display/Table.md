# Table

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Table.svelte`

## Description

A full-featured data table component for displaying tabular information. Supports sorting, row selection with checkboxes, custom cell rendering via Svelte Snippets, column resizing, column reordering, virtual scrolling for large datasets, row grouping, CSV/JSON export, expandable rows, and skeleton loading states. Integrates with the Pagination component for paged navigation.

## Dependencies

- **Components**: `Pagination` (for paged navigation)
- **Utilities**: `@delightstack/utilities` -- `sortable` (attachment, for column reordering drag-and-drop), `resizeObserver` (attachment)
- **Libraries**: none

## Visual Design

### Container
- Clean lines and spacing
- Optional border/card styling
- Horizontal scroll on overflow
- Sticky header row on vertical scroll

### Header Row
- Clear column labels
- Sort indicator arrows (up/down/neutral)
- Resize handles between columns (when `resizableColumns`)
- Background differentiation from data rows

### Data Rows
- Optional alternating backgrounds (`striped`)
- Hover highlight
- Selected row highlight (accent tint)
- Comfortable row height

### Cells
- Left-aligned text (default)
- Right-aligned numbers
- Truncation with tooltip for long content
- Custom cell rendering via Snippets

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | required | Array of row data |
| `columns` | `Column<T>[]` | required | Column definitions |
| `sortBy` | `string` | - | Current sort column key, bindable |
| `sortDirection` | `'asc' \| 'desc'` | `'asc'` | Sort direction, bindable |
| `selectable` | `boolean` | `false` | Enable row selection with checkboxes |
| `selected` | `T[]` | `[]` | Selected rows, bindable |
| `striped` | `boolean` | `false` | Alternating row background colors |
| `dense` | `boolean` | `false` | Compact cell padding |
| `comfortable` | `boolean` | `false` | Relaxed cell padding |
| `stickyHeader` | `boolean` | `true` | Sticky header on vertical scroll |
| `resizableColumns` | `boolean` | `false` | Allow column width resizing by dragging |
| `reorderableColumns` | `boolean` | `false` | Allow column drag reordering |
| `expandable` | `boolean` | `false` | Enable row expansion |
| `virtualized` | `boolean` | `false` | Virtual scrolling for large datasets |
| `rowHeight` | `number` | `48` | Row height in pixels (required for virtualization) |
| `columnVisibility` | `Record<string, boolean>` | - | Column visibility state, bindable |
| `groupBy` | `string` | - | Column key to group rows by |
| `exportable` | `boolean` | `false` | Enable CSV/JSON export functionality |
| `skeleton` | `boolean` | `false` | Show loading skeleton rows |
| `skeletonCount` | `number` | `5` | Number of skeleton rows |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `empty` | `Snippet` | - | Custom empty state content |
| `expandedRow` | `Snippet<[T]>` | - | Content for expanded row |

### Column Interface

```typescript
interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  minWidth?: string;
  align?: 'left' | 'center' | 'right';
  sticky?: boolean;
  cell?: Snippet<[{ value: any; row: T; index: number }]>;
  header?: Snippet<[{ column: Column<T> }]>;
}
```

Custom cell rendering uses Svelte Snippets (not JSX):

```svelte
{#snippet statusCell({ value, row })}
  <Badge color={value === 'active' ? 'success' : 'warning'}>{value}</Badge>
{/snippet}

{#snippet actionsCell({ row })}
  <Button size="0" onclick={() => editUser(row)}>Edit</Button>
{/snippet}

<Table
  {data}
  columns={[
    { key: 'name', label: 'Name', sortable: true },
    { key: 'status', label: 'Status', cell: statusCell },
    { key: 'actions', label: '', cell: actionsCell, width: '100px' },
  ]}
/>
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onsort` | `{ column: string, direction: 'asc' \| 'desc' }` | Sort changed |
| `onselect` | `{ selected: T[] }` | Selection changed |
| `onrowclick` | `{ row: T, index: number }` | Row clicked |
| `oncolumnresize` | `{ column: string, width: number }` | Column resized |
| `oncolumnreorder` | `{ columns: Column<T>[] }` | Columns reordered |

## Sorting

- Click a sortable column header to sort ascending
- Click again to sort descending
- Click a third time to remove sort (return to original order)
- Visual arrow indicator shows current sort state
- Multi-column sort: hold Shift and click additional columns
- Sort is applied client-side by default; provide an `onsort` handler for server-side sorting

## Selection

- Checkbox column appears as the first column when `selectable` is true
- Header checkbox toggles select-all / deselect-all
- Individual row checkboxes toggle selection
- Shift+click for range selection
- Selected rows are tracked in the `selected` bindable prop
- Selection count displayed in a toolbar (optional)

## Column Resizing

When `resizableColumns` is true:
- A resize handle appears between column headers on hover
- Drag the handle to resize columns
- Double-click to auto-fit column width to content
- Minimum column width enforced via `minWidth` in the Column definition
- Resize state persists during the session

## Column Reordering

When `reorderableColumns` is true:
- Drag column headers to reorder them
- Uses the `sortable` attachment from `@delightstack/utilities` for drag-and-drop
- Visual indicator shows where the column will be dropped
- Column order change fires `oncolumnreorder`

## Virtual Scrolling

When `virtualized` is true:
- Only visible rows are rendered in the DOM
- `rowHeight` must be set for accurate scroll calculations
- Smooth scrolling with overscan (render extra rows above/below viewport)
- Handles datasets of 100,000+ rows efficiently
- Sticky header remains visible during scroll

## Row Grouping

When `groupBy` is set:
- Rows are grouped by the specified column value
- Group headers span the full table width with the group value
- Groups are collapsible (click to toggle)
- Group headers show the count of items in each group

## CSV/JSON Export

When `exportable` is true:
- An export button appears in the table toolbar
- Dropdown with "Export CSV" and "Export JSON" options
- Exports all data (not just current page), respecting current sort and filters
- Uses the column `label` as CSV headers
- Triggers a file download

## Skeleton State

When `skeleton` is true, render `skeletonCount` rows of shimmering placeholders:
- Each column cell shows a shimmer bar of appropriate width
- Column headers show skeleton text
- Maintains table layout and column widths
- Selection checkboxes show as disabled skeleton circles

## Empty State

When `data` is empty:
- Display a centered message ("No data") or custom content via the `empty` snippet
- Maintains column headers
- Full table width message area

## Pagination Integration

```svelte
<Table data={currentPageData} {columns} />
<Pagination
  bind:page
  bind:pageSize
  totalItems={allData.length}
  showPageSize
  showInfo
/>
```

The Table component itself does not paginate data -- it displays whatever `data` is passed to it. Use the Pagination component alongside for paged navigation.

## Accessibility

- Semantic `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>` elements
- `aria-sort` on sortable column headers
- Checkbox selection uses proper `<input type="checkbox">` with labels
- Keyboard navigation: Tab through interactive elements, Enter to sort
- Row expansion uses `aria-expanded`
- Screen reader announcements for sort changes

## CSS Approach

```css
.table-container {
  overflow-x: auto;
  border-radius: var(--radius-3);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: light-dark(var(--color-surface-1), var(--color-surface-2));
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 500;
  border-bottom: 1px solid var(--color-border);
  user-select: none;
}

thead th.sortable {
  cursor: pointer;
}

tbody td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid light-dark(
    color-mix(in oklch, var(--color-border), transparent 50%),
    color-mix(in oklch, var(--color-border), transparent 50%)
  );
}

tbody tr:hover {
  background: color-mix(in oklch, var(--color-text), transparent 97%);
}

tbody tr.selected {
  background: color-mix(in oklch, var(--color-action), transparent 93%);
}

table.striped tbody tr:nth-child(even) {
  background: color-mix(in oklch, var(--color-text), transparent 98%);
}

table.dense td,
table.dense th {
  padding: 0.5rem 0.75rem;
}

table.comfortable td,
table.comfortable th {
  padding: 1rem 1.25rem;
}

.resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
}

.resize-handle:hover {
  background: var(--color-action);
}
```

## Code Example

```svelte
<script>
  import { Table, Badge, Button, Pagination } from '@delightstack/components';

  const users = [
    { id: 1, name: 'Alice', email: 'alice@example.com', status: 'active' },
    { id: 2, name: 'Bob', email: 'bob@example.com', status: 'pending' },
  ];

  let sortBy = $state('name');
  let sortDirection = $state<'asc' | 'desc'>('asc');
  let selectedUsers = $state<typeof users>([]);
  let page = $state(1);
  let pageSize = $state(10);
</script>

{#snippet statusCell({ value })}
  <Badge color={value === 'active' ? 'success' : 'warning'}>{value}</Badge>
{/snippet}

{#snippet actionsCell({ row })}
  <Button size="0" onclick={() => editUser(row)}>Edit</Button>
{/snippet}

<Table
  data={users}
  columns={[
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'status', label: 'Status', cell: statusCell },
    { key: 'actions', label: '', cell: actionsCell, width: '100px' },
  ]}
  bind:sortBy
  bind:sortDirection
  selectable
  bind:selected={selectedUsers}
  striped
/>

<Pagination
  bind:page
  bind:pageSize
  totalItems={users.length}
  showPageSize
  showInfo
/>

<!-- Skeleton loading -->
<Table
  skeleton
  skeletonCount={5}
  columns={[
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' },
  ]}
  data={[]}
/>

<!-- With grouping -->
<Table
  data={employees}
  {columns}
  groupBy="department"
/>

<!-- With virtual scrolling -->
<Table
  data={largeDataset}
  {columns}
  virtualized
  rowHeight={48}
/>

<!-- Exportable -->
<Table data={reportData} {columns} exportable />
```

## Implementation Notes

- Use semantic `<table>` elements for accessibility
- Virtual scrolling: render a container with calculated total height, position visible rows absolutely
- Column resizing: track mouse position relative to column header, update column `width` style
- Column reordering: use the `sortable` attachment on the header row
- CSV export: iterate data and columns, escape values, trigger download via Blob URL
- JSON export: `JSON.stringify(data, null, 2)` and trigger download
- Row expansion: insert an additional `<tr>` below the expanded row with `colspan` spanning all columns
- Shift-click range selection: track the last clicked row index and select all rows between
