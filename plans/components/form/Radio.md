# Radio

**Category**: Form
**Files**: `packages/components/src/form/Radio.svelte`, `packages/components/src/form/RadioGroup.svelte`

## Dependencies

- None (standalone components)

## Description

A styled radio button for single-selection within a group. Features a hidden native input with a custom styled circular indicator and a dot scale animation on selection. Can be used standalone or within a RadioGroup that coordinates selection via `setContext`/`getContext`. RadioGroup supports horizontal and vertical layouts.

## Visual Design

### Appearance
- Circular indicator with border
- Inner dot appears on selection with scale animation
- Label to the right
- Matches Checkbox styling conventions

### States
- **Unselected**: Empty circle, `--color-border` border
- **Selected**: `--color-action` border, filled center dot
- **Focused**: Focus ring (`--color-focus-ring`)
- **Disabled**: Reduced opacity (0.5), `cursor: not-allowed`
- **Error**: Circle border `--color-error`

### Sizes

| Size | Circle Size | Font Size |
|------|-------------|-----------|
| `'0'` | 16px | 13px |
| `'1'` (default) | 20px | 15px |
| `'2'` | 24px | 17px |
| `'3'` | 28px | 19px |

## Radio Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | required | Option value |
| `checked` | `boolean` | - | Selected state (`$bindable()`) |
| `disabled` | `boolean` | `false` | Disable option |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Radio size |
| `label` | `string` | - | Label text |
| `description` | `string` | - | Helper text below label |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Tighter label/circle spacing |
| `comfortable` | `boolean` | `false` | More label/circle spacing |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

## RadioGroup Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Selected value (`$bindable()`) |
| `name` | `string` | - | Shared group name |
| `disabled` | `boolean` | `false` | Disable all radio options |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Size for all child radios |
| `horizontal` | `boolean` | `false` | Horizontal layout (default is vertical) |
| `label` | `string` | - | Group label |
| `error` | `string` | - | Group-level error message |
| `required` | `boolean` | `false` | Selection is required |
| `dense` | `boolean` | `false` | Compact spacing between options |
| `comfortable` | `boolean` | `false` | Relaxed spacing between options |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

### Radio
| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Selection changed |

### RadioGroup
| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Selection changed |

## Context Communication

RadioGroup uses `setContext` to provide group state to child Radio components:

```typescript
interface RadioGroupContext {
  value: any;
  disabled: boolean;
  size: string;
  name: string;
  select: (childValue: any) => void;
  isSelected: (childValue: any) => boolean;
}
```

A Radio calls `getContext` on mount. If a group context exists, the Radio delegates its selection to the group. If no context exists, it operates standalone with its own `checked` prop.

## Usage Patterns

### With RadioGroup (Vertical)
```svelte
<RadioGroup bind:value={size} name="size" label="Size">
  <Radio value="small" label="Small" />
  <Radio value="medium" label="Medium" />
  <Radio value="large" label="Large" />
</RadioGroup>
```

### Horizontal Layout
```svelte
<RadioGroup horizontal bind:value={preference} name="preference">
  <Radio value="yes" label="Yes" />
  <Radio value="no" label="No" />
  <Radio value="maybe" label="Maybe" />
</RadioGroup>
```

### Standalone
```svelte
<Radio
  value="option1"
  checked={selected === 'option1'}
  onchange={() => selected = 'option1'}
  label="Option 1"
/>
```

### With Descriptions
```svelte
<RadioGroup bind:value={plan} name="plan" label="Select a plan">
  <Radio value="free" label="Free" description="Basic features, forever free" />
  <Radio value="pro" label="Pro" description="Advanced features, $10/mo" />
  <Radio value="enterprise" label="Enterprise" description="Custom pricing" />
</RadioGroup>
```

### With Error
```svelte
<RadioGroup
  bind:value={agreement}
  required
  error={!agreement ? 'Please select an option' : ''}
>
  <Radio value="agree" label="I agree" />
  <Radio value="disagree" label="I disagree" />
</RadioGroup>
```

## Styling

All colors use `--color-*` tokens:
- Border: `--color-border`
- Selected border and dot: `--color-action`
- Error: `--color-error`
- Focus ring: `--color-focus-ring`
- Label: `--color-text`
- Description: `--color-text-muted`
- Disabled: opacity 0.5 applied to wrapper

## Delightful Details

### Dot Scale Animation
- Inner dot scales from 0 to 1 on selection
- Uses CSS `transform: scale()` with `ease-out` timing (200ms)
- Slight overshoot (scale to 1.15 then settle to 1.0) for a satisfying feel
- On deselect, dot scales down to 0

### Ripple Effect
- Subtle radial ripple on click, centered on radio circle
- Uses `--color-action` at low opacity
- Quick fade (200ms)

### Focus Ring
- 2px ring using `--color-focus-ring`
- Offset from circle edge
- Only on `:focus-visible` (keyboard)

### Hover State
- Subtle background circle appears behind radio on hover
- `cursor: pointer`
- Indicates interactivity

### Group Transitions
- When selection moves, previous dot scales out while new dot scales in simultaneously
- Creates a sense of the selection "moving" between options

## Accessibility

- Hidden native `<input type="radio">` positioned behind custom visual
- `aria-checked` reflects state
- `aria-describedby` for description and error
- `aria-required` when required
- Full keyboard navigation: Arrow keys move between options within group, Tab moves between groups
- RadioGroup rendered as `<div role="radiogroup">` with `aria-label`
- Screen reader announces selection changes

## Code Example

```svelte
<script>
  import { RadioGroup, Radio } from '@delightstack/components';

  let selectedSize = $state('medium');
  let paymentMethod = $state('');
</script>

<!-- Size selector -->
<RadioGroup bind:value={selectedSize} name="size" label="Size">
  <Radio value="small" label="Small" />
  <Radio value="medium" label="Medium" />
  <Radio value="large" label="Large" />
</RadioGroup>

<!-- Payment methods with descriptions -->
<RadioGroup bind:value={paymentMethod} name="payment" label="Payment method">
  <Radio
    value="card"
    label="Credit Card"
    description="Visa, Mastercard, American Express"
  />
  <Radio
    value="paypal"
    label="PayPal"
    description="Pay with your PayPal account"
  />
  <Radio
    value="bank"
    label="Bank Transfer"
    description="Direct bank transfer"
  />
</RadioGroup>

<!-- Horizontal with tooltip -->
<RadioGroup horizontal bind:value={answer} name="answer">
  <Radio value="yes" label="Yes" tooltip="Confirm your selection" />
  <Radio value="no" label="No" />
</RadioGroup>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `checked` (Radio) and `value` (RadioGroup)
- Uses `$state()` for internal reactive state
- Hidden native `<input type="radio">` for form submission and accessibility
- RadioGroup uses `setContext()` / child Radio uses `getContext()`
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- CSS `transform: scale()` for dot animation with `transition` property
