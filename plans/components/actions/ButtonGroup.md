# ButtonGroup

**Category**: Actions
**File**: `packages/components/src/actions/ButtonGroup.svelte`

## Description

A container for grouping related buttons together. Buttons are visually connected with shared borders and coordinated corner rounding. Uses Svelte's `setContext` / `getContext` to propagate size and variant booleans to child Buttons, ensuring a uniform appearance without repeating props on each child.

## Dependencies

- **Button** -- child components that read context values
- **`@delightstack/utilities`**: _(none directly)_

## Visual Design

### Appearance
- Buttons share borders (no double borders between adjacent children)
- First button: rounded start corners only
- Middle buttons: no rounded corners
- Last button: rounded end corners only
- Consistent height across all buttons

### Orientations
- **Horizontal** (default): Buttons in a row
- **Vertical**: Buttons stacked

### Variant Inheritance
The group passes its variant booleans (`outline`, `transparent`, `translucent`) and semantic booleans (`accent`, `error`, `success`) down via context. All children render with the same appearance.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'00' \| '0' \| '1' \| '2' \| '3'` | `'1'` | Size for all child Buttons (passed via context) |
| `outline` | `boolean` | `true` | Apply outline variant to all children |
| `transparent` | `boolean` | `false` | Apply transparent variant to all children |
| `translucent` | `boolean` | `false` | Apply translucent variant to all children |
| `accent` | `boolean` | `false` | Apply accent color to all children |
| `error` | `boolean` | `false` | Apply error color to all children |
| `success` | `boolean` | `false` | Apply success color to all children |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction |
| `disabled` | `boolean` | `false` | Disable all child Buttons (passed via context) |
| `attached` | `boolean` | `true` | Connect buttons visually (shared borders, merged radii) |
| `aria-label` | `string` | - | Accessible label for the group (`role="group"`) |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Child Button components |

## Context Contract

ButtonGroup calls `setContext('delightstack:button-group', ctx)` with:

```typescript
interface ButtonGroupContext {
  size: '00' | '0' | '1' | '2' | '3';
  outline: boolean;
  transparent: boolean;
  translucent: boolean;
  accent: boolean;
  error: boolean;
  success: boolean;
  disabled: boolean;
}
```

Each Button internally calls `getContext('delightstack:button-group')` and merges the group values with its own props (own props win if explicitly set).

## Important: Child Button Rendering

For the CSS border-merging selectors to work, child Buttons **must render bare `<button>` elements** as their root. The group's CSS targets direct child `<button>` elements:

```css
.button-group > :global(button) { ... }
```

If a Button renders a wrapper `<div>` around the `<button>`, the border-radius and border-collapsing selectors will break.

## Common Patterns

### Toggle Group (Single Selection)

```svelte
<script>
  import { ButtonGroup, Button } from '@delightstack/components';
  import GridIcon from '~icons/mdi/view-grid';
  import ListIcon from '~icons/mdi/view-list';

  let viewMode = $state<'grid' | 'list'>('grid');
</script>

<ButtonGroup size="0" aria-label="View mode">
  <Button
    active={viewMode === 'grid'}
    onclick={() => viewMode = 'grid'}
    icon={GridIcon}
    iconOnly
    aria-label="Grid view"
  />
  <Button
    active={viewMode === 'list'}
    onclick={() => viewMode = 'list'}
    icon={ListIcon}
    iconOnly
    aria-label="List view"
  />
</ButtonGroup>
```

### Action Group

```svelte
<ButtonGroup aria-label="Document actions">
  <Button onclick={save}>Save</Button>
  <Button onclick={saveAs}>Save As</Button>
  <Button onclick={discard}>Discard</Button>
</ButtonGroup>
```

### Split Button (with Dropdown)

```svelte
<ButtonGroup aria-label="Save options">
  <Button onclick={primarySave}>Save</Button>
  <Button menu iconOnly icon={ChevronDownIcon} aria-label="More save options">
    {#snippet dropdown({ close })}
      <List>
        <ListItem onclick={() => { saveAs(); close(); }}>Save As...</ListItem>
        <ListItem onclick={() => { saveCopy(); close(); }}>Save Copy</ListItem>
      </List>
    {/snippet}
  </Button>
</ButtonGroup>
```

### Vertical Stack

```svelte
<ButtonGroup orientation="vertical" aria-label="Options">
  <Button>Option 1</Button>
  <Button>Option 2</Button>
  <Button>Option 3</Button>
</ButtonGroup>
```

### Text Alignment Toggle

```svelte
<script>
  import { ButtonGroup, Button } from '@delightstack/components';

  let align = $state<'left' | 'center' | 'right'>('left');
</script>

<ButtonGroup aria-label="Text alignment">
  <Button active={align === 'left'} onclick={() => align = 'left'}>Left</Button>
  <Button active={align === 'center'} onclick={() => align = 'center'}>Center</Button>
  <Button active={align === 'right'} onclick={() => align = 'right'}>Right</Button>
</ButtonGroup>
```

## Delightful Details

### Shared Borders
- Single border between buttons (adjacent borders collapsed)
- No visual gaps
- Clean, unified appearance

### Hover Isolation
- Hover state applies only to the hovered button, not neighbors
- `z-index` management ensures the hovered button's border renders on top

### Focus Flow
- Tab moves between buttons
- Focus ring spans a single button
- `z-index` raised on focus so the ring is not clipped by neighbors

### Active State
- Support for toggle behavior via the `active` prop on child Buttons
- Active button visually distinct (filled background even when the group is `outline`)
- Single or multiple active buttons supported

## Accessibility

- `role="group"` on the container element
- `aria-label` prop for describing the group purpose
- Buttons remain individually focusable
- Arrow key navigation between buttons (optional, follows roving tabindex pattern)

## CSS Approach

```css
.button-group {
  display: inline-flex;

  &.vertical {
    flex-direction: column;
  }
}

/* Horizontal border merging */
.button-group:not(.vertical) > :global(button) {
  border-radius: 0;

  &:first-child {
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  &:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  &:not(:last-child) {
    border-right: none;
  }

  &:hover,
  &:focus-visible {
    z-index: 1;
  }
}

/* Vertical border merging */
.button-group.vertical > :global(button) {
  border-radius: 0;
  width: 100%;

  &:first-child {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  &:last-child {
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  &:not(:last-child) {
    border-bottom: none;
  }

  &:hover,
  &:focus-visible {
    z-index: 1;
  }
}
```
