# Badge

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Badge.svelte`

## Description

A small status indicator component for highlighting counts, labels, or states. Used to draw attention to new items, show quantities, or indicate status with minimal visual footprint.

## Visual Design

### Default Appearance
- Small pill shape
- Solid background color
- White text
- Compact padding (4px 8px)
- Small font size

### Variants

| Variant | Background | Use Case |
|---------|------------|----------|
| `default` | `--color-action` | Primary badges |
| `accent` | `--color-accent` | Secondary highlights |
| `success` | `--color-success` | Positive status |
| `warning` | `--color-warning` | Attention needed |
| `error` | `--color-error` | Errors, alerts |
| `neutral` | `--color-surface-3` | Subtle labels |

### Styles

| Style | Appearance |
|-------|------------|
| `solid` | Filled background (default) |
| `outline` | Border only, transparent bg |
| `soft` | Low-opacity background |

### Sizes

| Size | Padding | Font Size |
|------|---------|-----------|
| `sm` | 2px 6px | 10px |
| `md` | 4px 8px | 12px |
| `lg` | 6px 12px | 14px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `'default'` | Color variant |
| `style` | `'solid' \| 'outline' \| 'soft'` | `'solid'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Badge size |
| `pill` | `boolean` | `true` | Fully rounded corners |
| `dot` | `boolean` | `false` | Show as dot only (no content) |
| `pulse` | `boolean` | `false` | Add pulse animation |
| `max` | `number` | `99` | Max number before "+" |

## Special Modes

### Dot Badge
```svelte
<Badge dot variant="error" />
```
- No content, just a colored dot
- Indicates presence/status
- 8px diameter

### Number Badge
```svelte
<Badge>42</Badge>
<Badge max={9}>15</Badge>  <!-- Shows "9+" -->
```
- Auto-truncates at `max`
- Shows "99+" for large numbers
- Minimum width for single digits

### Pulse Animation
```svelte
<Badge pulse variant="error">New</Badge>
```
- Subtle expanding ring animation
- Draws attention to updates
- Use sparingly

## Delightful Details

### Number Animation
- Count animates when value changes
- Subtle pop on increment
- Smooth transition

### Icon Support
```svelte
<Badge>
  <CheckIcon />
  Verified
</Badge>
```
- Icon + text layout
- Proper icon sizing
- Maintains alignment

### Positioning
When used on other components:
```svelte
<div class="icon-wrapper">
  <BellIcon />
  <Badge class="badge-position" dot variant="error" />
</div>

<style>
  .badge-position {
    position: absolute;
    top: -4px;
    right: -4px;
  }
</style>
```

## Accessibility

- Meaningful text for screen readers
- `aria-label` for icon-only badges
- Don't rely solely on color

## Code Example

```svelte
<script>
  import { Badge } from '@delightstack/components';
</script>

<!-- Status badges -->
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>

<!-- Notification count -->
<Badge>{unreadCount}</Badge>
<Badge max={99}>{messageCount}</Badge>

<!-- Outline style -->
<Badge variant="accent" style="outline">Beta</Badge>

<!-- Soft style -->
<Badge variant="neutral" style="soft">Draft</Badge>

<!-- In navigation -->
<nav>
  <a href="/inbox">
    Inbox
    {#if unread > 0}
      <Badge size="sm">{unread}</Badge>
    {/if}
  </a>
</nav>
```

## Implementation Notes

- Use `min-width` for consistent number display
- Animate number changes with CSS counter or JS
- Ensure sufficient color contrast
- Keep pulse animation subtle (reduce motion for a11y)
