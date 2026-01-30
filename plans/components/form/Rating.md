# Rating

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Rating.svelte`

## Description

A star rating input for collecting user ratings or displaying scores. Supports half-star precision, custom icons, and read-only display mode.

## Visual Design

### Appearance
- Row of star icons
- Filled vs empty states
- Consistent sizing and spacing
- Accent color for filled

### States
- **Empty**: Outline/muted stars
- **Filled**: Solid accent stars
- **Half**: Partially filled (gradient or overlay)
- **Hover**: Preview selection
- **Disabled**: Muted, no interaction

### Sizes

| Size | Icon Size | Spacing |
|------|-----------|---------|
| `sm` | 16px | 2px |
| `md` | 24px | 4px |
| `lg` | 32px | 6px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | `0` | Current rating (bindable) |
| `max` | `number` | `5` | Maximum stars |
| `precision` | `0.5 \| 1` | `1` | Half or whole stars |
| `size` | `Size` | `'md'` | Icon size |
| `readonly` | `boolean` | `false` | Display only |
| `disabled` | `boolean` | `false` | Disable input |
| `icon` | `Component` | StarIcon | Custom icon |
| `emptyIcon` | `Component` | - | Icon for empty state |
| `color` | `string` | - | Filled star color |
| `showValue` | `boolean` | `false` | Show numeric value |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Rating changed |
| `onhover` | `{ value }` | Hovering over rating |

## Features

### Half-Star Support
```svelte
<Rating precision={0.5} bind:value={rating} />
```
- Left half = 0.5, full star = 1.0
- Visual indication of half
- Precise hover detection

### Custom Icons
```svelte
<Rating
  icon={HeartIcon}
  emptyIcon={HeartOutlineIcon}
  bind:value={likes}
/>
```
- Any icon component
- Separate filled/empty icons

### Read-Only Display
```svelte
<Rating value={4.5} readonly />
```
- Shows rating without interaction
- For displaying average ratings

### With Count
```svelte
<Rating value={4.5} readonly />
<span>(128 reviews)</span>
```

## Delightful Details

### Hover Preview
- Stars fill as you hover
- Shows potential rating
- Clears on mouse leave

### Click Animation
- Brief scale pulse on select
- Stars fill with animation
- Satisfying feedback

### Color Transitions
- Smooth color change
- Fill animates left to right
- Feels responsive

### Touch Support
- Swipe to select rating
- Large touch targets
- Works on mobile

### Clear Action
- Click current rating to clear (optional)
- Or: explicit clear button
- Configurable behavior

## Accessibility

- Keyboard navigation (arrows)
- ARIA slider pattern
- Rating announced to screen readers
- Focus visible

## Code Example

```svelte
<script>
  import { Rating } from '@delightstack/components';

  let rating = $state(0);
  let averageRating = 4.3;
</script>

<!-- Interactive rating -->
<Rating bind:value={rating} />

<!-- With half-star precision -->
<Rating
  bind:value={rating}
  precision={0.5}
  showValue
/>

<!-- Display average (read-only) -->
<div class="average-rating">
  <Rating value={averageRating} readonly />
  <span>{averageRating} out of 5</span>
</div>

<!-- Custom hearts -->
<Rating
  bind:value={likes}
  max={3}
  icon={HeartIcon}
  emptyIcon={HeartOutlineIcon}
  color="var(--c-error)"
/>

<!-- Large for feedback forms -->
<Rating
  bind:value={satisfaction}
  size="lg"
/>
```

## Implementation Notes

- Use CSS clip-path for half stars
- Handle precise mouse position
- Support both click and drag
- Emit events appropriately
- Form integration (name attribute)
