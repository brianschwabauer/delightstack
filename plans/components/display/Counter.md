# Counter

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Counter.svelte`

## Description

An animated number display that smoothly counts up or down between values. Triggers animation when the element becomes visible via `IntersectionObserver`. On the server (SSR), the final value is rendered immediately with no animation. Uses locale-aware formatting via `Intl.NumberFormat`.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- `intersectionObserver` (attachment, for triggering animation on visibility)
- **Libraries**: none (uses `Intl.NumberFormat` for locale formatting)

## Visual Design

### Number Display
- Large, clear numerals
- Tabular figures (`font-variant-numeric: tabular-nums`) for stable width
- Optional prefix/suffix text
- Configurable decimal places

### Animation Styles
- **count** (default): Numbers smoothly increment/decrement via `requestAnimationFrame`
- **flip**: Digits flip like a mechanical counter with 3D CSS transforms
- **fade**: Cross-fade between old and new values

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | required | Target number to display |
| `duration` | `number` | `1000` | Animation duration in milliseconds |
| `delay` | `number` | `0` | Delay before animation starts (ms) |
| `decimals` | `number` | `0` | Number of decimal places |
| `prefix` | `string` | - | Text before the number (e.g., "$") |
| `suffix` | `string` | - | Text after the number (e.g., "%") |
| `format` | `(n: number) => string` | - | Custom formatter function |
| `animation` | `'count' \| 'flip' \| 'fade'` | `'count'` | Animation style |
| `separator` | `boolean` | `true` | Use locale thousands separator |
| `locale` | `string` | `navigator.language` | Locale for number formatting |
| `easing` | `(t: number) => number` | ease-out | Animation easing function |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `oncomplete` | - | Animation finished |

## IntersectionObserver Trigger

The animation does not start on mount. Instead, the component uses `{@attach intersectionObserver()}` from `@delightstack/utilities` with the `onintersectonce` callback to trigger the animation the first time the element scrolls into the viewport.

```svelte
<span
  {@attach intersectionObserver({
    onintersectonce: () => startAnimation()
  })}
>
  {displayValue}
</span>
```

## SSR Behavior

On the server, the component renders the final formatted value immediately. No animation runs. The `IntersectionObserver` attachment is a no-op during SSR. When the client hydrates, the animation triggers on first intersection.

## Locale-Aware Formatting

Number formatting uses `Intl.NumberFormat` with the specified `locale`:
- Thousands separators adapt to locale (1,234,567 in en-US, 1.234.567 in de-DE)
- Decimal separators adapt to locale
- When a custom `format` function is provided, it takes precedence over `Intl.NumberFormat`

## Animation Details

### Count Animation
- Uses `requestAnimationFrame` for smooth 60fps animation
- Interpolates between the previous value (or 0 on first render) and the target value
- Applies the easing function for natural deceleration
- Each frame formats and displays the intermediate number
- Respects `prefers-reduced-motion`: shows the final value immediately

### Flip Animation
- Each digit animates independently with a 3D flip effect
- Staggered timing per digit (rightmost digits flip first)
- Uses CSS `transform: rotateX()` and `perspective`
- Falls back to count animation for `prefers-reduced-motion`

### Fade Animation
- Cross-fade between old and new values
- Old value fades out while new value fades in
- Subtle scale difference for depth

## Value Changes

When `value` changes after the initial animation:
- Smoothly transitions from the current displayed number to the new target
- Direction-aware (counts up or down as needed)
- Uses the same `duration` and `easing` for consistency

## Skeleton State

When `skeleton` is true, render a shimmering bar matching the expected number width. Includes prefix/suffix placeholders if those props are set.

## Accessibility

- The element has `aria-live="polite"` so screen readers announce value changes
- Final value is always accessible in the DOM (animation is visual only)
- `prefers-reduced-motion` disables all animation

## Code Example

```svelte
<script>
  import { Counter } from '@delightstack/components';

  let revenue = $state(0);
</script>

<!-- Basic counter -->
<Counter value={1234} />

<!-- Revenue with prefix and separator -->
<Counter value={1234567} prefix="$" separator />

<!-- Percentage -->
<Counter value={87.5} suffix="%" decimals={1} />

<!-- Large number with custom formatter -->
<Counter
  value={1500000}
  format={(n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }}
/>

<!-- Flip style -->
<Counter value={score} animation="flip" />

<!-- German locale formatting -->
<Counter value={1234.56} locale="de-DE" decimals={2} />

<!-- With delay -->
<Counter value={totalUsers} duration={2000} delay={500} />
```

## Implementation Notes

- Use `requestAnimationFrame` for the count animation loop
- Track previous value with `$state` to animate transitions between value changes
- Handle edge cases: negative numbers, very large numbers, NaN
- Debounce rapid value changes to avoid animation conflicts
- CSS transforms for the flip animation (3D perspective, `backface-visibility: hidden`)
- `font-variant-numeric: tabular-nums` prevents layout shift during animation
