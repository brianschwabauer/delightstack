# Progress

**Status**: Planned
**Category**: Feedback
**File**: `packages/components/src/feedback/Progress.svelte`

## Description

A unified progress and loading indicator component. Handles determinate progress (with a value), indeterminate loading spinners, overlay loading states, and fullscreen loading screens — all in one component. Defaults to a circular spinner, which is the most common use case.

## Dependencies

- **Components**: None (standalone, but used by Button for loading state and FileUpload for upload progress)
- **Utilities**: None

## Visual Design

### Circular Mode (Default)

**As a spinner (indeterminate):**
- SVG circle with a rotating partial arc
- Inherits `currentColor` for seamless inline use
- Configurable stroke width relative to size
- Smooth continuous rotation animation

**As progress (determinate):**
- SVG circle with arc length proportional to value
- Track circle in subtle background color
- Optional center label showing percentage
- Arc animates smoothly to new values

### Linear Mode (`circular={false}`)

**As a loading bar (indeterminate):**
- Horizontal track with a sliding highlight that moves left-to-right
- Subtle pulsing animation

**As a progress bar (determinate):**
- Horizontal track with fill proportional to value
- Optional rounded ends
- Optional percentage label (inside, outside, or above)
- Optional striped animation on the fill

### Overlay Mode

- Semi-transparent backdrop covers the parent element (or viewport if `fullScreen`)
- Spinner centered within
- Parent gets `position: relative; overflow: hidden` if not already positioned
- Optional label beneath the spinner

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | - | Progress value (0–100). Omit for indeterminate |
| `max` | `number` | `100` | Maximum value |
| `circular` | `boolean` | `true` | Circular mode (false = linear bar) |
| `loading` | `boolean` | `false` | Force indeterminate animation regardless of value |
| `size` | `'00' \| '0' \| '1' \| '2' \| '3'` | `'1'` | Size of the indicator |
| `color` | `string` | - | Custom fill color (overrides `currentColor`) |
| `label` | `string` | - | Text label (below spinner or beside bar) |
| `showValue` | `boolean` | `false` | Display the current percentage |
| `striped` | `boolean` | `false` | Striped animation on fill (linear mode only) |
| `overlay` | `boolean` | `false` | Cover parent element with backdrop |
| `fullScreen` | `boolean` | `false` | Cover entire viewport |
| `success` | `boolean` | `false` | Success color variant |
| `error` | `boolean` | `false` | Error color variant |
| `segments` | `ProgressSegment[]` | - | Multi-segment progress (linear only) |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### ProgressSegment Interface

```typescript
interface ProgressSegment {
	value: number;
	color?: string;
	label?: string;
}
```

## Sizes

### Circular

| Size | Diameter | Stroke | Use Case |
|------|----------|--------|----------|
| `'00'` | 16px | 2px | Inline in text/buttons |
| `'0'` | 24px | 2.5px | Small indicators |
| `'1'` | 40px | 3px | Default standalone |
| `'2'` | 64px | 4px | Prominent display |
| `'3'` | 96px | 5px | Hero/overlay use |

### Linear

| Size | Height | Use Case |
|------|--------|----------|
| `'00'` | 2px | Subtle page-top bar |
| `'0'` | 4px | Compact progress |
| `'1'` | 8px | Default bar |
| `'2'` | 12px | Prominent bar |
| `'3'` | 16px | Large bar with label inside |

## States

### Determinate

- Provide a `value` prop (0–100)
- Fill width (linear) or arc length (circular) matches percentage
- Smooth CSS transition on value change

### Indeterminate

- Omit `value` prop, or set `loading={true}`
- **Circular**: continuous rotation with a variable-length arc (arc grows/shrinks as it spins)
- **Linear**: sliding highlight bar that moves across the track
- Both use CSS animations (no JS timers)

### Complete (value === 100)

- Brief flash of `--color-success` on the fill
- Subtle pulse animation on the track
- Optional confetti integration via callback

## Delightful Details

### Smooth Value Animation

- Progress fill transitions to new values with `--ease-out` easing
- Duration scales with the distance of the change (larger jumps = slightly longer)
- Never jumps — always animates, even on initial render (animates from 0)

### Milestone Flash

At 25%, 50%, 75%, and 100% milestones:
- Brief brightening of the fill color
- Subtle scale pulse on circular mode
- Creates a rewarding sense of progress

### Spinner Rotation

- Uses a `conic-gradient` or SVG dasharray for the arc
- Arc length oscillates between 30% and 70% during rotation
- Creates the classic Material Design spinner feel

### Striped Animation (Linear)

- Diagonal 45° stripes on the fill
- Stripes animate continuously (barberpole effect)
- Uses CSS `background-size` + `background-position` animation for GPU performance

### Color Transitions

- Smooth color transitions when switching between default/success/error states
- Success state: fill color transitions from current → `--color-success`

### Overlay Entrance

- Backdrop fades in (opacity 0 → 1) over 150ms
- Spinner scales up from 0.8 with a slight bounce
- Uses `backdrop-filter: blur(2px)` for subtle background blur

## Accessibility

- `role="progressbar"` for determinate mode
- `role="status"` for indeterminate mode
- `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax` for determinate
- `aria-label` prop for context (e.g., "Uploading file")
- `aria-busy="true"` on the parent element when overlay mode is active
- Screen reader announces percentage changes (debounced, not every tick)
- Respects `prefers-reduced-motion` — disables rotation/pulse, shows static partial arc instead

## Code Example

```svelte
<script>
	import { Progress } from '@delightstack/components';

	let uploadProgress = $state(0);
</script>

<!-- Default: circular spinner (indeterminate) -->
<Progress />

<!-- Inline spinner in text -->
<p>Loading data <Progress size="00" /></p>

<!-- Circular progress with value -->
<Progress value={75} showValue />

<!-- Linear progress bar -->
<Progress circular={false} value={45} />

<!-- Linear with label -->
<Progress circular={false} value={uploadProgress} showValue label="Uploading..." />

<!-- Striped bar -->
<Progress circular={false} value={60} striped />

<!-- Multi-segment -->
<Progress
	circular={false}
	segments={[
		{ value: 40, color: 'var(--color-success)', label: 'Complete' },
		{ value: 25, color: 'var(--color-warning)', label: 'In Progress' },
		{ value: 10, color: 'var(--color-error)', label: 'Failed' }
	]}
/>

<!-- Overlay on parent -->
<div style="position: relative;">
	<Table data={users} columns={columns} />
	{#if isLoading}
		<Progress overlay label="Loading data..." />
	{/if}
</div>

<!-- Full-screen loading -->
{#if appLoading}
	<Progress fullScreen label="Starting application..." />
{/if}

<!-- Success state after completion -->
<Progress value={100} success />
```

## CSS Approach

```css
.progress {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: currentColor;

	/* Circular */
	&.circular {
		svg {
			animation: none;
		}
		&.indeterminate svg {
			animation: progress-rotate 1.4s linear infinite;
		}
		&.indeterminate circle.arc {
			animation: progress-dash 1.4s ease-in-out infinite;
		}
		circle.track {
			stroke: var(--color-border);
		}
		circle.arc {
			stroke: var(--color-action);
			transition: stroke-dashoffset var(--duration-slow) var(--ease-out);
		}
	}

	/* Linear */
	&.linear {
		width: 100%;
		border-radius: var(--radius-full);
		background: var(--color-border);
		overflow: hidden;

		.fill {
			height: 100%;
			background: var(--color-action);
			border-radius: inherit;
			transition: width var(--duration-slow) var(--ease-out);
		}

		&.striped .fill {
			background-image: linear-gradient(
				45deg,
				rgba(255,255,255,0.15) 25%, transparent 25%,
				transparent 50%, rgba(255,255,255,0.15) 50%,
				rgba(255,255,255,0.15) 75%, transparent 75%
			);
			background-size: 1rem 1rem;
			animation: progress-stripe 0.5s linear infinite;
		}
	}

	/* Overlay */
	&.overlay {
		position: absolute;
		inset: 0;
		background: var(--color-backdrop);
		backdrop-filter: blur(2px);
		z-index: var(--layer-modal);
	}
	&.full-screen {
		position: fixed;
	}

	&.success circle.arc,
	&.success .fill {
		stroke: var(--color-success);
		background: var(--color-success);
	}
}

@keyframes progress-rotate {
	100% { transform: rotate(360deg); }
}

@keyframes progress-dash {
	0% { stroke-dasharray: 1, 200; stroke-dashoffset: 0; }
	50% { stroke-dasharray: 100, 200; stroke-dashoffset: -15; }
	100% { stroke-dasharray: 1, 200; stroke-dashoffset: -126; }
}

@keyframes progress-stripe {
	0% { background-position: 1rem 0; }
	100% { background-position: 0 0; }
}
```

## Implementation Notes

- Use SVG `<circle>` with `stroke-dasharray` and `stroke-dashoffset` for circular progress
- The indeterminate spinner uses two animations: rotation on the SVG + dasharray oscillation on the circle
- Linear fill uses `transform: scaleX()` for GPU-accelerated width changes (better than animating `width`)
- Overlay mode adds `aria-busy="true"` to the parent element and removes it on unmount
- For `fullScreen`, render via Portal to ensure it's above all other content
- Segments are implemented as multiple absolutely-positioned fills within the track
