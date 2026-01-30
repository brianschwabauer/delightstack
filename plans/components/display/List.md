# List

**Status**: ✅ Complete
**Category**: Display
**File**: `packages/components/src/display/List.svelte`

## Description

A flexible container for list items that provides context-based state management, selection handling, and consistent styling. Supports multiple interaction modes including buttons, checkboxes, radios, and plain text.

## Visual Design

### Container
- Clean background (inherits or transparent)
- Optional subtle border
- Rounded corners on first/last items
- Consistent vertical rhythm

### Density Variants
- **Default**: Comfortable spacing for touch
- **Comfortable**: Slightly reduced padding
- **Dense**: Compact for data-heavy UIs

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'button' \| 'text' \| 'radio' \| 'checkbox'` | `'button'` | Interaction mode |
| `value` | `any` | - | Selected value(s) (bindable) |
| `dense` | `boolean` | `false` | Compact spacing |
| `comfortable` | `boolean` | `false` | Medium spacing |
| `disabled` | `boolean` | `false` | Disable all items |
| `touched` | `boolean` | `false` | Track if interacted (bindable) |
| `paddingX` | `string` | - | Horizontal padding override |
| `paddingY` | `string` | - | Vertical padding override |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `value` | Selection changed |
| `ontouch` | - | First interaction occurred |

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
- Visual feedback on hover/click

### Radio Mode
```svelte
<List type="radio" bind:value={selected}>
  <ListItem value="option1">Option 1</ListItem>
  <ListItem value="option2">Option 2</ListItem>
  <ListItem value="option3">Option 3</ListItem>
</List>
```
- Single selection
- Radio indicator on left
- Bound to single value

### Checkbox Mode
```svelte
<List type="checkbox" bind:value={selected}>
  <ListItem value="a">Item A</ListItem>
  <ListItem value="b">Item B</ListItem>
  <ListItem value="c">Item C</ListItem>
</List>
```
- Multiple selection
- Checkbox indicator on left
- Bound to array of values

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

## Context API

List provides context to child ListItems:

```typescript
interface ListContext {
  type: 'button' | 'text' | 'radio' | 'checkbox';
  value: Writable<any>;
  disabled: boolean;
  dense: boolean;
  comfortable: boolean;
  // ... other shared state
}
```

## Delightful Details

### Smart Borders
- First item: top corners rounded
- Last item: bottom corners rounded
- Middle items: no radius
- Handles dynamic children

### Keyboard Navigation
- Arrow keys move between items
- Home/End jump to start/end
- Space/Enter activates item
- Type-ahead search

### Nested Lists
- Supports list within list
- Proper indentation
- Context inheritance with overrides

## Accessibility

- Proper `role="listbox"` or `role="menu"`
- `aria-selected` for selections
- Keyboard navigation
- Focus management

## Current Implementation

The current implementation is **complete** with:
- All selection modes
- Context API for ListItem
- Density variants
- Nested list support
- Full keyboard navigation

## Code Example

```svelte
<script>
  import { List, ListItem } from '@delightstack/components';

  let selectedOption = $state('');
  let selectedItems = $state<string[]>([]);
</script>

<!-- Radio selection -->
<List type="radio" bind:value={selectedOption}>
  <ListItem value="small">Small</ListItem>
  <ListItem value="medium">Medium</ListItem>
  <ListItem value="large">Large</ListItem>
</List>

<!-- Checkbox multi-select -->
<List type="checkbox" bind:value={selectedItems}>
  <ListItem value="notifications">Notifications</ListItem>
  <ListItem value="emails">Email Updates</ListItem>
  <ListItem value="sms">SMS Alerts</ListItem>
</List>

<!-- Menu actions -->
<List dense>
  <ListItem onclick={() => handleEdit()}>Edit</ListItem>
  <ListItem onclick={() => handleDuplicate()}>Duplicate</ListItem>
  <ListItem onclick={() => handleDelete()}>Delete</ListItem>
</List>
```

## Styling

The List component uses CSS custom properties that can be overridden:

```css
.my-list {
  --list-padding-x: 16px;
  --list-padding-y: 12px;
  --list-item-radius: 8px;
  --list-hover-bg: var(--layer-1);
}
```
