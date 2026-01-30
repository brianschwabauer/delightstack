# Tooltip

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Tooltip.svelte`

## Description

A small contextual popup that appears on hover or focus to provide additional information. Lightweight alternative to a full popover, designed for brief text hints.

## Visual Design

### Appearance
- Small, compact container
- Dark background (default) for contrast
- White text
- Small arrow pointing to trigger
- Rounded corners

### Variants

| Variant | Background | Use Case |
|---------|------------|----------|
| `dark` | Dark gray/black | Default, high contrast |
| `light` | White/light | On dark backgrounds |
| `action` | Action color | Emphasize tooltips |

### Sizes

| Size | Max Width | Font Size |
|------|-----------|-----------|
| `sm` | 150px | 12px |
| `md` | 200px | 13px |
| `lg` | 300px | 14px |

## API

### Svelte Action (Recommended)
```svelte
<script>
  import { tooltip } from '@delightstack/components';
</script>

<button use:tooltip={'Save your changes'}>
  <SaveIcon />
</button>
```

### Component API
```svelte
<Tooltip content="Save your changes">
  <button>
    <SaveIcon />
  </button>
</Tooltip>
```

## Props

### Action Options
```typescript
use:tooltip={options}

interface TooltipOptions {
  content: string;
  placement?: Placement;
  delay?: number;
  variant?: 'dark' | 'light' | 'action';
  maxWidth?: number;
}
```

### Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string` | required | Tooltip text |
| `placement` | `Placement` | `'top'` | Position |
| `delay` | `number` | `200` | Show delay (ms) |
| `variant` | `Variant` | `'dark'` | Visual style |
| `maxWidth` | `number` | `200` | Max width (px) |
| `disabled` | `boolean` | `false` | Disable tooltip |

## Placement Options

```
        top-start    top    top-end
              ╲       │       ╱
    left-start ─┌─────────────┐─ right-start
          left ─│   trigger   │─ right
      left-end ─└─────────────┘─ right-end
              ╱       │       ╲
     bottom-start  bottom  bottom-end
```

## Behavior

### Show Conditions
- Mouse hover (after delay)
- Keyboard focus
- Touch: long-press (optional)

### Hide Conditions
- Mouse leaves
- Focus lost
- Escape key
- Scroll (configurable)

### Smart Positioning
- Flips to opposite side if not enough space
- Stays within viewport
- Arrow adjusts position

## Delightful Details

### Smooth Transitions
- Fade in with slight scale
- Origin from trigger direction
- Quick and snappy (150ms)

### Hover Delay
- Prevents tooltip flicker
- 200ms delay (configurable)
- Instant hide on leave

### Arrow Tracking
- Arrow points to trigger center
- Adjusts as tooltip flips/shifts
- Crisp CSS triangle

### Touch Support
- Long-press to show (500ms)
- Tap elsewhere to dismiss
- No accidental triggers

### Follow Cursor (Optional)
```svelte
<button use:tooltip={{ content: 'Move me', followCursor: true }}>
```
- Tooltip follows mouse
- Good for large trigger areas

## Accessibility

- `role="tooltip"`
- `aria-describedby` on trigger
- Focus triggers tooltip
- Keyboard dismissible (Escape)

## Code Example

```svelte
<script>
  import { tooltip, Tooltip } from '@delightstack/components';
</script>

<!-- Simple action usage -->
<button use:tooltip="Save changes">
  <SaveIcon />
</button>

<!-- With options -->
<button use:tooltip={{
  content: 'Delete this item permanently',
  placement: 'bottom',
  variant: 'light'
}}>
  <DeleteIcon />
</button>

<!-- Component usage for complex content -->
<Tooltip placement="right">
  <IconButton>
    <InfoIcon />
  </IconButton>
  {#snippet content()}
    <strong>Pro tip:</strong>
    Use keyboard shortcuts for faster navigation.
  {/snippet}
</Tooltip>

<!-- On disabled elements -->
<span use:tooltip="You don't have permission">
  <button disabled>Edit</button>
</span>
```

## Integration with Button

The Button component has built-in tooltip support:
```svelte
<Button tooltip="Save your work" icon={SaveIcon} />
```

## Implementation Notes

- Use Floating UI for positioning
- Single tooltip instance (performance)
- Clean up on element removal
- Handle dynamic content updates
- Support HTML content (component API)
