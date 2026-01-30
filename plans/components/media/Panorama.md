# Panorama

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Panorama.svelte`

## Description

A 360° panoramic image viewer for immersive photo experiences. Allows users to look around in all directions within a spherical or cylindrical image.

## Visual Design

### Container
- Fixed aspect ratio or full-screen
- Rounded corners (optional)
- Loading overlay

### Controls
- Drag to look around
- Zoom controls (optional)
- Fullscreen button
- Reset view button

### Indicators
- Compass direction (optional)
- Field of view indicator

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | Panorama image URL |
| `type` | `'sphere' \| 'cylinder'` | `'sphere'` | Projection type |
| `initialView` | `{ pitch, yaw }` | `{ 0, 0 }` | Starting view |
| `fov` | `number` | `75` | Field of view (degrees) |
| `autoRotate` | `boolean` | `false` | Auto-rotate panorama |
| `rotateSpeed` | `number` | `1` | Rotation speed |
| `showControls` | `boolean` | `true` | Show control buttons |
| `interactive` | `boolean` | `true` | Enable user interaction |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onviewchange` | `{ pitch, yaw }` | View angle changed |
| `onload` | - | Image loaded |
| `onerror` | `{ error }` | Load failed |
| `onfullscreen` | `{ active }` | Fullscreen toggled |

## Features

### Navigation
- Click and drag to look around
- Touch gestures supported
- Inertia/momentum scrolling

### Zoom
- Mouse wheel to zoom
- Pinch to zoom (touch)
- Zoom limits

### Hotspots (Advanced)
```svelte
<Panorama src="/pano.jpg">
  <Hotspot
    position={{ pitch: 0, yaw: 90 }}
    onclick={() => goToRoom('kitchen')}
  >
    <span>Kitchen →</span>
  </Hotspot>
</Panorama>
```
- Interactive points in panorama
- Tooltips or actions
- Navigate between scenes

### Auto-Rotation
- Gentle continuous rotation
- Pause on interaction
- Resume after delay

## Delightful Details

### Smooth Loading
- Show placeholder first
- Progressive image loading
- Fade in when ready

### Inertia
- Momentum when releasing drag
- Natural deceleration
- Feels physical

### Device Orientation
- Optional gyroscope control
- Look by moving phone
- Calibration handling

### VR Mode (Advanced)
- Stereoscopic view
- Google Cardboard support
- WebXR integration

### Compass
- Shows current direction
- Click to reset north
- Smooth rotation

## Accessibility

- Keyboard navigation (arrow keys)
- Pause/stop auto-rotate
- Alternative static image option
- Reduced motion support

## Code Example

```svelte
<script>
  import { Panorama } from '@delightstack/components';
</script>

<!-- Basic panorama -->
<Panorama src="/panoramas/beach.jpg" />

<!-- Auto-rotating -->
<Panorama
  src="/panoramas/office.jpg"
  autoRotate
  rotateSpeed={0.5}
/>

<!-- With initial view -->
<Panorama
  src="/panoramas/room.jpg"
  initialView={{ pitch: -10, yaw: 45 }}
  fov={90}
/>

<!-- Non-interactive preview -->
<Panorama
  src="/panoramas/property.jpg"
  interactive={false}
  autoRotate
/>

<!-- Virtual tour with hotspots -->
<Panorama src={currentRoom.panorama}>
  {#each currentRoom.hotspots as hotspot}
    <Hotspot
      position={hotspot.position}
      onclick={() => navigateTo(hotspot.target)}
    >
      {hotspot.label}
    </Hotspot>
  {/each}
</Panorama>
```

## Implementation Notes

- Use WebGL/Three.js or similar
- Handle equirectangular projection
- Optimize for mobile performance
- Support standard panorama formats
- Consider lazy loading for heavy images
