# Counter

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Counter.svelte`

## Description

An animated number display that smoothly transitions between values. Perfect for displaying statistics, scores, or any numeric data that changes over time.

## Visual Design

### Number Display
- Large, clear numerals
- Monospace or tabular figures for stability
- Optional prefix/suffix
- Configurable decimal places

### Animation Styles
- **Counting**: Numbers roll up/down
- **Flip**: Digits flip like mechanical counter
- **Fade**: Cross-fade between values

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | required | Number to display |
| `duration` | `number` | `1000` | Animation duration (ms) |
| `delay` | `number` | `0` | Delay before animating |
| `decimals` | `number` | `0` | Decimal places |
| `prefix` | `string` | - | Text before number |
| `suffix` | `string` | - | Text after number |
| `format` | `(n: number) => string` | - | Custom formatter |
| `animation` | `'count' \| 'flip' \| 'fade'` | `'count'` | Animation style |
| `separator` | `boolean` | `true` | Use thousands separator |
| `easing` | `string` | `'ease-out'` | Animation easing |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `oncomplete` | - | Animation finished |

## Animation Details

### Count Animation
- Increments/decrements smoothly
- Easing function for natural feel
- Faster at start, slower at end
- Each digit updates independently

### Flip Animation
- Mechanical counter aesthetic
- Each digit flips individually
- Staggered timing per digit
- 3D transform effect

### Fade Animation
- Simple crossfade
- Old value fades out
- New value fades in
- Subtle scale for depth

## Delightful Details

### Initial Animation
- Counts up from 0 on first render
- Uses `IntersectionObserver` to trigger
- Only animates when visible

### Value Changes
- Smooth transition to new value
- Direction-aware (up vs down)
- Handles large jumps gracefully

### Number Formatting
- Thousands separators (1,234,567)
- Locale-aware formatting
- Currency mode with symbol

### Decimal Handling
- Configurable precision
- Smooth decimal transitions
- No jumping/flickering

## Variants

### Basic
```svelte
<Counter value={1234} />
```

### With Formatting
```svelte
<Counter
  value={1234567}
  prefix="$"
  separator
/>
<!-- $1,234,567 -->
```

### Percentage
```svelte
<Counter
  value={87.5}
  suffix="%"
  decimals={1}
/>
```

### Large Numbers
```svelte
<Counter
  value={1500000}
  format={(n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }}
/>
<!-- 1.5M -->
```

## Accessibility

- Final value accessible to screen readers
- Animation respects `prefers-reduced-motion`
- Static display for reduced motion

## Code Example

```svelte
<script>
  import { Counter } from '@delightstack/components';

  let revenue = $state(0);

  // Simulate data loading
  onMount(async () => {
    const data = await fetchStats();
    revenue = data.revenue;
  });
</script>

<!-- Revenue display -->
<div class="stat">
  <span class="label">Revenue</span>
  <Counter
    value={revenue}
    prefix="$"
    duration={2000}
    separator
  />
</div>

<!-- Animated percentage -->
<Counter
  value={progressPercent}
  suffix="%"
  decimals={0}
  duration={500}
/>

<!-- Flip-style counter -->
<Counter
  value={score}
  animation="flip"
/>
```

## Implementation Notes

- Use requestAnimationFrame for smooth counting
- Handle edge cases (negative, very large)
- Consider performance for rapid updates
- Debounce very fast value changes
- Use CSS transforms for flip animation
