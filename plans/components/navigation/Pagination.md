# Pagination

**Category**: Navigation
**File**: `packages/components/src/navigation/Pagination.svelte`

## Description

Page navigation controls for paginated content. Provides previous/next buttons, page number buttons with an ellipsis algorithm, and an optional page size selector. Supports three display modes via boolean props: full page numbers (default), simple prev/next with label, and compact current/total display. Integrates with the Table component for data table pagination.

## Dependencies

- **Components**: `Select` -- used internally for the page size dropdown selector
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Default Display (Full Page Numbers)
```
< Prev  1  2  ...  5  [6]  7  ...  10  11  Next >
```
- Previous/Next buttons at the ends
- Numbered page buttons in the middle
- Current page highlighted with filled background
- Ellipsis indicators for skipped ranges
- First and last pages always visible

### Simple Display (`simple`)
```
< Prev   Page 6 of 11   Next >
```
- Previous/Next buttons only
- Current page and total displayed as text between buttons
- No individual page number buttons

### Compact Display (`compact`)
```
<   6 / 11   >
```
- Icon-only previous/next arrows
- Minimal page indicator
- Suited for tight layouts and mobile viewports

### States
- **Default**: Normal button appearance
- **Current page**: Filled background with `--color-action`, contrasting text
- **Hover**: Subtle background highlight
- **Disabled**: Reduced opacity on Prev (page 1) and Next (last page)
- **Focus**: Visible focus ring (keyboard only)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `page` | `number` | `1` | Current page number (`$bindable()`) |
| `totalPages` | `number` | required | Total number of pages |
| `totalItems` | `number` | - | Total item count (enables info display) |
| `pageSize` | `number` | `10` | Items per page (`$bindable()`) |
| `pageSizeOptions` | `number[]` | `[10, 25, 50, 100]` | Choices for the page size dropdown |
| `simple` | `boolean` | `false` | Simple prev/next display mode |
| `compact` | `boolean` | `false` | Compact current/total display mode |
| `showPageSize` | `boolean` | `false` | Show the page size selector dropdown |
| `showInfo` | `boolean` | `false` | Show item range info (e.g. "Showing 51-60 of 500") |
| `siblingCount` | `number` | `1` | Number of page buttons shown on each side of the current page |
| `boundaryCount` | `number` | `1` | Number of page buttons always shown at the start and end |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Button and control size |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `onchange` | `(detail: { page: number }) => void` | - | Fires when the page changes |
| `onpagesizechange` | `(detail: { pageSize: number }) => void` | - | Fires when the page size changes |

## Ellipsis Algorithm

The algorithm determines which page buttons to render. Given `page`, `totalPages`, `siblingCount`, and `boundaryCount`:

1. **Boundary pages**: Always show the first `boundaryCount` pages and the last `boundaryCount` pages.
2. **Sibling pages**: Always show `siblingCount` pages before and after the current page.
3. **Current page**: Always shown.
4. **Gaps**: Any gap between visible page ranges is replaced with a single "..." ellipsis indicator.

Example with `siblingCount=1`, `boundaryCount=1`, `page=6`, `totalPages=11`:

```
Boundary start: [1]
Gap: ...
Siblings + current: [5] [6] [7]
Gap: ...
Boundary end: [11]

Result: 1 ... 5 [6] 7 ... 11
```

Edge cases:
- When the sibling range overlaps with a boundary, no ellipsis is shown for that side.
- When `totalPages <= (boundaryCount * 2) + (siblingCount * 2) + 3`, all pages are shown with no ellipsis.
- When on page 1: `[1] 2 ... 11`
- When on page 2: `1 [2] 3 ... 11`
- When on last page: `1 ... 10 [11]`

## Page Size Selector

When `showPageSize` is true, a Select dropdown is rendered alongside the pagination controls. Changing the page size:
1. Updates the `pageSize` binding.
2. Resets `page` to 1 (to avoid landing on a page that no longer exists).
3. Fires `onpagesizechange`.

The dropdown renders the `pageSizeOptions` array as selectable values with labels like "10 / page".

## Item Count Info

When `showInfo` is true and `totalItems` is provided, a text label displays the current range:

```
Showing 51-60 of 500
```

Calculated as:
- Start: `(page - 1) * pageSize + 1`
- End: `Math.min(page * pageSize, totalItems)`

## Table Integration

Pagination is designed to work alongside the Table component. The Table manages its own data slicing; Pagination provides the controls:

```svelte
<Table data={currentPageData} />
<Pagination
  bind:page
  bind:pageSize
  totalItems={allData.length}
  showPageSize
  showInfo
/>
```

The parent component computes `currentPageData` from `page` and `pageSize`.

## Delightful Details

### Hover States
- Page buttons show subtle background highlight on hover
- Smooth transition (`var(--duration-fast)`)

### Active State
- Current page button has filled background (`--color-action`)
- Clear contrast with surrounding buttons

### Disabled States
- Prev button disabled on page 1 (reduced opacity, `cursor: not-allowed`)
- Next button disabled on the last page
- Prevents double-clicks during page transitions

### Keyboard Navigation
- Tab through all controls
- Enter/Space activates a page button
- Arrow keys for quick navigation when focused within the page list

## Accessibility

- `<nav>` wrapper with `aria-label="Pagination"`
- `aria-current="page"` on the current page button
- `aria-disabled="true"` on Prev/Next when at boundaries
- Ellipsis elements are `aria-hidden="true"` (decorative)
- Page buttons have `aria-label="Page N"` or `aria-label="Go to page N"`
- Full keyboard navigation

## Skeleton State

When `skeleton` is true, render placeholder elements matching the pagination layout: shimmering rectangles for Prev/Next buttons and page number placeholders. The skeleton adjusts to the current display mode (`simple`, `compact`, or default).

## CSS Approach

```css
.pagination {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.pagination-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: light-dark(var(--color-text-primary), var(--color-text-primary));
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default);
}

.pagination-button:hover {
  background: light-dark(var(--color-surface-2), var(--color-surface-2));
}

.pagination-button.current {
  background: var(--color-action);
  color: var(--color-action-text);
}

.pagination-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
}

.pagination-info {
  font-size: var(--text-sm);
  color: light-dark(var(--color-text-secondary), var(--color-text-secondary));
  white-space: nowrap;
}
```

## Code Example

```svelte
<script>
  import { Pagination } from '@delightstack/components';

  let page = $state(1);
  let pageSize = $state(10);
  const totalItems = 500;
  const totalPages = $derived(Math.ceil(totalItems / pageSize));
</script>

<!-- Default full pagination -->
<Pagination
  bind:page
  {totalPages}
/>

<!-- With page size selector and info -->
<Pagination
  bind:page
  bind:pageSize
  {totalPages}
  {totalItems}
  showPageSize
  showInfo
/>

<!-- Simple mode -->
<Pagination simple bind:page {totalPages} />

<!-- Compact mode for mobile -->
<Pagination compact bind:page {totalPages} />

<!-- Table integration -->
<Table data={currentPageData} />
<Pagination
  bind:page
  bind:pageSize
  totalItems={allData.length}
  showPageSize
  showInfo
/>

<!-- Custom ellipsis range -->
<Pagination
  bind:page
  {totalPages}
  siblingCount={2}
  boundaryCount={2}
/>

<!-- Skeleton loading -->
<Pagination skeleton />
```
