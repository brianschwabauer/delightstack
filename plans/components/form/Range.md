# Range

**Category**: Form
**File**: `packages/components/src/form/Range.svelte`

## Dependencies

- None (standalone component)

## Description

A slider input for selecting a value or range within a specified interval. Custom-styled for consistency with the design system. Supports single thumb mode and two-thumb range mode for selecting a range. Features custom tick labels, a value tooltip that follows the thumb, and step snapping.

## Visual Design

### Track
- Horizontal line with rounded ends
- Fill color from start to thumb (single) or between thumbs (range)
- Track uses `--color-surface-alt` for empty, `--color-action` for filled

### Thumb
- Circular handle with `--color-action` fill
- Elevated shadow on hover
- Grows slightly on hover/drag

### Labels
- Min/max values at ends (optional)
- Value tooltip floats above thumb during drag
- Custom tick labels at step positions

### States
- **Default**: `--color-action` fill, `--color-surface-alt` empty track
- **Hover**: Thumb enlarges, shadow appears
- **Dragging**: Thumb pressed style, value tooltip visible
- **Disabled**: Reduced opacity (0.5), no interaction

### Sizes

| Size | Track Height | Thumb Size |
|------|-------------|------------|
| `'0'` | 3px | 14px |
| `'1'` (default) | 4px | 20px |
| `'2'` | 6px | 26px |
| `'3'` | 8px | 32px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number \| [number, number]` | `0` | Current value (`$bindable()`). Tuple for range mode |
| `min` | `number` | `0` | Minimum value |
| `max` | `number` | `100` | Maximum value |
| `step` | `number` | `1` | Step increment |
| `range` | `boolean` | `false` | Enable two-thumb range selection |
| `disabled` | `boolean` | `false` | Disable slider |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Slider size |
| `showValue` | `boolean` | `false` | Show value tooltip above thumb |
| `showTicks` | `boolean` | `false` | Show step tick marks on track |
| `tickLabels` | `Record<number, string>` | - | Custom labels at tick positions (e.g. `{ 0: 'Low', 50: 'Medium', 100: 'High' }`) |
| `formatValue` | `(n: number) => string` | - | Value formatter for display |
| `label` | `string` | - | Accessible label text |
| `tooltip` | `string` | - | Tooltip on the overall component via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Tighter vertical spacing |
| `comfortable` | `boolean` | `false` | More vertical spacing |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Value changed (on release) |
| `oninput` | `{ value }` | Value changing (during drag) |

## Usage Patterns

### Single Value
```svelte
<Range bind:value={volume} showValue />
```
- One thumb
- Fill from min to thumb position

### Range Selection (Two Thumbs)
```svelte
<Range range bind:value={priceRange} min={0} max={1000} step={50} />
```
- Two thumbs define a range
- Value is `[min, max]` tuple
- Highlighted region between thumbs
- Thumbs cannot cross each other

### With Steps and Ticks
```svelte
<Range
  bind:value={rating}
  min={1}
  max={5}
  step={1}
  showTicks
/>
```
- Discrete values only
- Tick marks at each step position
- Thumb snaps to steps

### Custom Tick Labels
```svelte
<Range
  bind:value={difficulty}
  min={0}
  max={100}
  step={25}
  showTicks
  tickLabels={{
    0: 'Easy',
    25: 'Medium',
    50: 'Hard',
    75: 'Expert',
    100: 'Impossible'
  }}
/>
```
- Text labels rendered below tick marks
- Labels positioned at their corresponding values
- Labels use `--color-text-muted`

### Value Tooltip
```svelte
<Range
  bind:value={price}
  min={0}
  max={1000}
  showValue
  formatValue={(v) => `$${v}`}
/>
```
- Tooltip floats above the thumb
- Follows thumb position during drag
- Shows formatted value
- Fades in on hover/drag, fades out on release

### Labeled Slider
```svelte
<Range
  label="Opacity"
  bind:value={opacity}
  min={0}
  max={100}
  formatValue={(v) => `${v}%`}
  showValue
/>
```

## Styling

All colors use `--color-*` tokens:
- Empty track: `--color-surface-alt`
- Filled track: `--color-action`
- Thumb: `--color-action`
- Thumb border: white with shadow
- Tick marks: `--color-border`
- Tick labels: `--color-text-muted`
- Value tooltip background: `--color-surface-elevated`
- Value tooltip text: `--color-text`
- Focus ring: `--color-focus-ring`
- Disabled: opacity 0.5

Dark mode handled via `light-dark()` for track and tooltip backgrounds.

## Delightful Details

### Smooth Interaction
- Thumb follows cursor/touch precisely with no lag
- Uses `pointer events` for unified mouse/touch handling
- `requestAnimationFrame` for smooth position updates

### Value Tooltip
- Appears on hover and during drag
- Positioned directly above active thumb
- Follows thumb smoothly as it moves
- Fade in/out transition (150ms)
- Rounded rectangle with subtle shadow

### Touch Support
- Large touch target (44px minimum)
- Can tap anywhere on track to jump to value
- Drag from any thumb to adjust
- Haptic feedback on step snap (if available via `navigator.vibrate`)

### Keyboard Navigation
- Arrow Left/Down: decrease by step
- Arrow Right/Up: increase by step
- Page Up/Down: increase/decrease by 10 steps
- Home: set to min
- End: set to max
- Tab moves between thumbs in range mode

### Track Fill Animation
- Smooth transition on fill width (100ms)
- Color indicates progress region

### Hover Effects
- Thumb scales up (1.0 -> 1.2) on hover
- Shadow appears on hover
- Thumb returns to normal on mouse leave

### Range Thumb Overlap
- When range thumbs are close, the active thumb gets a higher z-index
- Visual indication of which thumb is being dragged

## Accessibility

- Uses `role="slider"` on each thumb
- `aria-valuemin`, `aria-valuemax`, `aria-valuenow` set on thumb
- `aria-valuetext` uses `formatValue` output for screen readers
- `aria-label` from `label` prop
- Full keyboard navigation
- Focus ring on active thumb (`:focus-visible`)
- Range mode: two sliders with `aria-label` "Minimum" and "Maximum"

## Code Example

```svelte
<script>
  import { Range } from '@delightstack/components';

  let volume = $state(50);
  let priceRange = $state<[number, number]>([100, 500]);
  let quality = $state(3);
</script>

<!-- Basic slider with value tooltip -->
<Range bind:value={volume} showValue label="Volume" />

<!-- Price range with two thumbs -->
<Range
  range
  bind:value={priceRange}
  min={0}
  max={1000}
  step={50}
  formatValue={(v) => `$${v}`}
  showValue
  label="Price range"
/>

<!-- Rating-style with ticks -->
<Range
  bind:value={quality}
  min={1}
  max={5}
  step={1}
  showTicks
  label="Quality"
/>

<!-- Custom tick labels -->
<Range
  bind:value={difficulty}
  min={0}
  max={100}
  step={25}
  showTicks
  tickLabels={{
    0: 'Low',
    25: 'Medium',
    50: 'High',
    75: 'Very High',
    100: 'Max'
  }}
  label="Difficulty"
  tooltip="Adjust the difficulty level"
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `value`
- Uses `$state()` for internal reactive state (dragging, hover, active thumb)
- Custom rendering (not native `<input type="range">`)
- Hidden `<input>` for form submission with `name` prop
- Pointer events for unified mouse/touch handling
- Calculate thumb position as percentage: `(value - min) / (max - min) * 100`
- Range mode: two thumb elements, fill between them
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- Proper z-index management for overlapping thumbs in range mode
- RTL support via CSS logical properties
- `{@attach tooltip()}` for component-level tooltip when `tooltip` prop is set
