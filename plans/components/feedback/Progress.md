# Progress

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Progress.svelte`

## Description

A progress bar component for showing determinate progress through a task or process. Supports linear and circular variants with smooth animations.

## Visual Design

### Linear Bar
- Horizontal track with fill
- Rounded ends (optional)
- Clear progress indication
- Optional percentage label

### Circular/Radial
- SVG circle path
- Configurable stroke width
- Center label optional

### Track
- Subtle background color
- Shows total range

### Fill
- Accent color by default
- Animates on change
- Optional gradient

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | `0` | Current progress (0-100) |
| `max` | `number` | `100` | Maximum value |
| `variant` | `'linear' \| 'circular'` | `'linear'` | Display style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Bar thickness/diameter |
| `color` | `string` | - | Fill color |
| `showLabel` | `boolean` | `false` | Show percentage |
| `indeterminate` | `boolean` | `false` | Unknown progress |
| `striped` | `boolean` | `false` | Striped animation |

## Sizes

### Linear

| Size | Height |
|------|--------|
| `sm` | 4px |
| `md` | 8px |
| `lg` | 12px |

### Circular

| Size | Diameter |
|------|----------|
| `sm` | 32px |
| `md` | 64px |
| `lg` | 96px |

## States

### Determinate
- Shows actual progress value
- Fill width/arc matches percentage

### Indeterminate
- Unknown completion time
- Animated loading pattern
- Linear: sliding highlight
- Circular: rotating partial arc

### Complete
- Optional completion state
- Color change to success
- Brief celebration animation

## Delightful Details

### Smooth Animation
- Progress animates to new value
- Eased transition (ease-out)
- No jumping

### Milestone Flash
At certain points (25%, 50%, 75%, 100%):
- Brief highlight
- Subtle pulse
- Reward feeling

### Striped Animation
```svelte
<Progress value={75} striped />
```
- Diagonal stripes on fill
- Stripes animate (barberpole)
- Indicates active progress

### Color Gradients
```svelte
<Progress value={60} gradient />
```
- Gradient from start to end
- Creates visual interest
- Shifts as progress increases

### Completion Celebration
```svelte
<Progress value={100} celebrate />
```
- Brief success color
- Subtle confetti/sparkle
- Return to normal

## Accessibility

- `role="progressbar"`
- `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- `aria-label` for context
- Screen reader announces changes

## Code Example

```svelte
<script>
  import { Progress } from '@delightstack/components';

  let uploadProgress = $state(0);
</script>

<!-- Basic progress -->
<Progress value={45} />

<!-- With label -->
<Progress value={uploadProgress} showLabel />
<!-- 45% -->

<!-- Indeterminate -->
<Progress indeterminate />

<!-- Circular progress -->
<Progress
  variant="circular"
  value={75}
  showLabel
/>

<!-- Large striped bar -->
<Progress
  value={60}
  size="lg"
  striped
/>

<!-- Upload progress -->
<div class="upload">
  <span>Uploading {filename}...</span>
  <Progress value={uploadProgress} />
  <span>{uploadProgress}%</span>
</div>
```

## Implementation Notes

- Use CSS transforms for bar width (GPU)
- SVG for circular variant
- Handle value > max gracefully
- Debounce rapid value changes
- Animate CSS custom property for smooth transitions
