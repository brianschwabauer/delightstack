# Comparison

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Comparison.svelte`

## Description

An interactive before/after image comparison slider. Users can drag a divider to reveal either side, perfect for showing transformations, edits, or A/B comparisons.

## Visual Design

### Container
- Fixed aspect ratio or explicit dimensions
- Both images fully visible area
- Clean edges with optional border

### Divider
- Vertical line with handle
- Centered handle element (circle or pill)
- Arrows indicating drag direction
- Semi-transparent or white for visibility

### Labels
- Optional "Before" / "After" labels
- Positioned in corners
- Subtle background for readability

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `before` | `string` | required | Before image URL |
| `after` | `string` | required | After image URL |
| `beforeAlt` | `string` | `'Before'` | Before image alt |
| `afterAlt` | `string` | `'After'` | After image alt |
| `position` | `number` | `50` | Initial position (0-100, bindable) |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Slider direction |
| `showLabels` | `boolean` | `true` | Show before/after labels |
| `labelBefore` | `string` | `'Before'` | Before label text |
| `labelAfter` | `string` | `'After'` | After label text |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ position }` | Position changed |

## Interaction

### Mouse/Touch Drag
- Drag handle to move divider
- Smooth, responsive tracking
- Contained within bounds

### Click to Move
- Click anywhere to jump divider to that position
- Optional: can be disabled

### Keyboard
- Focus on handle
- Arrow keys move incrementally
- Home/End for extremes

## Delightful Details

### Smooth Animations
- Initial position animates in
- Slight inertia on drag release
- Smooth position changes

### Handle Design
- Visible but not obtrusive
- Hover: slight scale up
- Active: pressed appearance
- Clear affordance to drag

### Loading States
- Skeleton while images load
- Progressive reveal when ready
- Handle appears last

### Hover Effects
- Divider line thickens slightly on hover
- Handle glows or elevates
- Cursor changes to indicate drag

### Edge Behavior
- Small padding at edges (can't go fully to 0 or 100)
- Or: snap back animation if dragged past

## Variants

### Horizontal (Default)
```svelte
<Comparison before={before} after={after} />
```
- Divider moves left/right
- Most common usage

### Vertical
```svelte
<Comparison
  before={before}
  after={after}
  orientation="vertical"
/>
```
- Divider moves up/down
- Good for tall images

## Accessibility

- Handle is focusable
- Keyboard controls for movement
- ARIA labels for images
- Instructions available

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
  orientation="vertical"
/>
```

## Implementation Notes

- Use CSS clip-path for image reveal
- Handle touch events properly
- Prevent image dragging
- Consider lazy loading images
- Ensure images are same dimensions
- Add resize observer for responsiveness
