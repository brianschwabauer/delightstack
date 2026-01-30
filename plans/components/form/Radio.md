# Radio

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Radio.svelte`

## Description

A styled radio button for single-selection within a group. Features custom styling with smooth animations while maintaining proper accessibility through native radio semantics.

## Visual Design

### Appearance
- Circular indicator
- Custom dot when selected
- Label to the right
- Matches checkbox styling conventions

### States
- **Unselected**: Empty circle, subtle border
- **Selected**: Filled center dot, accent border
- **Focused**: Focus ring
- **Disabled**: Reduced opacity

### Sizes

| Size | Circle Size | Font Size |
|------|-------------|-----------|
| `sm` | 16px | 14px |
| `md` | 20px | 16px |
| `lg` | 24px | 18px |

## Props

### Radio (Single Option)
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | required | Option value |
| `checked` | `boolean` | - | Selected state (bindable) |
| `disabled` | `boolean` | `false` | Disable option |
| `size` | `Size` | `'md'` | Radio size |
| `label` | `string` | - | Label text |
| `description` | `string` | - | Helper text |

### RadioGroup (Container)
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Selected value (bindable) |
| `name` | `string` | - | Group name |
| `disabled` | `boolean` | `false` | Disable all |
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout |
| `error` | `string` | - | Error message |
| `dense` | `boolean` | `false` | Compact option spacing |
| `comfortable` | `boolean` | `false` | Relaxed option spacing |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Selection changed |

## Usage Patterns

### With RadioGroup
```svelte
<RadioGroup bind:value={size} name="size">
  <Radio value="small" label="Small" />
  <Radio value="medium" label="Medium" />
  <Radio value="large" label="Large" />
</RadioGroup>
```

### Standalone (Manual)
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
<RadioGroup bind:value={plan}>
  <Radio value="free" label="Free" description="Basic features, forever free" />
  <Radio value="pro" label="Pro" description="Advanced features, $10/mo" />
  <Radio value="enterprise" label="Enterprise" description="Custom pricing" />
</RadioGroup>
```

### Horizontal Layout
```svelte
<RadioGroup direction="horizontal" bind:value={preference}>
  <Radio value="yes" label="Yes" />
  <Radio value="no" label="No" />
  <Radio value="maybe" label="Maybe" />
</RadioGroup>
```

## Delightful Details

### Selection Animation
- Dot scales from center
- Smooth easing
- Satisfying feel

### Ripple Effect
- Subtle ripple on click
- Centered on radio circle
- Quick fade

### Focus Ring
- Clear keyboard focus
- Not too prominent
- Matches checkbox style

### Hover State
- Subtle scale on hover
- Cursor pointer
- Indicates interactivity

### Group Transitions
- Selection moves smoothly between options
- Previous deselects as new selects

## Accessibility

- Native radio input (visually hidden)
- Custom visual layer
- Full keyboard navigation
- Proper ARIA states
- RadioGroup provides context

## Code Example

```svelte
<script>
  import { RadioGroup, Radio } from '@delightstack/components';

  let selectedSize = $state('medium');
  let paymentMethod = $state('');
</script>

<!-- Size selector -->
<RadioGroup bind:value={selectedSize} name="size">
  <Radio value="small" label="Small" />
  <Radio value="medium" label="Medium" />
  <Radio value="large" label="Large" />
</RadioGroup>

<!-- Payment methods with descriptions -->
<RadioGroup bind:value={paymentMethod} name="payment">
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

<!-- With error -->
<RadioGroup
  bind:value={agreement}
  error={!agreement ? 'Please select an option' : ''}
>
  <Radio value="agree" label="I agree" />
  <Radio value="disagree" label="I disagree" />
</RadioGroup>
```

## Implementation Notes

- Use hidden native radio for accessibility
- Context API for group management
- Support both grouped and standalone usage
- Handle dynamic option changes
- Proper form integration
