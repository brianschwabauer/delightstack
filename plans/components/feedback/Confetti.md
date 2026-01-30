# Confetti

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Confetti.svelte`

## Description

A celebration animation component that fires confetti particles. Used to celebrate achievements, successful completions, or any moment worthy of delight. Can be triggered programmatically or via component.

## Visual Design

### Particles
- Colorful paper-like shapes
- Rectangles, circles, and streamers
- Physics-based falling motion
- Rotation and flutter effects

### Origin
- Fires from a point or element
- Can spread in cone or explosion
- Configurable direction and spread

### Colors
- Default: festive rainbow palette
- Customizable color array
- Or: match brand colors

## API

### Programmatic (Recommended)
```typescript
import { confetti } from '@delightstack/components';

// Basic burst
confetti();

// From element
confetti({ origin: buttonElement });

// Customized
confetti({
  particleCount: 100,
  spread: 70,
  origin: { x: 0.5, y: 0.5 },
  colors: ['#ff0000', '#00ff00', '#0000ff']
});

// Continuous cannon
const stop = confetti.cannon({ duration: 3000 });
// stop() to end early

// Fireworks
confetti.fireworks();
```

### Component API
```svelte
<Confetti
  active={showConfetti}
  particleCount={100}
/>
```

## Props (Component)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `active` | `boolean` | `false` | Trigger confetti |
| `particleCount` | `number` | `50` | Number of particles |
| `spread` | `number` | `60` | Spread angle in degrees |
| `startVelocity` | `number` | `30` | Initial velocity |
| `decay` | `number` | `0.95` | Velocity decay rate |
| `gravity` | `number` | `1` | Gravity multiplier |
| `drift` | `number` | `0` | Horizontal drift |
| `origin` | `{ x: number, y: number }` | `{ x: 0.5, y: 0.5 }` | Origin point (0-1) |
| `colors` | `string[]` | Rainbow | Particle colors |
| `shapes` | `('square' \| 'circle')[]` | Both | Particle shapes |
| `scalar` | `number` | `1` | Size multiplier |
| `zIndex` | `number` | `1000` | CSS z-index |
| `disableForReducedMotion` | `boolean` | `true` | Respect prefers-reduced-motion |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Programmatic Options

```typescript
interface ConfettiOptions {
  particleCount?: number;
  spread?: number;
  startVelocity?: number;
  decay?: number;
  gravity?: number;
  drift?: number;
  ticks?: number;           // Frames before particle disappears
  origin?: { x: number; y: number };
  colors?: string[];
  shapes?: Shape[];
  scalar?: number;
  zIndex?: number;
  disableForReducedMotion?: boolean;
}

interface CannonOptions extends ConfettiOptions {
  duration?: number;        // How long to fire (ms)
  interval?: number;        // Time between bursts (ms)
}
```

## Preset Animations

### Burst (Default)
```typescript
confetti(); // Single burst from bottom center
```

### Cannon
```typescript
confetti.cannon({ duration: 3000 });
// Continuous stream for 3 seconds
```

### Fireworks
```typescript
confetti.fireworks();
// Multiple bursts from different positions
```

### Sides
```typescript
confetti.sides();
// Fire from both sides of screen
```

### Rain
```typescript
confetti.rain({ duration: 5000 });
// Gentle falling from top
```

## Delightful Details

### Physics
- Realistic gravity and air resistance
- Rotation based on velocity
- Flutter effect for paper-like feel
- No two particles identical

### Performance
- Canvas-based rendering
- Particle pooling for efficiency
- Automatic cleanup when done
- GPU-accelerated

### Reduced Motion
- Respects `prefers-reduced-motion`
- Falls back to simple fade or nothing
- Configurable behavior

### Cleanup
- Particles fade at edges
- No lingering elements
- Memory properly released

## Common Use Cases

### Form Success
```svelte
<script>
  import { confetti } from '@delightstack/components';

  async function handleSubmit() {
    await saveData();
    confetti({ origin: submitButton });
    toast.success('Saved!');
  }
</script>
```

### Achievement Unlocked
```svelte
<script>
  import { confetti } from '@delightstack/components';

  function celebrateAchievement() {
    confetti.fireworks();
    showAchievementModal();
  }
</script>
```

### Level Complete
```svelte
<Confetti active={levelComplete} particleCount={200} />
```

### Purchase Complete
```svelte
<script>
  import { confetti } from '@delightstack/components';

  onMount(() => {
    // Fire from the "Thank you" heading
    confetti({
      origin: thankYouHeading,
      particleCount: 100,
      spread: 90
    });
  });
</script>
```

## Accessibility

- Respects `prefers-reduced-motion`
- Purely decorative (no semantic meaning)
- Doesn't block interaction
- Auto-cleans up

## Code Example

```svelte
<script>
  import { Confetti, confetti, Button } from '@delightstack/components';

  let celebrating = $state(false);

  function celebrate() {
    // Programmatic approach
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.5, y: 0.6 }
    });
  }

  function bigCelebration() {
    // Fireworks!
    confetti.fireworks();
  }
</script>

<!-- Programmatic trigger -->
<Button onclick={celebrate}>
  🎉 Celebrate!
</Button>

<!-- Component approach -->
<Button onclick={() => celebrating = true}>
  Complete Task
</Button>
<Confetti active={celebrating} onend={() => celebrating = false} />

<!-- Sides cannon -->
<Button onclick={() => confetti.sides()}>
  Big Win!
</Button>
```

## Implementation Notes

- Use HTML Canvas for rendering
- Implement particle physics system
- Pool and reuse particle objects
- Clean up canvas on unmount
- Consider using Web Workers for heavy animations
- Provide both component and function APIs
