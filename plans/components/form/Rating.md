# Rating

**Category**: Form
**File**: `packages/components/src/form/Rating.svelte`

## Dependencies

- None (standalone component; uses inline SVG for default star icon)

## Description

A star rating input for collecting user ratings or displaying scores. Supports half-star precision, custom icons (replace stars with hearts, flames, etc.), keyboard accessibility with arrow keys, and a read-only mode for display. Form-integrated via `name` prop.

## Visual Design

### Appearance
- Row of icon shapes (stars by default)
- Filled vs empty states with distinct colors
- Consistent sizing and spacing
- Accent color for filled icons

### States
- **Empty**: Outline/muted icons using `--color-border`
- **Filled**: Solid icons using `--color-warning` (gold/amber for stars)
- **Half**: Left half filled via CSS `clip-path`
- **Hover**: Preview of potential rating, filled icons up to cursor position
- **Disabled**: Reduced opacity (0.5), no interaction
- **Read-only**: Shows rating without interaction, no hover preview

### Sizes

| Size | Icon Size | Spacing |
|------|-----------|---------|
| `'0'` | 16px | 2px |
| `'1'` (default) | 24px | 4px |
| `'2'` | 32px | 6px |
| `'3'` | 40px | 8px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | `0` | Current rating (`$bindable()`) |
| `max` | `number` | `5` | Maximum number of icons |
| `precision` | `0.5 \| 1` | `1` | Half or whole icon precision |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Icon size |
| `readonly` | `boolean` | `false` | Display only, no interaction |
| `disabled` | `boolean` | `false` | Disable input |
| `icon` | `Component` | `StarIcon` | Custom icon component for filled state |
| `emptyIcon` | `Component` | - | Custom icon for empty state (defaults to outline version of `icon`) |
| `color` | `string` | - | Override filled icon color (CSS value, e.g. `'var(--color-error)'`) |
| `showValue` | `boolean` | `false` | Show numeric value text beside icons |
| `clearable` | `boolean` | `false` | Allow clicking current rating to clear (set to 0) |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Tighter spacing between icons |
| `comfortable` | `boolean` | `false` | More spacing between icons |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Rating changed |
| `onhover` | `{ value }` | Hovering over a rating value |

## Usage Patterns

### Basic Rating
```svelte
<Rating bind:value={rating} />
```

### Half-Star Precision
```svelte
<Rating precision={0.5} bind:value={rating} showValue />
```
- Left half of icon = 0.5 increment
- Right half or full icon = 1.0 increment
- Visual indication via CSS `clip-path` on half-filled icons
- Precise hover detection based on cursor x-position within each icon

### Custom Icons
```svelte
<Rating
  icon={HeartIcon}
  emptyIcon={HeartOutlineIcon}
  color="var(--color-error)"
  bind:value={likes}
  max={3}
/>
```
- Any Svelte component as icon
- Separate filled/empty icon components
- Custom color overrides the default

### Read-Only Display
```svelte
<Rating value={4.5} readonly />
```
- Shows rating without any interaction
- No hover preview, no cursor pointer
- For displaying average ratings, review scores, etc.

### With Numeric Value
```svelte
<div class="rating-display">
  <Rating value={4.3} readonly showValue />
  <span>(128 reviews)</span>
</div>
```
- `showValue` displays the numeric value (e.g. "4.3") beside the icons

### Clearable
```svelte
<Rating bind:value={rating} clearable />
```
- Clicking the currently selected rating clears it to 0
- Allows "no rating" state

## Styling

All colors use `--color-*` tokens:
- Empty icon: `--color-border`
- Filled icon: `--color-warning` (default gold/amber for stars)
- Custom color: overrides via `color` prop
- Hover preview: slightly reduced opacity on preview fill
- Focus ring: `--color-focus-ring`
- Disabled: opacity 0.5
- Value text: `--color-text-muted`

Dark mode handled via `light-dark()` for empty icon color.

## Delightful Details

### Hover Preview
- Icons fill as you move cursor across them
- Shows potential rating before committing
- Clears preview on mouse leave, reverting to actual value
- Smooth transition between preview states

### Click Animation
- Brief scale pulse on the selected icon (1.0 -> 1.2 -> 1.0, 200ms)
- Icons fill with a left-to-right stagger (each icon 30ms delay)
- Satisfying visual feedback

### Color Transitions
- Smooth color change on fill/unfill (150ms)
- Fill animates left to right on hover
- Feels responsive and fluid

### Touch Support
- Swipe across icons to select rating
- Large touch targets (minimum 44px)
- Works on mobile with touch events

### Half-Star Visual
- Uses CSS `clip-path: inset(0 50% 0 0)` for left half
- Overlay technique: empty icon behind, filled icon clipped on top
- Crisp rendering at all sizes

## Accessibility

- Uses `role="slider"` pattern on the container
- `aria-valuemin="0"`, `aria-valuemax` from `max` prop, `aria-valuenow` from `value`
- `aria-valuetext` (e.g. "3.5 out of 5 stars")
- `aria-label` from associated label or explicit prop
- Keyboard navigation:
  - Arrow Right / Arrow Up: increase by precision step
  - Arrow Left / Arrow Down: decrease by precision step
  - Home: set to 0 (or min)
  - End: set to max
  - Tab: focus/unfocus the rating component
- Focus ring visible on `:focus-visible`
- Read-only mode: `aria-readonly="true"`

## Code Example

```svelte
<script>
  import { Rating } from '@delightstack/components';
  import HeartIcon from '~icons/mdi/heart';
  import HeartOutlineIcon from '~icons/mdi/heart-outline';

  let rating = $state(0);
  let averageRating = 4.3;
</script>

<!-- Interactive rating -->
<Rating bind:value={rating} tooltip="Rate this item" />

<!-- With half-star precision -->
<Rating
  bind:value={rating}
  precision={0.5}
  showValue
/>

<!-- Display average (read-only) -->
<div class="average-rating">
  <Rating value={averageRating} readonly showValue />
  <span>({averageRating} out of 5)</span>
</div>

<!-- Custom hearts -->
<Rating
  bind:value={likes}
  max={3}
  icon={HeartIcon}
  emptyIcon={HeartOutlineIcon}
  color="var(--color-error)"
/>

<!-- Large for feedback forms -->
<Rating
  bind:value={satisfaction}
  size="2"
  clearable
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `value`
- Uses `$state()` for internal reactive state (hoverValue, isHovering)
- CSS `clip-path` for half-star rendering
- Mouse position detection within each icon for half-star precision
- Hidden `<input type="hidden">` for form submission with `name` prop
- Default `StarIcon` is an inline SVG (no external dependency)
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- Touch events handled alongside mouse events for mobile
- `{@attach tooltip()}` for tooltip when `tooltip` prop is set
