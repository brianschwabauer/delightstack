# ButtonGroup

**Status**: 🔲 Placeholder
**Category**: Actions
**File**: `packages/components/src/actions/ButtonGroup.svelte`

## Description

A container for grouping related buttons together. Buttons are visually connected with shared borders and coordinated corner rounding. Supports both horizontal and vertical orientations.

## Visual Design

### Appearance
- Buttons share borders (no double borders)
- First button: rounded start corners
- Middle buttons: no rounded corners
- Last button: rounded end corners
- Consistent height across all buttons

### Orientations
- **Horizontal**: Buttons in a row (default)
- **Vertical**: Buttons stacked

### Variants
Inherits button variants, but applied uniformly:
- All solid
- All outline
- All ghost

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction |
| `size` | `Size` | `'md'` | Size for all buttons |
| `variant` | `Variant` | `'outline'` | Variant for all buttons |
| `disabled` | `boolean` | `false` | Disable all buttons |
| `attached` | `boolean` | `true` | Connect buttons visually |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Common Patterns

### Toggle Group (Single Selection)
```svelte
<ButtonGroup>
  <Button active={view === 'grid'} onclick={() => view = 'grid'}>
    <GridIcon />
  </Button>
  <Button active={view === 'list'} onclick={() => view = 'list'}>
    <ListIcon />
  </Button>
</ButtonGroup>
```

### Action Group
```svelte
<ButtonGroup>
  <Button onclick={save}>Save</Button>
  <Button onclick={saveAs}>Save As</Button>
  <Button onclick={discard}>Discard</Button>
</ButtonGroup>
```

### Split Button (with Dropdown)
```svelte
<ButtonGroup>
  <Button onclick={primaryAction}>Save</Button>
  <Button onclick={() => menuOpen = true}>
    <ChevronDownIcon />
  </Button>
</ButtonGroup>
```

### Vertical Stack
```svelte
<ButtonGroup orientation="vertical">
  <Button>Option 1</Button>
  <Button>Option 2</Button>
  <Button>Option 3</Button>
</ButtonGroup>
```

## Delightful Details

### Shared Borders
- Single border between buttons
- No visual gaps
- Clean, unified appearance

### Hover Isolation
- Hover state doesn't affect neighbors
- Clear which button is hovered
- Z-index management for overlap

### Focus Flow
- Tab moves between buttons
- Focus ring spans single button
- Clear focus indication

### Active State
- Support for toggle behavior
- Active button visually distinct
- Can have single or multiple active

## Accessibility

- `role="group"` on container
- Buttons remain individually focusable
- Arrow keys can navigate (optional)
- Proper focus management

## Code Example

```svelte
<script>
  import { ButtonGroup, Button } from '@delightstack/components';
  import GridIcon from '~icons/mdi/view-grid';
  import ListIcon from '~icons/mdi/view-list';

  let viewMode = $state<'grid' | 'list'>('grid');
</script>

<!-- View toggle -->
<ButtonGroup size="sm">
  <Button
    active={viewMode === 'grid'}
    onclick={() => viewMode = 'grid'}
    aria-label="Grid view"
  >
    <GridIcon />
  </Button>
  <Button
    active={viewMode === 'list'}
    onclick={() => viewMode = 'list'}
    aria-label="List view"
  >
    <ListIcon />
  </Button>
</ButtonGroup>

<!-- Text alignment -->
<ButtonGroup variant="outline">
  <Button active={align === 'left'} onclick={() => align = 'left'}>Left</Button>
  <Button active={align === 'center'} onclick={() => align = 'center'}>Center</Button>
  <Button active={align === 'right'} onclick={() => align = 'right'}>Right</Button>
</ButtonGroup>

<!-- Pagination controls -->
<ButtonGroup>
  <Button disabled={page === 1} onclick={prevPage}>Previous</Button>
  <Button disabled={page === totalPages} onclick={nextPage}>Next</Button>
</ButtonGroup>
```

## CSS Approach

```css
.button-group {
  display: inline-flex;

  &.vertical {
    flex-direction: column;
  }
}

.button-group > :global(button) {
  border-radius: 0;

  &:first-child {
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  &:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  &:not(:last-child) {
    border-right: none; /* Prevent double borders */
  }
}
```

## Implementation Notes

- Use CSS to modify child button border-radius
- Handle dynamic children (add/remove buttons)
- Manage z-index for overlapping focus/hover states
- Support both Button components and native buttons
