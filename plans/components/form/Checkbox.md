# Checkbox

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Checkbox.svelte`

## Description

A styled checkbox input for boolean selections. Features smooth animations, custom styling that matches the design system, and proper accessibility.

## Visual Design

### Appearance
- Square box with rounded corners
- Custom checkmark (not native)
- Label aligned to the right
- Consistent with design system colors

### States
- **Unchecked**: Empty box, subtle border
- **Checked**: Filled with accent, checkmark
- **Indeterminate**: Horizontal dash
- **Focused**: Focus ring
- **Disabled**: Reduced opacity

### Sizes

| Size | Box Size | Font Size |
|------|----------|-----------|
| `sm` | 16px | 14px |
| `md` | 20px | 16px |
| `lg` | 24px | 18px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | `false` | Checked state (bindable) |
| `indeterminate` | `boolean` | `false` | Indeterminate state |
| `disabled` | `boolean` | `false` | Disable checkbox |
| `size` | `Size` | `'md'` | Checkbox size |
| `label` | `string` | - | Label text |
| `description` | `string` | - | Helper text below label |
| `error` | `string` | - | Error message |
| `dense` | `boolean` | `false` | Tighter label/box spacing |
| `comfortable` | `boolean` | `false` | More label/box spacing |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ checked }` | State changed |

## Variants

### Standalone
```svelte
<Checkbox bind:checked={agreed} />
```

### With Label
```svelte
<Checkbox bind:checked={notifications} label="Enable notifications" />
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

## Delightful Details

### Check Animation
- Checkmark draws in (stroke animation)
- Slight scale bounce
- Smooth, satisfying feel

### Ripple Effect
- Subtle ripple on click
- Centered on checkbox
- Quick fade

### Focus Ring
- Clear focus indicator
- Keyboard accessible
- Not too prominent

### Error State
- Box border turns red
- Error message below
- Gentle shake animation

### Label Interaction
- Click label toggles checkbox
- Label cursor pointer
- Proper hit area

## Accessibility

- Native checkbox (visually hidden)
- Custom visual on top
- Full keyboard support
- Proper ARIA states
- Focus visible

## Code Example

```svelte
<script>
  import { Checkbox } from '@delightstack/components';

  let termsAgreed = $state(false);
  let selectedOptions = $state({
    email: true,
    sms: false,
    push: true
  });
</script>

<!-- Single checkbox -->
<Checkbox
  bind:checked={termsAgreed}
  label="I agree to the terms and conditions"
  required
/>

<!-- Checkbox group -->
<fieldset>
  <legend>Notification preferences</legend>
  <Checkbox
    bind:checked={selectedOptions.email}
    label="Email notifications"
  />
  <Checkbox
    bind:checked={selectedOptions.sms}
    label="SMS notifications"
  />
  <Checkbox
    bind:checked={selectedOptions.push}
    label="Push notifications"
  />
</fieldset>

<!-- With error -->
<Checkbox
  bind:checked={termsAgreed}
  label="Accept terms"
  error={!termsAgreed ? 'You must accept the terms' : ''}
/>
```

## Implementation Notes

- Use hidden native input for accessibility
- CSS custom properties for theming
- SVG checkmark for crisp rendering
- Handle indeterminate via JavaScript
- Support form integration
