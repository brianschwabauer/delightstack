# Fieldset

**Category**: Form
**File**: `packages/components/src/form/Fieldset.svelte`

## Dependencies

- None (standalone component)

## Description

A grouping component for related form fields using semantic `<fieldset>` and `<legend>` HTML elements. Provides visual structure, shared disabled state, and optional grid layout for arranging form fields. Supports multiple visual styles via boolean props: default (no visible border), bordered, card, and filled.

## Visual Design

### Appearance
- Semantic `<fieldset>` wrapper with `<legend>` for title
- Consistent internal spacing between child fields
- Clear visual grouping that can be invisible (default) or emphasized

### Visual Styles

| Style | Appearance |
|-------|------------|
| default (no boolean set) | No visible container, just spacing and legend |
| `bordered` | Subtle `--color-border` border, rounded corners |
| `card` | Card-style with `--shadow-sm`, `--color-surface` background |
| `filled` | Light background fill using `color-mix(in oklch, var(--color-surface-alt), transparent 50%)` |

### States
- **Default**: Legend visible, fields stacked
- **Disabled**: All child fields disabled, reduced opacity (0.6)
- **Error**: Group-level error message below legend
- **Skeleton**: Pulsing legend placeholder and field-shaped skeletons
- **Collapsible**: Clickable legend toggles content visibility

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `legend` | `string` | - | Section title rendered as `<legend>` |
| `description` | `string` | - | Helper text below legend |
| `bordered` | `boolean` | `false` | Subtle border style |
| `card` | `boolean` | `false` | Card style with shadow |
| `filled` | `boolean` | `false` | Light background fill style |
| `disabled` | `boolean` | `false` | Disable all child fields |
| `error` | `string` | - | Group-level error message |
| `required` | `boolean` | `false` | Mark section as required (asterisk on legend) |
| `collapsible` | `boolean` | `false` | Allow collapsing the content |
| `collapsed` | `boolean` | `false` | Initial/controlled collapsed state (`$bindable()`) |
| `grid` | `boolean` | `false` | Enable CSS Grid layout for children |
| `columns` | `number` | `2` | Number of grid columns (when `grid` is true) |
| `skeleton` | `boolean` | `false` | Show skeleton loading state |
| `dense` | `boolean` | `false` | Compact spacing between fields |
| `comfortable` | `boolean` | `false` | Relaxed spacing between fields |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

Only one of `bordered`, `card`, or `filled` should be true at a time. If none is set, the default style (no visible container) is used.

## Snippets

| Snippet | Parameter | Description |
|---------|-----------|-------------|
| `children` | - | Default content (form fields) |

## Structure

### HTML Output
```html
<fieldset class="fieldset bordered">
  <legend>Personal Information</legend>
  <p class="fieldset-description">Fill in your details below</p>
  <div class="fieldset-content">
    <!-- child form fields -->
  </div>
</fieldset>
```

### Error Output
```html
<fieldset class="fieldset" aria-describedby="fieldset-error-1">
  <legend>Permissions <span class="required">*</span></legend>
  <div class="fieldset-content">...</div>
  <p class="fieldset-error" id="fieldset-error-1">Select at least one permission</p>
</fieldset>
```

## Usage Patterns

### Default (No Border)
```svelte
<Fieldset legend="Personal Information">
  <Input label="First Name" name="firstName" />
  <Input label="Last Name" name="lastName" />
  <Input label="Email" type="email" name="email" />
</Fieldset>
```

### Bordered
```svelte
<Fieldset bordered legend="Account Settings">
  <Input label="Username" name="username" required />
  <Input label="Password" type="password" name="password" required />
</Fieldset>
```

### Card Style
```svelte
<Fieldset card legend="Payment Information">
  <Input label="Card Number" name="cardNumber" mask="#### #### #### ####" />
  <Input label="Expiry" name="expiry" mask="##/##" />
  <Input label="CVV" name="cvv" mask="###" />
</Fieldset>
```

### Filled
```svelte
<Fieldset filled legend="Optional Details">
  <Input label="Nickname" name="nickname" />
  <Input label="Bio" type="textarea" name="bio" />
</Fieldset>
```

### Grid Layout
```svelte
<Fieldset legend="Address" grid columns={2}>
  <Input label="Street Address" name="street" style="grid-column: 1 / -1" />
  <Input label="City" name="city" />
  <Input label="State" name="state" />
  <Input label="ZIP Code" name="zip" />
  <Input label="Country" name="country" />
</Fieldset>
```
- Uses CSS Grid with `gap` for spacing
- Children can span columns via `style="grid-column: 1 / -1"`

### Collapsible
```svelte
<Fieldset legend="Advanced Options" collapsible bind:collapsed>
  <Input label="Custom Domain" name="domain" />
  <Toggle bind:checked={enableApi} label="Enable API Access" name="api" />
</Fieldset>
```
- Click legend to expand/collapse
- Chevron icon rotates to indicate state
- Smooth height animation (uses CSS grid row trick or Expand component)

### With Skeleton
```svelte
<Fieldset skeleton={isLoading} legend="User Profile">
  <Input label="Name" name="name" skeleton={isLoading} />
  <Input label="Email" name="email" skeleton={isLoading} />
</Fieldset>
```

## Styling

All colors use `--color-*` tokens:
- Default: no border or background
- Bordered: `1px solid var(--color-border)`, `border-radius: var(--radius-md)`
- Card: `--color-surface` background, `--shadow-sm` shadow, `border-radius: var(--radius-lg)`
- Filled: `color-mix(in oklch, var(--color-surface-alt), transparent 50%)` background
- Legend: `--color-text`, `font-weight: 600`
- Description: `--color-text-muted`
- Error: `--color-error`
- Required asterisk: `--color-error`
- Disabled: opacity 0.6 on entire fieldset

Dark mode handled via `light-dark()` for backgrounds.

## Delightful Details

### Disabled Cascade
- Setting `disabled` on fieldset disables all child `<input>`, `<select>`, `<textarea>` natively
- Visual indication: entire fieldset at reduced opacity
- Semantic: native HTML `<fieldset disabled>` behavior

### Error Handling
- Group-level error shown below content area
- Error message fades in (150ms)
- Red left border accent when error is present

### Collapsible Animation
- Content height animates smoothly (250ms ease-out)
- Chevron icon rotates 180 degrees
- Content fades slightly during collapse

### Required Indicator
- Red asterisk (*) after legend text
- `aria-required="true"` on fieldset

### Grid Layout
- Responsive: columns collapse to 1 on narrow containers
- Uses `gap` for consistent spacing matching `dense`/`comfortable` props
- Children naturally fill grid cells

## Accessibility

- Semantic `<fieldset>` and `<legend>` elements
- `aria-describedby` linking to description and error
- `aria-required` when `required`
- `aria-disabled` when disabled
- Collapsible: legend is a `<button>` with `aria-expanded`
- Screen readers announce the group name and state
- Native disabled propagation to all child form controls

## Code Example

```svelte
<script>
  import { Fieldset, Input, Toggle } from '@delightstack/components';

  let collapsed = $state(false);
</script>

<form>
  <Fieldset card legend="Account Information">
    <Input label="Username" name="username" required />
    <Input label="Email" type="email" name="email" required />
    <Input label="Password" type="password" name="password" required />
  </Fieldset>

  <Fieldset legend="Profile" description="This information is public">
    <Input label="Display Name" name="displayName" />
    <Input label="Bio" type="textarea" name="bio" />
  </Fieldset>

  <Fieldset bordered legend="Address" grid columns={2}>
    <Input label="Street" name="street" style="grid-column: 1 / -1" />
    <Input label="City" name="city" />
    <Input label="State" name="state" />
    <Input label="ZIP" name="zip" />
    <Input label="Country" name="country" />
  </Fieldset>

  <Fieldset
    legend="Advanced Options"
    collapsible
    bind:collapsed
    filled
  >
    <Input label="Custom Domain" name="domain" />
    <Toggle label="Enable API Access" name="api" />
  </Fieldset>
</form>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `collapsed`
- Uses `$state()` for internal reactive state
- Native `<fieldset>` element for semantic grouping and native disabled propagation
- Native `<legend>` for accessible section labeling
- CSS Grid layout activated by `grid` boolean prop
- Collapsible uses `<button>` inside `<legend>` for click handling
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- Variant booleans (`bordered`, `card`, `filled`) add CSS classes; only one active at a time
- `{@render children()}` for default slot content
