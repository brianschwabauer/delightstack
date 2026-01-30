# Table

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Table.svelte`

## Description

A data table component for displaying tabular information with sorting, filtering, and optional row selection. Balances functionality with simplicity, avoiding the complexity of heavy data grid libraries.

## Visual Design

### Container
- Clean lines and spacing
- Optional border/card styling
- Horizontal scroll on overflow
- Sticky header on scroll

### Header Row
- Clear column labels
- Sort indicators
- Filter controls (optional)
- Background differentiation

### Data Rows
- Alternating backgrounds (optional)
- Hover highlight
- Selected row highlight
- Comfortable row height

### Cells
- Left-aligned text (default)
- Right-aligned numbers
- Truncation with tooltip for long content
- Custom cell rendering support

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | required | Array of row data |
| `columns` | `Column<T>[]` | required | Column definitions |
| `sortBy` | `string` | - | Current sort column (bindable) |
| `sortDir` | `'asc' \| 'desc'` | `'asc'` | Sort direction (bindable) |
| `selectable` | `boolean` | `false` | Enable row selection |
| `selected` | `T[]` | `[]` | Selected rows (bindable) |
| `striped` | `boolean` | `false` | Alternating row colors |
| `dense` | `boolean` | `false` | Compact cell padding |
| `comfortable` | `boolean` | `false` | Relaxed cell padding |
| `stickyHeader` | `boolean` | `true` | Sticky header on scroll |

### Column Interface
```typescript
interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: T) => Snippet;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onsort` | `{ column, direction }` | Sort changed |
| `onselect` | `{ selected }` | Selection changed |
| `onrowclick` | `{ row, index }` | Row clicked |

## Features

### Sorting
- Click header to sort
- Click again to reverse
- Visual indicator (arrow)
- Multi-column sort (optional)

### Selection
- Checkbox column for multi-select
- Header checkbox for select all
- Shift-click range selection
- Keyboard selection

### Custom Cells
```svelte
<Table {data} columns={[
  { key: 'name', label: 'Name' },
  {
    key: 'status',
    label: 'Status',
    render: (value) => {
      return <Badge variant={value}>{value}</Badge>
    }
  },
  {
    key: 'actions',
    label: '',
    render: (_, row) => {
      return <Button onclick={() => edit(row)}>Edit</Button>
    }
  }
]} />
```

### Empty State
- Clear message when no data
- Customizable empty content
- Not just blank space

## Delightful Details

### Smooth Sorting
- Rows animate to new positions
- Or: Quick fade transition
- Sort indicator animates

### Row Hover
- Subtle background change
- Reveals action buttons (if any)
- Cursor indicates clickable (if applicable)

### Selection Animation
- Checkbox animates
- Row highlight transitions
- Count updates smoothly

### Responsive
- Horizontal scroll on small screens
- Priority columns stay visible
- Touch-friendly targets

### Loading State
- Skeleton rows while loading
- Maintains layout
- Spinner for updates

## Accessibility

- Proper table semantics
- Sortable columns announced
- Keyboard navigation
- Selection state communicated

## Code Example

```svelte
<script>
  import { Table, Badge, Button } from '@delightstack/components';

  const users = [
    { id: 1, name: 'Alice', email: 'alice@example.com', status: 'active' },
    { id: 2, name: 'Bob', email: 'bob@example.com', status: 'pending' },
    // ...
  ];

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (value) => <Badge variant={value}>{value}</Badge>
    },
    {
      key: 'actions',
      label: '',
      width: '100px',
      render: (_, row) => (
        <Button size="small" onclick={() => editUser(row)}>
          Edit
        </Button>
      )
    }
  ];

  let sortBy = $state('name');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let selectedUsers = $state<typeof users>([]);
</script>

<Table
  data={users}
  {columns}
  bind:sortBy
  bind:sortDir
  selectable
  bind:selected={selectedUsers}
  striped
/>
```

## Implementation Notes

- Use semantic `<table>` elements
- Handle large datasets with virtual scrolling
- Consider column resizing as future enhancement
- Persist sort/selection state if needed
- Mobile: consider card view alternative
