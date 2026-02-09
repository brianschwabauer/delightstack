# Confetti

**Status**: Planned
**Category**: Feedback
**File**: `packages/components/src/feedback/Confetti.svelte`

## Description

A canvas-based celebration animation that fires confetti particles. Provides both a programmatic API (`confetti()` function) for imperative use and a component API (`<Confetti />`) for declarative use. Supports preset animations, custom particle shapes, and configurable physics.

## Dependencies

- **Components**: None (standalone)
- **Utilities**: None
- **Libraries**: None (uses native Canvas API)

## Visual Design

### Particles

- Paper-like shapes rendered on a `<canvas>` element
- Supported shapes: circles, squares, stars, and custom SVG paths
- Each particle has randomized rotation, scale, and flutter
- Colors pulled from a configurable palette

### Origin

- Default origin: bottom-center of the viewport (`{ x: 0.5, y: 1.0 }`)
- Can fire from a specific point (normalized 0-1 coordinates) or from an element
- Spread angle controls the cone width

### Default Colors

```
['#ff577f', '#ff884b', '#ffd384', '#fff9b0', '#3ec1d3', '#7c5cbf']
```

Customizable via `colors` prop/option.

## Programmatic API

```typescript
import { confetti } from '@delightstack/components';

// Basic burst from bottom-center
confetti();

// Customized burst
confetti({
	particleCount: 100,
	spread: 90,
	origin: { x: 0.5, y: 0.7 },
	colors: ['#ff0000', '#00ff00', '#0000ff'],
	shapes: ['circle', 'star'],
});

// Presets
confetti.burst();                          // Same as confetti() — single burst
confetti.cannon({ duration: 3000 });       // Continuous stream, returns stop()
confetti.fireworks();                      // Multiple timed bursts from random positions
confetti.sides();                          // Simultaneous bursts from both screen edges
confetti.rain({ duration: 5000 });         // Gentle fall from top of viewport

// Dismiss
confetti.stop();                           // Stop all active animations and clean up
```

### ConfettiOptions

```typescript
interface ConfettiOptions {
	particleCount?: number;       // Default: 50. Max: 500
	spread?: number;              // Spread angle in degrees. Default: 60
	startVelocity?: number;       // Initial launch speed. Default: 30
	decay?: number;               // Velocity decay per frame (0-1). Default: 0.94
	gravity?: number;             // Gravity multiplier. Default: 1
	drift?: number;               // Horizontal drift. Default: 0
	ticks?: number;               // Frames before particle fades. Default: 200
	origin?: { x: number; y: number }; // Origin point (0-1 normalized). Default: { x: 0.5, y: 1.0 }
	colors?: string[];            // Particle color palette
	shapes?: Shape[];             // Particle shapes to use
	scalar?: number;              // Particle size multiplier. Default: 1
	zIndex?: number;              // Canvas z-index. Default: 1000
	disableForReducedMotion?: boolean; // Respect prefers-reduced-motion. Default: true
}

type Shape = 'circle' | 'square' | 'star' | { type: 'svg'; path: string; };

interface CannonOptions extends ConfettiOptions {
	duration?: number;            // How long to fire (ms). Default: 3000
	interval?: number;            // Time between bursts (ms). Default: 150
}

interface RainOptions extends ConfettiOptions {
	duration?: number;            // How long to rain (ms). Default: 5000
}
```

All preset functions accept their respective options to override defaults. `confetti.cannon()` and `confetti.rain()` return a `stop()` function to end the animation early.

## Component API

```svelte
<Confetti
	active={celebrating}
	particleCount={100}
	spread={90}
	onend={() => celebrating = false}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `active` | `boolean` | `false` | Trigger confetti when set to `true` |
| `preset` | `'burst' \| 'cannon' \| 'fireworks' \| 'sides' \| 'rain'` | `'burst'` | Animation preset |
| `particleCount` | `number` | `50` | Number of particles (max 500) |
| `spread` | `number` | `60` | Spread angle in degrees |
| `startVelocity` | `number` | `30` | Initial launch speed |
| `decay` | `number` | `0.94` | Velocity decay per frame (0-1) |
| `gravity` | `number` | `1` | Gravity multiplier |
| `drift` | `number` | `0` | Horizontal drift |
| `ticks` | `number` | `200` | Frames before particle fades |
| `origin` | `{ x: number, y: number }` | `{ x: 0.5, y: 1.0 }` | Origin point (0-1 normalized) |
| `colors` | `string[]` | Rainbow palette | Particle color palette |
| `shapes` | `Shape[]` | `['circle', 'square']` | Particle shapes |
| `scalar` | `number` | `1` | Particle size multiplier |
| `zIndex` | `number` | `1000` | Canvas z-index |
| `duration` | `number` | `3000` | Duration for cannon/rain presets (ms) |
| `disableForReducedMotion` | `boolean` | `true` | Respect `prefers-reduced-motion` |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `onend` | `() => void` | Called when all particles have finished animating |

## Preset Details

### Burst (Default)

Single explosion from the origin point. All particles launch simultaneously and spread outward within the spread angle. Best for quick celebrations.

### Cannon

Continuous stream of particles from the origin. Fires small batches at a regular interval for the specified duration. Returns a `stop()` function. Good for sustained celebrations.

### Fireworks

Multiple bursts from randomized positions across the upper half of the viewport, staggered over ~2 seconds. Each burst uses a random subset of the color palette. Dramatic and attention-grabbing.

### Sides

Two simultaneous bursts from the left and right edges of the viewport, angled inward (30 degrees). Creates a curtain effect.

### Rain

Gentle particles falling from the top of the viewport across its full width. Lower velocity, higher gravity, more ticks. Calm and ambient.

## Particle Shapes

### Built-in Shapes

- **circle**: Filled circle, slight 3D shading
- **square**: Filled rectangle with random aspect ratio (0.6-1.0), rotates on all axes for a paper-flutter effect
- **star**: 5-pointed star, rotates while falling

### Custom SVG Shape

```typescript
confetti({
	shapes: [
		{ type: 'svg', path: 'M10 0 L13 7 L20 7 L14 12 L16 20 L10 15 L4 20 L6 12 L0 7 L7 7 Z' }
	]
});
```

Custom SVG paths are drawn onto the canvas at the particle's position, scaled by `scalar`, and rotated/colored like built-in shapes.

## Performance

### Particle Limits

- Default particle count: 50
- Maximum particle count per call: 500
- Total active particles across all animations capped at 1000
- Exceeding the cap silently drops the oldest particles

### Rendering

- Single shared `<canvas>` element, created on first call, removed on cleanup
- Canvas is sized to the full viewport (`position: fixed; inset: 0; pointer-events: none`)
- Uses `requestAnimationFrame` loop, stops when no particles remain
- Particle objects are pooled and reused to avoid GC pressure

### Auto-Cleanup

- Canvas element is removed from the DOM when all particles have faded
- All `requestAnimationFrame` callbacks are cancelled on cleanup
- Component unmount calls `confetti.stop()` automatically
- No memory leaks from orphaned animations

### Reduced Motion

- When `prefers-reduced-motion: reduce` is active and `disableForReducedMotion` is `true`, the confetti call is a no-op
- The `onend` callback still fires immediately so application logic continues

## Accessibility

- Canvas element has `aria-hidden="true"` (purely decorative)
- `pointer-events: none` on the canvas so it never blocks interaction
- Respects `prefers-reduced-motion` by default
- No sound effects or other sensory output

## Code Example

```svelte
<script>
	import { Confetti, confetti, Button } from '@delightstack/components';

	let celebrating = $state(false);

	function celebrate() {
		confetti({
			particleCount: 100,
			spread: 70,
			origin: { x: 0.5, y: 0.6 },
		});
	}

	function bigCelebration() {
		confetti.fireworks();
	}

	async function handleSubmit() {
		await saveData();
		confetti({ particleCount: 80, spread: 90 });
	}
</script>

<!-- Programmatic trigger -->
<Button onclick={celebrate}>Celebrate</Button>

<!-- Fireworks -->
<Button onclick={bigCelebration}>Big Win</Button>

<!-- Component approach with preset -->
<Button onclick={() => celebrating = true}>Complete Task</Button>
<Confetti active={celebrating} preset="cannon" duration={2000} onend={() => celebrating = false} />

<!-- Custom shapes -->
<Button onclick={() => confetti({
	shapes: ['star', { type: 'svg', path: 'M10 0 L13 7 L20 7 L14 12 L16 20 L10 15 L4 20 L6 12 L0 7 L7 7 Z' }],
	colors: ['#ffd700', '#ffb700'],
	particleCount: 80,
})}>
	Gold Stars
</Button>

<!-- Sides cannon -->
<Button onclick={() => confetti.sides()}>From Both Sides</Button>

<!-- Rain -->
<Button onclick={() => confetti.rain({ duration: 4000 })}>Gentle Rain</Button>
```

## Implementation Notes

- Use a single full-viewport `<canvas>` element, created lazily on the first `confetti()` call
- Particle physics: each frame, update position by velocity, apply gravity and drift, multiply velocity by decay, decrement ticks
- Particle pool: pre-allocate an array of particle objects and reset them instead of creating new ones
- For star shape, precompute the path and draw with `ctx.fill()` after transforming for position/rotation/scale
- For custom SVG, parse the path string into a `Path2D` object once and reuse
- The component API internally calls the same programmatic API, watching `active` for changes
- Use `$effect` to trigger confetti when `active` transitions from `false` to `true`
