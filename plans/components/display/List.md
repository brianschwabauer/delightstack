# List

**Status**: Complete
**Category**: Display
**File**: `packages/components/src/display/List.svelte`

## Description

A flexible container for list items that provides context-based state management, selection handling, and consistent styling. Supports multiple interaction modes including buttons, checkboxes, radios, and plain text. Uses `setContext` to communicate shared state to child ListItem components.

## Dependencies

- **Components**: `ListItem` (child)
- **Utilities**: `@delightstack/utilities` -- `onFocusWithin` (attachment, for touched state tracking)
- **Libraries**: none

## Visual Design

### Container
- Clean background (inherits or `--color-bg-active`)
- Rounded corners on first/last items
- Consistent vertical rhythm
- Subtle dividers between items

### Density
- **Default**: Comfortable spacing for touch targets (3.5rem min-height)
- **Dense** (`dense`): Compact spacing for data-heavy UIs (3rem min-height)
- **Comfortable** (`comfortable`): Relaxed spacing (4rem min-height)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'button' \| 'text' \| 'radio' \| 'checkbox'` | `'button'` | Interaction mode for items |
| `value` | `number[]` | `[]` | Selected item indices, bindable |
| `dense` | `boolean` | `false` | Compact spacing |
| `comfortable` | `boolean` | `false` | Relaxed spacing |
| `disabled` | `boolean` | `false` | Disable all items |
| `touched` | `boolean` | `false` | Track if user has interacted, bindable |
| `paddingX` | `string` | - | Horizontal padding override |
| `paddingY` | `string` | - | Vertical padding override |
| `skeleton` | `boolean` | `false` | Show loading skeleton items |
| `skeletonCount` | `number` | `5` | Number of skeleton items to show |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `style` | `string` | - | Additional inline styles |
| `children` | `Snippet` | - | ListItem children |
| `ontouch` | `() => void` | - | Called when first interaction occurs |
| `onchange` | `(value: number[]) => void` | - | Called when selection changes |

## Context API

List provides context to child ListItems via `setContext`:

```typescript
interface ListContext {
  type: 'button' | 'text' | 'radio' | 'checkbox';
  value: number[];
  dense: boolean;
  comfortable: boolean;
  disabled: boolean;
  level: number;
  id: string;
}
```

## Selection Modes

### Button Mode (Default)
```svelte
<List>
  <ListItem onclick={handleClick}>Action Item</ListItem>
  <ListItem onclick={handleClick}>Another Action</ListItem>
</List>
```
- Items are clickable buttons
- No persistent selection state
- Visual feedback on hover/click with ripple

### Radio Mode
```svelte
<List type="radio" bind:value={selected}>
  <ListItem>Option 1</ListItem>
  <ListItem>Option 2</ListItem>
  <ListItem>Option 3</ListItem>
</List>
```
- Single selection
- Radio indicator displayed
- Value contains a single-element array with the selected index

### Checkbox Mode
```svelte
<List type="checkbox" bind:value={selected}>
  <ListItem>Item A</ListItem>
  <ListItem>Item B</ListItem>
  <ListItem>Item C</ListItem>
</List>
```
- Multiple selection
- Checkbox indicator displayed
- Value is an array of selected indices

### Text Mode
```svelte
<List type="text">
  <ListItem>Read-only item</ListItem>
  <ListItem>Another item</ListItem>
</List>
```
- Non-interactive display
- No hover effects
- For information display

## Keyboard Navigation

- **Arrow Up/Down**: Move focus between items
- **Home/End**: Jump to first/last item
- **Space/Enter**: Activate current item (select or click)
- **Type-ahead**: Focus item matching typed characters

## Nested Lists

Lists can be nested. The parent context propagates to children with the `level` incremented, enabling indentation and inherited settings.

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder items with shimmering bars matching the list item layout. Each placeholder has the same height as real items.

## Accessibility

- Renders as `<ul>` with proper list semantics
- `aria-selected` for selection modes
- Keyboard navigation across items
- Focus management with `onFocusWithin` attachment
- Disabled state communicated to assistive technology

## CSS Approach

```css
ul.list {
  --radius: var(--radius-5);
  --color-bg: var(--color-bg-active);
  --border-inset: 6px;
  border-radius: var(--radius);
  padding: 0;
  margin: 0;
  background-color: var(--color-bg);
}

ul.list.dense {
  --radius: var(--radius-4);
  --border-inset: 4px;
}

ul.list.disabled {
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

ul.list > :global(li:first-child) {
  border-top-left-radius: var(--radius);
  border-top-right-radius: var(--radius);
}

ul.list > :global(li:last-child) {
  border-bottom-left-radius: var(--radius);
  border-bottom-right-radius: var(--radius);
}
```

## Code Example

```svelte
<script>
  import { List, ListItem } from '@delightstack/components';

  let selectedOption = $state<number[]>([]);
  let selectedItems = $state<number[]>([]);
</script>

<!-- Radio selection -->
<List type="radio" bind:value={selectedOption}>
  <ListItem>Small</ListItem>
  <ListItem>Medium</ListItem>
  <ListItem>Large</ListItem>
</List>

<!-- Checkbox multi-select -->
<List type="checkbox" bind:value={selectedItems}>
  <ListItem>Notifications</ListItem>
  <ListItem>Email Updates</ListItem>
  <ListItem>SMS Alerts</ListItem>
</List>

<!-- Menu actions -->
<List dense>
  <ListItem onclick={() => handleEdit()}>Edit</ListItem>
  <ListItem onclick={() => handleDuplicate()}>Duplicate</ListItem>
  <ListItem onclick={() => handleDelete()}>Delete</ListItem>
</List>

<!-- Skeleton -->
<List skeleton skeletonCount={4} />
```

## Implementation Notes

- The current implementation is complete
- Uses `setContext`/`getContext` for parent-child communication
- Selection state managed via change event delegation on the `<ul>` element
- Nested lists inherit parent context with incremented `level`
- `onFocusWithin` attachment tracks the `touched` state
- Only renders the outer `<ul>` at the top level; nested children render directly
