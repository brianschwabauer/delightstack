# Map

**Category**: Media
**File**: `packages/components/src/media/Map.svelte`

## Description

An interactive map display component using an adapter/provider pattern so users can bring their own map provider. Leaflet (with OpenStreetMap tiles) is the recommended free default, with the ability to swap in Mapbox, Google Maps, or any other provider. The component exposes a provider-agnostic API for markers, popups, clusters, zoom, and center.

## Dependencies

- **Leaflet** (`leaflet`) -- recommended default map provider; lazy-loaded on mount
- **Provider CSS**: The chosen map provider's CSS must be loaded separately by the consumer (e.g. `leaflet/dist/leaflet.css` for Leaflet). This component does not bundle provider CSS.

## Visual Design

### Container
- Responsive by default (fills parent width)
- Configurable height
- Rounded corners (`--radius-md`)
- Loading skeleton before provider initializes

### Controls
- Zoom in/out buttons (provider-rendered)
- Fullscreen toggle (optional, via provider plugin or custom)
- Attribution (required by most tile providers)

### Markers
- Default pin icon or custom icon component
- Cluster markers for dense groups (via provider plugin, e.g. `leaflet.markercluster`)
- Popup on click with custom content

### Theme
- Light and dark tile styles
- Syncs with app `light-dark()` mode by swapping tile URL

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `provider` | `MapProvider` | `leafletProvider()` | Map provider adapter |
| `center` | `[number, number]` | `[0, 0]` | Map center `[lat, lng]` (`$bindable()`) |
| `zoom` | `number` | `10` | Zoom level (`$bindable()`) |
| `markers` | `MapMarker[]` | `[]` | Array of markers to display |
| `cluster` | `boolean` | `false` | Enable marker clustering |
| `interactive` | `boolean` | `true` | Enable pan/zoom interactions |
| `fitMarkers` | `boolean` | `false` | Auto-fit bounds to show all markers |
| `fitPadding` | `number` | `50` | Padding in pixels when fitting to markers |
| `height` | `string` | `'400px'` | Map container height |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the container DOM element (`$bindable()`) |
| `map` | `any` | - | Bind to the underlying provider map instance (`$bindable()`) |
| `popup` | `Snippet<[marker: MapMarker]>` | - | Custom popup content snippet |

### MapMarker Interface

```typescript
interface MapMarker {
  position: [number, number]; // [lat, lng]
  title?: string;
  icon?: string | Component;  // URL to icon image, or Svelte component
  data?: Record<string, any>; // Arbitrary data passed through to events and popup snippet
}
```

### MapProvider Interface

```typescript
interface MapProvider {
  /** Initialize the map on the given container element */
  init(container: HTMLElement, options: MapInitOptions): Promise<any>;
  /** Clean up the map instance */
  destroy(): void;
  /** Set map center */
  setCenter(center: [number, number]): void;
  /** Set zoom level */
  setZoom(zoom: number): void;
  /** Add a marker */
  addMarker(marker: MapMarker): any;
  /** Remove a marker */
  removeMarker(markerRef: any): void;
  /** Clear all markers */
  clearMarkers(): void;
  /** Fit bounds to show all markers */
  fitToMarkers(padding: number): void;
  /** Subscribe to map events */
  on(event: string, handler: Function): void;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onmarkerclick` | `{ marker: MapMarker }` | A marker was clicked |
| `onmove` | `{ center: [number, number], zoom: number }` | Map panned or zoomed |
| `onclick` | `{ latlng: [number, number] }` | Map background clicked |
| `onload` | `{ map: any }` | Map provider initialized |

## Features

### Adapter/Provider Pattern
The component does not import any map library directly. Instead, it accepts a `provider` prop that implements the `MapProvider` interface. A Leaflet adapter is provided as the default:

```svelte
<script>
  import { Map, leafletProvider } from '@delightstack/components';
</script>

<!-- Uses Leaflet by default -->
<Map center={[37.77, -122.42]} zoom={12} />

<!-- Explicit Leaflet with custom tile URL -->
<Map provider={leafletProvider({ tileUrl: 'https://...' })} center={[37.77, -122.42]} zoom={12} />
```

Users can create adapters for other providers:

```svelte
<script>
  import { Map } from '@delightstack/components';
  import { mapboxProvider } from './my-mapbox-provider';
</script>

<Map provider={mapboxProvider({ accessToken: '...' })} center={[37.77, -122.42]} zoom={12} />
```

### Provider CSS Requirement
The map provider's CSS must be loaded by the consumer application. This component does not bundle it to avoid coupling to a specific provider and to allow CSS deduplication.

For Leaflet, add to your app's CSS or `<svelte:head>`:
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
```
Or import in your build pipeline:
```js
import 'leaflet/dist/leaflet.css';
```

### Markers
```svelte
<Map markers={locations} onmarkerclick={handleSelect} />
```
- Default pin icon provided
- Custom icons via URL or Svelte component
- Click handler per marker via `onmarkerclick`

### Popups
```svelte
<Map markers={stores}>
  {#snippet popup(marker)}
    <div class="store-popup">
      <h3>{marker.data.name}</h3>
      <p>{marker.data.address}</p>
    </div>
  {/snippet}
</Map>
```
- Show on marker click
- Custom content via `popup` snippet
- Close on outside click or Escape

### Marker Clustering
```svelte
<Map markers={manyLocations} cluster />
```
- Groups nearby markers into clusters
- Click cluster to zoom in and expand
- Cluster count displayed on cluster icon
- For Leaflet, uses `leaflet.markercluster` plugin internally

### Fit to Markers
```svelte
<Map markers={allLocations} fitMarkers fitPadding={80} />
```
- Automatically adjusts zoom and center to show all markers
- Padding prevents markers from touching the edge

### Bindable Center/Zoom
```svelte
<script>
  let center = $state([37.77, -122.42]);
  let zoom = $state(12);
</script>

<Map bind:center bind:zoom markers={locations} />
<p>Center: {center}, Zoom: {zoom}</p>
```
- Two-way binding for programmatic control
- Updates when user pans/zooms

## Delightful Details

### Theme Sync
- Swap tile layer URL based on `prefers-color-scheme` or app theme
- Light tiles for light mode, dark tiles for dark mode
- Smooth transition handled by tile fade-in

### Loading State
- Skeleton placeholder with shimmer while provider loads
- Smooth fade-in reveal when map is ready

### Marker Animation
- Markers fade in when added
- Smooth position transition if marker coordinates update

### Smooth Transitions
- Animated pan and zoom (provider-native `flyTo` or equivalent)
- No jarring jumps when `center` or `zoom` changes

## Accessibility

- Keyboard navigation: Tab to map, arrow keys to pan, +/- to zoom
- `role="application"` on the map container with `aria-label="Interactive map"`
- Markers are keyboard-focusable and activatable with Enter
- Screen reader announces marker titles on focus
- Non-interactive mode (`interactive={false}`) uses `role="img"` with `aria-label`

## Code Example

```svelte
<script>
  import { Map } from '@delightstack/components';

  let { locations } = $props();
  let selectedLocation = $state(null);
</script>

<!-- Basic map -->
<Map center={[37.7749, -122.4194]} zoom={12} />

<!-- With markers and popup -->
<Map
  markers={locations}
  fitMarkers
  onmarkerclick={({ marker }) => selectedLocation = marker}
>
  {#snippet popup(marker)}
    <div class="popup">
      <h3>{marker.title}</h3>
      <p>{marker.data.description}</p>
    </div>
  {/snippet}
</Map>

<!-- Static, non-interactive display -->
<Map
  center={storeLocation}
  zoom={15}
  markers={[{ position: storeLocation, title: 'Our Store' }]}
  interactive={false}
  height="200px"
/>

<!-- Clustered markers -->
<Map markers={allStores} cluster fitMarkers onmarkerclick={handleStoreSelect} />

<!-- Skeleton state -->
<Map skeleton height="400px" />
```

## CSS Approach

```css
.map-container {
  position: relative;
  width: 100%;
  height: var(--map-height, 400px);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
}

.map-container :global(.leaflet-container) {
  width: 100%;
  height: 100%;
  font-family: var(--font-sans);
}

.map-skeleton {
  width: 100%;
  height: var(--map-height, 400px);
  border-radius: var(--radius-md);
}

.map-popup {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text);
}
```
