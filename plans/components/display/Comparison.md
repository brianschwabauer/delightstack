# Comparison

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Comparison.svelte`

## Description

An interactive before/after image comparison slider. Users drag a divider to reveal either side, using CSS `clip-path` for the image reveal. Supports horizontal and vertical orientations. Ideal for showing transformations, edits, or A/B comparisons.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Container
- Fixed aspect ratio or explicit dimensions
- Both images visible in the same area, clipped by divider position
- Clean edges with optional border

### Divider
- Vertical (or horizontal) line with a draggable handle
- Centered handle element (circle with arrows)
- Arrows indicating drag direction
- Semi-transparent or white for visibility over any image

### Labels
- Optional "Before" / "After" labels
- Positioned in corners of the respective sides
- Subtle semi-transparent background for readability

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `before` | `string` | required | Before image URL |
| `after` | `string` | required | After image URL |
| `beforeAlt` | `string` | `'Before'` | Before image alt text |
| `afterAlt` | `string` | `'After'` | After image alt text |
| `position` | `number` | `50` | Divider position (0-100), bindable |
| `vertical` | `boolean` | `false` | Vertical orientation (divider moves up/down) |
| `showLabels` | `boolean` | `true` | Show before/after labels |
| `labelBefore` | `string` | `'Before'` | Before label text |
| `labelAfter` | `string` | `'After'` | After label text |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ position: number }` | Divider position changed |

## Interaction

### Mouse/Touch Drag
- Drag the handle to move the divider
- Smooth, responsive tracking (pointer events, not just mouse)
- Contained within the component bounds

### Click to Move
- Click anywhere in the component to jump the divider to that position
- Smooth animated transition to clicked position

### Keyboard
- Focus the handle via Tab
- Arrow Left/Right (horizontal) or Arrow Up/Down (vertical) moves in 1% increments
- Shift+Arrow moves in 10% increments
- Home: move to 0%
- End: move to 100%

## CSS Clip-Path Approach

The before image is displayed at full size. The after image overlays it with a `clip-path` that reveals only the portion to the right (or below) the divider:

```css
.comparison-after {
  position: absolute;
  inset: 0;
  clip-path: inset(0 0 0 var(--position));
}
```

For vertical orientation:
```css
.comparison-after {
  clip-path: inset(var(--position) 0 0 0);
}
```

## Skeleton State

When `skeleton` is true, render two side-by-side shimmering rectangles with a centered divider line. Matches the component dimensions.

## Accessibility

- Divider handle has `role="slider"` with `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`
- `aria-label="Image comparison slider"`
- Both images have descriptive alt text
- Keyboard controls for full operation without a pointer

## CSS Approach

```css
.comparison {
  position: relative;
  overflow: hidden;
  user-select: none;
  touch-action: none;
}

.comparison img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.comparison .divider {
  position: absolute;
  z-index: 2;
  cursor: col-resize;
}

.comparison.vertical .divider {
  cursor: row-resize;
}

.comparison .handle {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: white;
  box-shadow: var(--shadow-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
}

.comparison .handle:hover {
  transform: translate(-50%, -50%) scale(1.1);
}

.comparison .label {
  position: absolute;
  padding: 0.25rem 0.5rem;
  background: color-mix(in oklch, black, transparent 40%);
  color: white;
  font-size: var(--text-sm);
  border-radius: var(--radius-2);
}
```

## Code Example

```svelte
<script>
  import { Comparison } from '@delightstack/components';

  let position = $state(50);
</script>

<Comparison
  before="/images/photo-original.jpg"
  after="/images/photo-edited.jpg"
  beforeAlt="Original photo"
  afterAlt="Edited photo with filters applied"
  bind:position
/>

<!-- With custom labels -->
<Comparison
  before="/images/design-v1.png"
  after="/images/design-v2.png"
  labelBefore="Version 1"
  labelAfter="Version 2"
/>

<!-- Vertical comparison -->
<Comparison
  before="/images/before.jpg"
  after="/images/after.jpg"
  vertical
/>
```

## Implementation Notes

- Use CSS `clip-path: inset()` for the image reveal (GPU-accelerated, no repaints)
- Handle `pointermove` events on the container (not just the handle) for smooth dragging
- Prevent native image dragging with `draggable="false"` on images
- Both images must be the same dimensions for proper alignment
- Add `ResizeObserver` for responsive behavior when the container resizes
- `touch-action: none` on the container to prevent scroll interference on mobile
