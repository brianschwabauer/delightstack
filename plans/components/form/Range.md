# Range

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Range.svelte`

## Description

A slider input for selecting a value or range within a specified interval. Custom-styled for consistency with the design system, with support for single values and range selection.

## Visual Design

### Track
- Horizontal line
- Fill color from start to thumb
- Subtle rounded ends

### Thumb
- Circular handle
- Elevated on hover
- Accent color

### Labels
- Min/max values at ends (optional)
- Current value display
- Step markers (optional)

### States
- **Default**: Accent fill, neutral empty
- **Hover**: Thumb enlarges
- **Dragging**: Thumb pressed, tooltip visible
- **Disabled**: Reduced opacity

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number \| [number, number]` | `0` | Current value (bindable) |
| `min` | `number` | `0` | Minimum value |
| `max` | `number` | `100` | Maximum value |
| `step` | `number` | `1` | Step increment |
| `range` | `boolean` | `false` | Enable range selection |
| `disabled` | `boolean` | `false` | Disable slider |
| `showValue` | `boolean` | `false` | Show value label |
| `showTicks` | `boolean` | `false` | Show step markers |
| `formatValue` | `(n: number) => string` | - | Value formatter |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Value changed (on release) |
| `oninput` | `{ value }` | Value changing (during drag) |

## Variants

### Single Value
```svelte
<Range bind:value={volume} />
```
- One thumb
- Value from min to thumb

### Range Selection
```svelte
<Range range bind:value={priceRange} min={0} max={1000} />
```
- Two thumbs
- Value is [min, max] tuple
- Highlighted region between

### With Steps
```svelte
<Range
  value={rating}
  min={1}
  max={5}
  step={1}
  showTicks
/>
```
- Discrete values only
- Tick marks visible
- Snaps to steps

## Delightful Details

### Smooth Interaction
- Thumb follows smoothly
- No lag or judder
- Precise control

### Value Tooltip
- Shows during drag
- Follows thumb
- Clean formatting

### Touch Support
- Large touch target
- Drag anywhere on track
- Haptic feedback (if available)

### Keyboard Navigation
- Arrow keys to adjust
- Page Up/Down for larger jumps
- Home/End for min/max

### Track Fill Animation
- Smooth fill transition
- Color indicates progress
- Feels responsive

### Hover Effects
- Thumb grows slightly
- Shadow appears
- Clear affordance

## Accessibility

- Native range semantics
- ARIA value announcements
- Keyboard fully functional
- Focus indicator

## Code Example

```svelte
<script>
  import { Range } from '@delightstack/components';

  let volume = $state(50);
  let priceRange = $state<[number, number]>([100, 500]);
  let quality = $state(3);
</script>

<!-- Basic slider -->
<Range bind:value={volume} showValue />

<!-- Price range -->
<Range
  range
  bind:value={priceRange}
  min={0}
  max={1000}
  step={50}
  formatValue={(v) => `$${v}`}
  showValue
/>

<!-- Rating-style -->
<Range
  bind:value={quality}
  min={1}
  max={5}
  step={1}
  showTicks
/>

<!-- Labeled slider -->
<div class="slider-field">
  <label for="opacity">Opacity</label>
  <Range
    id="opacity"
    bind:value={opacity}
    min={0}
    max={100}
  />
  <span>{opacity}%</span>
</div>
```

## Implementation Notes

- Custom rendering (not native range input)
- Handle touch and mouse events
- Calculate thumb position from value
- Support RTL layouts
- Proper z-index for overlapping thumbs (range)
