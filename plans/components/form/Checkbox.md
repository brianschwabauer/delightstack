# Checkbox

**Category**: Form
**Files**: `packages/components/src/form/Checkbox.svelte`, `packages/components/src/form/CheckboxGroup.svelte`

## Dependencies

- None (standalone components)

## Description

A styled checkbox input for boolean selections. Features a hidden native input with a custom styled indicator, smooth SVG check stroke animation, and support for indeterminate state. Can be used standalone or within a CheckboxGroup that manages multiple related checkboxes via `setContext`/`getContext`.

## Visual Design

### Appearance
- Square box with rounded corners
- Custom SVG checkmark (not native)
- Label aligned to the right
- Colors from `--color-*` design tokens

### States
- **Unchecked**: Empty box, `--color-border` border
- **Checked**: Filled with `--color-action`, white SVG checkmark
- **Indeterminate**: `--color-action` fill, horizontal dash icon
- **Focused**: Focus ring (`--color-focus-ring`)
- **Disabled**: Reduced opacity (0.5), `cursor: not-allowed`
- **Error**: Box border `--color-error`, error message below

### Sizes

| Size | Box Size | Font Size |
|------|----------|-----------|
| `'0'` | 16px | 13px |
| `'1'` (default) | 20px | 15px |
| `'2'` | 24px | 17px |
| `'3'` | 28px | 19px |

## Checkbox Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | `false` | Checked state (`$bindable()`) |
| `indeterminate` | `boolean` | `false` | Indeterminate state |
| `value` | `any` | - | Value when used in CheckboxGroup |
| `disabled` | `boolean` | `false` | Disable checkbox |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Checkbox size |
| `label` | `string` | - | Label text |
| `description` | `string` | - | Helper text below label |
| `error` | `string` | - | Error message |
| `required` | `boolean` | `false` | Mark as required |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Tighter label/box spacing |
| `comfortable` | `boolean` | `false` | More label/box spacing |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

## CheckboxGroup Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any[]` | `[]` | Array of selected values (`$bindable()`) |
| `disabled` | `boolean` | `false` | Disable all child checkboxes |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Size for all child checkboxes |
| `label` | `string` | - | Group label |
| `error` | `string` | - | Group-level error message |
| `required` | `boolean` | `false` | At least one must be checked |
| `dense` | `boolean` | `false` | Compact spacing between checkboxes |
| `comfortable` | `boolean` | `false` | Relaxed spacing between checkboxes |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Shared form field name |
| `class` | `string` | - | Additional CSS classes |

## Events

### Checkbox
| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ checked, value }` | State changed |

### CheckboxGroup
| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value: any[] }` | Selection changed |

## Context Communication

CheckboxGroup uses `setContext` to provide group state to child Checkbox components:

```typescript
interface CheckboxGroupContext {
  value: any[];
  disabled: boolean;
  size: string;
  name: string;
  toggle: (childValue: any) => void;
  isChecked: (childValue: any) => boolean;
}
```

A Checkbox calls `getContext` on mount. If a group context exists, the Checkbox delegates its checked state and toggle behavior to the group. If no context exists, it operates standalone with its own `checked` prop.

## Usage Patterns

### Standalone
```svelte
<Checkbox bind:checked={agreed} label="I agree to the terms" />
```

### With Description
```svelte
<Checkbox
  bind:checked={marketing}
  label="Marketing emails"
  description="Receive updates about new features and offers"
/>
```

### Indeterminate (Tree Selection)
```svelte
<Checkbox
  checked={someSelected}
  indeterminate={someSelected && !allSelected}
  onchange={handleParentToggle}
  label="Select all"
/>
```

### CheckboxGroup
```svelte
<CheckboxGroup bind:value={selectedFruits} label="Favorite fruits" name="fruits">
  <Checkbox value="apple" label="Apple" />
  <Checkbox value="banana" label="Banana" />
  <Checkbox value="cherry" label="Cherry" />
</CheckboxGroup>
```

### CheckboxGroup with Error
```svelte
<CheckboxGroup
  bind:value={permissions}
  label="Permissions"
  required
  error={permissions.length === 0 ? 'Select at least one permission' : ''}
>
  <Checkbox value="read" label="Read" />
  <Checkbox value="write" label="Write" />
  <Checkbox value="admin" label="Admin" />
</CheckboxGroup>
```

## Styling

All colors use `--color-*` tokens:
- Border: `--color-border`
- Checked fill: `--color-action`
- Checkmark: white (`--color-on-action`)
- Error: `--color-error`
- Focus ring: `--color-focus-ring`
- Label: `--color-text`
- Description: `--color-text-muted`
- Disabled: opacity 0.5 applied to wrapper

## Delightful Details

### Check Stroke Animation
- SVG `<path>` for the checkmark
- Animated via `stroke-dasharray` and `stroke-dashoffset`
- Draws in from the start of the stroke over 200ms
- Slight scale bounce on the box (1.0 -> 1.1 -> 1.0)

### Indeterminate Dash Animation
- Horizontal dash draws in from center outward
- Smooth transition when switching between checked and indeterminate

### Ripple Effect
- Subtle radial ripple on click, centered on checkbox
- Uses `--color-action` at low opacity
- Quick fade (200ms)

### Focus Ring
- 2px ring using `--color-focus-ring`
- Offset from box edge
- Only on `:focus-visible` (keyboard)

### Error State
- Box border transitions to `--color-error`
- Error message fades in below
- Gentle shake animation on validation trigger

### Label Interaction
- Click label toggles checkbox
- Label has `cursor: pointer`
- Proper hit area via padding

## Accessibility

- Hidden native `<input type="checkbox">` positioned behind custom visual
- `aria-checked` reflects state (true/false/mixed for indeterminate)
- `aria-describedby` for description and error
- `aria-required` when required
- Full keyboard support: Space to toggle, Tab to navigate
- Label associated via `<label for="">` wrapping or `id` link
- Screen reader announces state changes

## Code Example

```svelte
<script>
  import { Checkbox, CheckboxGroup } from '@delightstack/components';

  let termsAgreed = $state(false);
  let notifications = $state<string[]>(['email', 'push']);
</script>

<!-- Single checkbox -->
<Checkbox
  bind:checked={termsAgreed}
  label="I agree to the terms and conditions"
  required
  tooltip="You must agree to continue"
/>

<!-- Checkbox group -->
<CheckboxGroup
  bind:value={notifications}
  label="Notification preferences"
  name="notifications"
>
  <Checkbox value="email" label="Email notifications" />
  <Checkbox value="sms" label="SMS notifications" />
  <Checkbox value="push" label="Push notifications" />
</CheckboxGroup>

<!-- With error -->
<Checkbox
  bind:checked={termsAgreed}
  label="Accept terms"
  error={!termsAgreed ? 'You must accept the terms' : ''}
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `checked` (Checkbox) and `value` (CheckboxGroup)
- Uses `$state()` for internal reactive state
- Hidden native `<input type="checkbox">` for form submission and accessibility
- SVG `<path>` element for checkmark with CSS `stroke-dasharray` animation
- CheckboxGroup uses `setContext()` / child Checkbox uses `getContext()`
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
