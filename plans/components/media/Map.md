# Map

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Map.svelte`

## Description

An interactive map display component for showing locations, markers, and geographic data. Wraps a mapping library with a consistent API and styling that matches the design system.

## Visual Design

### Container
- Responsive by default
- Rounded corners (optional)
- Border/shadow (optional)
- Loading state

### Controls
- Zoom buttons
- Fullscreen toggle (optional)
- Location button (optional)
- Custom control positioning

### Markers
- Custom marker styling
- Cluster markers for density
- Info windows/popups

### Style
- Light/dark map themes
- Custom styling available
- Matches app theme

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `center` | `[number, number]` | `[0, 0]` | Map center [lat, lng] |
| `zoom` | `number` | `10` | Zoom level |
| `markers` | `Marker[]` | `[]` | Map markers |
| `interactive` | `boolean` | `true` | Enable interactions |
| `showControls` | `boolean` | `true` | Show zoom controls |
| `style` | `'light' \| 'dark' \| 'satellite'` | `'light'` | Map style |
| `height` | `string` | `'400px'` | Map height |

### Marker Interface
```typescript
interface Marker {
  position: [number, number];
  title?: string;
  icon?: string | Component;
  popup?: string | Component;
  data?: any;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onmarkerclick` | `{ marker }` | Marker clicked |
| `onmove` | `{ center, zoom }` | Map moved |
| `onclick` | `{ latlng }` | Map clicked |
| `onload` | - | Map loaded |

## Features

### Markers
```svelte
<Map markers={locations} onmarkerclick={handleSelect} />
```
- Custom icons
- Clustering for many markers
- Click handlers

### Popups/Info Windows
- Show on marker click
- Custom content
- Close button

### Geolocation
- "Find my location" button
- Center on user
- Permission handling

### Bounds
```svelte
<Map fitBounds={allMarkerBounds} />
```
- Auto-fit to show all markers
- Padding control

### Drawing (Advanced)
- Draw polygons, circles
- Measurement tools
- Edit existing shapes

## Delightful Details

### Theme Sync
- Map matches app light/dark mode
- Smooth transition between themes

### Loading State
- Skeleton/placeholder
- Smooth reveal when loaded

### Marker Animation
- Markers drop in
- Bounce on interaction

### Smooth Transitions
- Pan and zoom animated
- No jarring jumps

### Cluster Expansion
- Click cluster to zoom in
- Spider effect for tight clusters

## Provider Options

Consider supporting multiple providers:
- Mapbox
- Google Maps
- OpenStreetMap/Leaflet

Or: Choose one and commit.

## Accessibility

- Keyboard navigation for markers
- Screen reader announcements
- Alternative text content

## Code Example

```svelte
<script>
  import { Map } from '@delightstack/components';

  const locations = [
    { position: [37.7749, -122.4194], title: 'San Francisco' },
    { position: [34.0522, -118.2437], title: 'Los Angeles' },
    { position: [47.6062, -122.3321], title: 'Seattle' }
  ];

  let selectedLocation = $state(null);
</script>

<!-- Basic map -->
<Map
  center={[37.7749, -122.4194]}
  zoom={12}
/>

<!-- With markers -->
<Map
  markers={locations}
  fitBounds
  onmarkerclick={({ marker }) => selectedLocation = marker}
/>

<!-- Dark theme, non-interactive -->
<Map
  center={storeLocation}
  zoom={15}
  markers={[{ position: storeLocation, title: 'Our Store' }]}
  style="dark"
  interactive={false}
  showControls={false}
  height="200px"
/>

<!-- Store locator -->
<Map
  markers={stores}
  cluster
  onmarkerclick={handleStoreSelect}
>
  {#snippet popup(store)}
    <div class="store-popup">
      <h3>{store.name}</h3>
      <p>{store.address}</p>
      <Button href={store.directions}>Get Directions</Button>
    </div>
  {/snippet}
</Map>
```

## Implementation Notes

- Lazy load map library
- Handle API key configuration
- Support SSR (no window)
- Clean up on unmount
- Consider bundle size impact
