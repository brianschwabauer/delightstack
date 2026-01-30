# Pagination

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Pagination.svelte`

## Description

Page navigation controls for paginated content. Provides previous/next buttons, page numbers, and page size selection for navigating through large datasets.

## Visual Design

### Layout
- Horizontal row of controls
- Previous/Next buttons at ends
- Page numbers in middle
- Optional page size selector

### Page Numbers
- Current page highlighted
- Ellipsis for skipped ranges
- First and last always visible

### Buttons
- Clear disabled state
- Consistent sizing
- Optional labels

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `page` | `number` | `1` | Current page (bindable) |
| `totalPages` | `number` | required | Total page count |
| `totalItems` | `number` | - | Total item count |
| `pageSize` | `number` | `10` | Items per page (bindable) |
| `pageSizeOptions` | `number[]` | `[10, 25, 50]` | Page size choices |
| `showPageSize` | `boolean` | `false` | Show page size selector |
| `showInfo` | `boolean` | `false` | Show item count info |
| `siblingCount` | `number` | `1` | Pages shown around current |
| `boundaryCount` | `number` | `1` | Pages at start/end |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ page }` | Page changed |
| `onpagesizechange` | `{ pageSize }` | Page size changed |

## Display Modes

### Full (Default)
```
« Prev | 1 | 2 | ... | 5 | [6] | 7 | ... | 10 | 11 | Next »
```

### Simple
```svelte
<Pagination variant="simple" {page} {totalPages} />
```
```
« Prev | Page 6 of 11 | Next »
```

### Compact (Mobile)
```svelte
<Pagination variant="compact" {page} {totalPages} />
```
```
« | 6/11 | »
```

## Ellipsis Logic

Show ellipsis when pages are skipped:
- `1 2 ... 5 [6] 7 ... 10 11`
- Always show first and last `boundaryCount` pages
- Show `siblingCount` pages around current

## Features

### Page Size Selection
```svelte
<Pagination
  bind:page
  bind:pageSize
  totalItems={500}
  showPageSize
/>
```
- Dropdown to change page size
- Resets to page 1 on change

### Item Count Info
```svelte
<Pagination showInfo totalItems={500} />
```
- "Showing 51-60 of 500"
- Clear context for user

### Jump to Page
```svelte
<Pagination showJump />
```
- Input to type page number
- Quick navigation for many pages

## Delightful Details

### Hover States
- Clear hover on buttons
- Page numbers highlight

### Active State
- Current page distinct
- Filled background

### Disabled States
- Prev disabled on page 1
- Next disabled on last page
- Clear visual indication

### Keyboard Support
- Tab through controls
- Enter to activate
- Arrow keys for quick nav

### Loading State
- During page change
- Prevents double-clicks

## Accessibility

- Proper `<nav>` wrapper
- `aria-label="Pagination"`
- `aria-current="page"` on current
- Keyboard navigable

## Code Example

```svelte
<script>
  import { Pagination } from '@delightstack/components';

  let page = $state(1);
  let pageSize = $state(10);
  const totalItems = 500;

  $: totalPages = Math.ceil(totalItems / pageSize);
</script>

<!-- Basic pagination -->
<Pagination
  bind:page
  {totalPages}
/>

<!-- With page size and info -->
<Pagination
  bind:page
  bind:pageSize
  {totalPages}
  {totalItems}
  showPageSize
  showInfo
/>

<!-- Simple variant -->
<Pagination
  variant="simple"
  bind:page
  {totalPages}
/>

<!-- Table pagination -->
<Table data={currentPageData} />
<Pagination
  bind:page
  bind:pageSize
  totalItems={allData.length}
  showPageSize
  showInfo
/>
```

## Implementation Notes

- Calculate page range with ellipsis
- Handle edge cases (1 page, 2 pages)
- URL parameter sync option
- Consider server-side pagination patterns
