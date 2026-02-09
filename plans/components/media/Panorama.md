# Panorama

**Category**: Media
**File**: `packages/components/src/media/Panorama.svelte`

## Description

A 360-degree panoramic image viewer using WebGL (via Three.js) for immersive photo experiences. Renders equirectangular images onto a sphere that users can explore by dragging, touch gestures, or device gyroscope. Supports interactive hotspot markers for virtual tour navigation.

## Dependencies

- **Three.js** (`three`) -- WebGL rendering library; **optional and heavy dependency** (~150KB min+gzip). Must be lazy-loaded via dynamic `import()` on component mount. Do not include in the main bundle.
- **`@delightstack/utilities`**:
  - `lazyLoad` -- handles the dynamic import of Three.js with loading state management

## Visual Design

### Container
- Fixed aspect ratio (default `16/9`) or fills parent
- Rounded corners (`--radius-md`)
- Loading overlay with spinner while Three.js and image load
- Grab cursor when interactive

### Controls
- Zoom in/out buttons (bottom-right)
- Fullscreen button
- Reset view button (returns to `initialView`)
- Compass indicator showing current heading (optional)

### Hotspots
- Positioned in 3D space within the panorama
- Rendered as floating markers (icon or label)
- Pulse animation to draw attention
- Tooltip on hover, action on click

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | Equirectangular panorama image URL |
| `initialView` | `{ pitch: number, yaw: number }` | `{ pitch: 0, yaw: 0 }` | Starting camera orientation in degrees |
| `fov` | `number` | `75` | Field of view in degrees |
| `autoRotate` | `boolean` | `false` | Gentle continuous rotation |
| `autoRotateSpeed` | `number` | `1` | Rotation speed multiplier |
| `showControls` | `boolean` | `true` | Show zoom/fullscreen/reset buttons |
| `interactive` | `boolean` | `true` | Enable drag/touch/scroll interaction |
| `gyroscope` | `boolean` | `false` | Enable device orientation (gyroscope) control on mobile |
| `hotspots` | `Hotspot[]` | `[]` | Interactive markers within the panorama |
| `fallback` | `string` | - | Static image URL shown when WebGL is unavailable |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the container DOM element (`$bindable()`) |

### Hotspot Interface

```typescript
interface Hotspot {
  position: { pitch: number; yaw: number }; // Spherical coordinates in degrees
  label?: string;
  icon?: Component;
  data?: Record<string, any>;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onviewchange` | `{ pitch: number, yaw: number, fov: number }` | Camera orientation changed |
| `onhotspotclick` | `{ hotspot: Hotspot }` | A hotspot was clicked |
| `onload` | - | Panorama image loaded and scene ready |
| `onerror` | `{ error: Error }` | Failed to load image or initialize WebGL |

## Features

### WebGL Rendering (Three.js)
- Creates a `THREE.SphereGeometry` with the panorama image mapped as an internal texture
- Camera sits at the center of the sphere looking outward
- `OrbitControls`-style drag interaction for looking around
- Renders at device pixel ratio for crisp display

### Lazy Loading Three.js
Three.js is a heavy dependency and must not be included in the main application bundle. The component uses dynamic `import('three')` on mount:

```js
// Inside component initialization
const THREE = await import('three');
```

While loading, the component shows either:
- The `skeleton` shimmer (if `skeleton` is true)
- A loading spinner overlay
- The `fallback` static image (if provided)

### WebGL Fallback
When WebGL is not available (old devices, disabled GPU, WebGL context lost):
- Detects via `document.createElement('canvas').getContext('webgl')`
- If `fallback` is provided, displays the static image with `object-fit: cover`
- If no `fallback`, shows a message: "360 view not supported on this device"
- The `onerror` event fires with the reason

```svelte
<Panorama
  src="/panoramas/beach-360.jpg"
  fallback="/panoramas/beach-static.jpg"
/>
```

### Gyroscope Control on Mobile
```svelte
<Panorama src="/panoramas/room.jpg" gyroscope />
```
- Uses the `DeviceOrientationEvent` API to control camera orientation
- User looks around by physically moving their phone
- Requires permission prompt on iOS 13+ (`DeviceOrientationEvent.requestPermission()`)
- Falls back to touch drag if permission denied or API unavailable
- Automatically disabled on desktop (no gyroscope)

### Hotspot Markers
```svelte
<Panorama src={currentRoom.panorama} hotspots={currentRoom.hotspots} onhotspotclick={handleNav}>
</Panorama>
```
- Rendered as HTML overlays positioned via 3D-to-2D projection
- Stay correctly positioned as user rotates the view
- Hidden when behind the camera (backface check)
- Pulse animation to attract attention
- Click fires `onhotspotclick` with the hotspot data

### Navigation (Drag/Touch)
- Click and drag to look around (mouse)
- Touch drag on mobile
- Inertia/momentum: releasing a drag continues rotation with deceleration
- Mouse wheel or pinch to zoom (adjusts FOV within `[30, 120]` range)

### Auto-Rotation
- Gentle continuous yaw rotation
- Pauses when user interacts
- Resumes after 3 seconds of inactivity
- Respects `prefers-reduced-motion` (disables auto-rotation)

## Delightful Details

### Smooth Loading
- Skeleton or spinner shown while Three.js loads
- Panorama fades in once the texture is ready
- No visible pop or flicker

### Inertia
- Momentum when releasing a drag
- Natural exponential deceleration
- Feels physical and satisfying

### Compass Indicator
- Small compass in corner shows current heading (N/S/E/W)
- Click compass to reset to north (`yaw: 0`)
- Smoothly rotates as user pans

### Responsive Performance
- Reduces render resolution on low-power devices
- Pauses rendering when not visible (IntersectionObserver)
- Throttles `onviewchange` events to avoid excessive updates

## Accessibility

- Keyboard navigation: Arrow keys to pan, +/- to zoom, Home to reset view
- `role="application"` with `aria-label="360 degree panorama viewer"`
- Auto-rotation can be paused via keyboard (Space)
- `prefers-reduced-motion: reduce` disables auto-rotation and inertia
- Hotspots are keyboard-focusable and activatable with Enter
- Fallback static image ensures content is accessible when WebGL is unavailable

## Code Example

```svelte
<script>
  import { Panorama } from '@delightstack/components';

  let { rooms } = $props();
  let currentRoom = $state(rooms[0]);

  function handleHotspotClick({ hotspot }) {
    const target = rooms.find(r => r.id === hotspot.data.targetId);
    if (target) currentRoom = target;
  }
</script>

<!-- Basic panorama -->
<Panorama src="/panoramas/beach.jpg" />

<!-- With gyroscope on mobile -->
<Panorama src="/panoramas/mountain.jpg" gyroscope />

<!-- Auto-rotating preview -->
<Panorama
  src="/panoramas/office.jpg"
  autoRotate
  autoRotateSpeed={0.5}
  interactive={false}
/>

<!-- With custom initial view and WebGL fallback -->
<Panorama
  src="/panoramas/room.jpg"
  initialView={{ pitch: -10, yaw: 45 }}
  fov={90}
  fallback="/panoramas/room-static.jpg"
/>

<!-- Virtual tour with hotspots -->
<Panorama
  src={currentRoom.panorama}
  hotspots={currentRoom.hotspots}
  onhotspotclick={handleHotspotClick}
/>

<!-- Skeleton state -->
<Panorama skeleton />
```

## CSS Approach

```css
.panorama-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
  cursor: grab;
}

.panorama-container:active {
  cursor: grabbing;
}

.panorama-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.panorama-controls {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.panorama-control-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: light-dark(
    color-mix(in oklch, var(--color-surface) 90%, transparent),
    color-mix(in oklch, var(--color-surface) 80%, transparent)
  );
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text);
}

.panorama-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: pointer;
}

.panorama-hotspot-marker {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--color-action);
  color: var(--color-action-text);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: hotspot-pulse 2s infinite;
}

@keyframes hotspot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-action) 40%, transparent); }
  50% { box-shadow: 0 0 0 8px color-mix(in oklch, var(--color-action) 0%, transparent); }
}

.panorama-fallback {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.panorama-fallback-message {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
```
