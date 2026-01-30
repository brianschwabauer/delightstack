# Fieldset

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Fieldset.svelte`

## Description

A grouping component for related form fields. Provides visual structure, shared validation states, and proper semantic markup for form sections.

## Visual Design

### Appearance
- Optional border or background
- Legend/title at top
- Consistent internal spacing
- Clear visual grouping

### Variants

| Variant | Appearance |
|---------|------------|
| `default` | No visual container |
| `bordered` | Subtle border |
| `card` | Card-style with shadow |
| `filled` | Light background fill |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `legend` | `string` | - | Section title |
| `description` | `string` | - | Helper text |
| `variant` | `Variant` | `'default'` | Visual style |
| `disabled` | `boolean` | `false` | Disable all fields |
| `error` | `string` | - | Group-level error |
| `required` | `boolean` | `false` | Mark section required |
| `dense` | `boolean` | `false` | Compact field spacing |
| `comfortable` | `boolean` | `false` | Relaxed field spacing |

## Structure

```svelte
<Fieldset legend="Personal Information">
  <Input label="First Name" />
  <Input label="Last Name" />
  <Input label="Email" type="email" />
</Fieldset>
```

### HTML Output
```html
<fieldset>
  <legend>Personal Information</legend>
  <div class="fieldset-content">
    <!-- inputs -->
  </div>
</fieldset>
```

## Layout

### Vertical (Default)
- Fields stack vertically
- Consistent spacing
- Full width

### Grid
```svelte
<Fieldset legend="Address" layout="grid" columns={2}>
  <Input label="Street" gridColumn="1 / -1" />
  <Input label="City" />
  <Input label="State" />
</Fieldset>
```

## Delightful Details

### Disabled Cascade
- Setting `disabled` on fieldset disables all children
- Visual indication of disabled group
- Semantic HTML handled

### Error Handling
- Group error shown below legend
- Or: individual field errors
- Clear error states

### Collapsible (Optional)
```svelte
<Fieldset legend="Advanced Options" collapsible>
  ...
</Fieldset>
```
- Click legend to expand/collapse
- Smooth animation
- Remember state

### Required Indicator
- Asterisk on legend if required
- Indicates at least one field required
- Proper ARIA

## Accessibility

- Semantic `<fieldset>` and `<legend>`
- Proper grouping for screen readers
- Disabled state announced
- Error association

## Code Example

```svelte
<script>
  import { Fieldset, Input } from '@delightstack/components';
</script>

<form>
  <Fieldset legend="Account Information" variant="card">
    <Input label="Username" required />
    <Input label="Email" type="email" required />
    <Input label="Password" type="password" required />
  </Fieldset>

  <Fieldset legend="Profile" description="This information is public">
    <Input label="Display Name" />
    <Input label="Bio" type="textarea" />
  </Fieldset>

  <Fieldset
    legend="Address"
    layout="grid"
    columns={2}
    variant="bordered"
  >
    <Input label="Street Address" gridColumn="1 / -1" />
    <Input label="City" />
    <Input label="State" />
    <Input label="ZIP Code" />
    <Input label="Country" />
  </Fieldset>
</form>
```

## Implementation Notes

- Use native `<fieldset>` for semantics
- Handle disabled state propagation
- Support both controlled and layout usage
- CSS Grid for layout variant
- Consistent spacing with form elements
