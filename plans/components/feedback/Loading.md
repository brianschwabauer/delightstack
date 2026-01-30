# Loading

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Loading.svelte`

## Description

An animated loading indicator for showing progress or activity. A larger, more expressive alternative to the Spinner component, suitable for page-level or content-area loading states.

## Visual Design

### Variants

| Variant | Description |
|---------|-------------|
| `spinner` | Classic rotating circle |
| `dots` | Bouncing/pulsing dots |
| `bars` | Animated bar equalizer |
| `pulse` | Pulsing circle |
| `ring` | Rotating ring segments |

### Sizes

| Size | Dimensions | Use Case |
|------|------------|----------|
| `sm` | 24px | Inline, buttons |
| `md` | 48px | Card loading |
| `lg` | 80px | Page loading |
| `xl` | 120px | Full-screen |

### Colors
- Uses `--c-action` by default
- Can be overridden with `color` prop
- Adapts to dark/light mode

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `'spinner'` | Animation style |
| `size` | `Size` | `'md'` | Indicator size |
| `color` | `string` | `'currentColor'` | Indicator color |
| `label` | `string` | - | Loading text below |
| `overlay` | `boolean` | `false` | Dim background |
| `fullScreen` | `boolean` | `false` | Cover viewport |

## Variants Detail

### Spinner
- Clean rotating circle
- Partial arc (not complete circle)
- Smooth continuous rotation

### Dots
- Three dots in a row
- Bounce or scale animation
- Staggered timing

### Bars
- 3-5 vertical bars
- Height oscillates
- Equalizer-like effect

### Pulse
- Circle scales up and fades
- Multiple overlapping rings
- Radar-like effect

### Ring
- Segmented ring
- Segments rotate and fade
- Modern, clean look

## Delightful Details

### Smooth Transitions
- Fade in on mount
- Fade out on unmount (when possible)
- No jarring appearance

### Text Animation
- Label can have subtle animation
- "Loading..." with animated ellipsis
- Or: static text

### Progress Integration
```svelte
<Loading progress={65} />
```
- Show determinate progress
- Smooth progress animation
- Percentage display

### Color Transitions
- Color can animate
- Cycle through brand colors
- Or: match content theme

## Full-Screen Loading

```svelte
<Loading fullScreen>
  <Logo animated />
  <p>Loading your workspace...</p>
</Loading>
```

- Covers entire viewport
- Backdrop blur (optional)
- Custom content support
- Exit animation

## Accessibility

- `role="status"` for live region
- `aria-busy="true"` on loading content
- `aria-label` for screen readers
- Respects reduced motion

## Code Example

```svelte
<script>
  import { Loading } from '@delightstack/components';

  let isLoading = $state(true);
</script>

<!-- Basic spinner -->
{#if isLoading}
  <Loading />
{/if}

<!-- With label -->
<Loading label="Loading data..." />

<!-- Dots variant -->
<Loading variant="dots" size="sm" />

<!-- Full-screen loading -->
{#if appLoading}
  <Loading fullScreen>
    <p>Preparing your workspace...</p>
  </Loading>
{/if}

<!-- Overlay on content -->
<div class="content">
  {#if contentLoading}
    <Loading overlay />
  {/if}
  <!-- content -->
</div>
```

## Implementation Notes

- Use CSS animations (GPU accelerated)
- SVG for crisp scaling
- Handle reduced motion preference
- Clean up animations on unmount
- Consider CSS-only implementation
