# Video

**Category**: Media
**File**: `packages/components/src/media/Video.svelte`

## Description

A video player component that wraps [Plyr](https://github.com/sampotts/plyr), a lightweight, accessible, and customizable media player library. Provides quality selection, picture-in-picture, keyboard shortcuts, poster image support, and consistent styled controls that match the design system, without building custom video controls from scratch.

## Dependencies

- **Plyr** (`plyr`) -- lightweight media player library; provides all playback controls, progress bar, volume, fullscreen, PiP, settings menu, and keyboard shortcuts
- **`@delightstack/utilities`**:
  - `lazyLoad` -- dynamically imports Plyr only when the component mounts (avoids bundling the full library upfront)

## Visual Design

### Container
- Responsive aspect ratio via CSS `aspect-ratio`
- Rounded corners (`--radius-md`)
- Poster image displayed before playback begins

### Controls (Plyr-provided)
- Play/pause button
- Progress bar with seek, buffered indicator
- Volume slider with mute toggle
- Current time / duration display
- Settings menu (quality, speed, captions)
- Fullscreen button
- PiP button (when supported)

### Control Bar
- Overlays video bottom
- Fades out after 2.5s of inactivity during playback
- Shows on hover, tap, or keyboard interaction
- Semi-transparent background with blur

### Big Play Button
- Large centered play icon on poster
- Fades out on play
- Styled with `--color-action` background

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string \| Source[]` | required | Video source URL or array of sources |
| `poster` | `string` | - | Poster image URL shown before playback |
| `autoplay` | `boolean` | `false` | Auto-play video (browsers require `muted` for autoplay) |
| `muted` | `boolean` | `false` | Start muted |
| `loop` | `boolean` | `false` | Loop playback |
| `controls` | `boolean` | `true` | Show Plyr controls |
| `aspectRatio` | `string` | `'16/9'` | CSS aspect ratio of the container |
| `preload` | `'auto' \| 'metadata' \| 'none'` | `'metadata'` | Preload behavior |
| `captions` | `Track[]` | `[]` | Caption/subtitle tracks |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the underlying DOM element (`$bindable()`) |
| `player` | `Plyr` | - | Bind to the Plyr instance for imperative control (`$bindable()`) |

### Source Interface

```typescript
interface Source {
  src: string;
  type: string;       // 'video/mp4', 'video/webm', etc.
  size?: number;       // Resolution height: 1080, 720, 480, etc. (Plyr uses this for quality menu)
}
```

### Track Interface

```typescript
interface Track {
  kind: 'captions' | 'subtitles';
  src: string;        // URL to .vtt file
  srclang: string;    // Language code: 'en', 'es', etc.
  label: string;      // Display label: 'English', 'Spanish', etc.
  default?: boolean;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onplay` | - | Playback started |
| `onpause` | - | Playback paused |
| `onended` | - | Playback ended |
| `ontimeupdate` | `{ currentTime: number, duration: number }` | Time updated |
| `onerror` | `{ error: MediaError }` | Error occurred |
| `onenterfullscreen` | - | Entered fullscreen |
| `onexitfullscreen` | - | Exited fullscreen |
| `onenterpip` | - | Entered Picture-in-Picture |
| `onexitpip` | - | Exited Picture-in-Picture |
| `onready` | `{ player: Plyr }` | Plyr instance ready |

## Features

### Plyr Integration
The component creates a native `<video>` element and initializes Plyr on mount. Plyr handles all control rendering, interactions, and state management. The component maps props to Plyr configuration and proxies Plyr events to Svelte event handlers.

```svelte
<Video
  src="/videos/intro.mp4"
  poster="/videos/intro-poster.jpg"
/>
```

### Quality Selection
```svelte
<Video
  src={[
    { src: '/video-1080.mp4', type: 'video/mp4', size: 1080 },
    { src: '/video-720.mp4', type: 'video/mp4', size: 720 },
    { src: '/video-480.mp4', type: 'video/mp4', size: 480 }
  ]}
/>
```
- Plyr displays a quality selector in its settings menu
- Uses the `size` property on each source to label quality levels
- Remembers user preference via `localStorage`

### Picture-in-Picture
- PiP button shown in controls when the browser supports the PiP API
- **Browser support**: PiP API is available in Chromium-based browsers and Safari. Firefox has limited support. The button is automatically hidden when unsupported.

### Keyboard Shortcuts (Plyr-provided)
| Key | Action |
|-----|--------|
| Space / K | Play/Pause |
| Left arrow | Seek back 10s |
| Right arrow | Seek forward 10s |
| Up arrow | Volume up |
| Down arrow | Volume down |
| M | Toggle mute |
| F | Toggle fullscreen |
| C | Toggle captions |
| 0-9 | Seek to 0%-90% |

### Poster Image
- Displayed as the initial frame before playback
- Uses the `poster` attribute on the native `<video>` element
- Big play button overlaid on poster

### Captions
```svelte
<Video src="/video.mp4" captions={[
  { kind: 'captions', src: '/captions-en.vtt', srclang: 'en', label: 'English', default: true },
  { kind: 'subtitles', src: '/subtitles-es.vtt', srclang: 'es', label: 'Spanish' }
]} />
```
- Rendered as `<track>` elements inside the `<video>`
- Plyr provides a caption toggle and language selector

### Playback Speed
- Plyr settings menu includes speed options: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x

## Delightful Details

### Plyr CSS Theming
Plyr's CSS custom properties are overridden to match the design system:

```css
.video-container {
  --plyr-color-main: var(--color-action);
  --plyr-video-control-color: white;
  --plyr-video-control-background-hover: color-mix(in oklch, var(--color-action) 80%, transparent);
  --plyr-range-fill-background: var(--color-action);
  --plyr-badge-background: var(--color-action);
  --plyr-font-family: var(--font-sans);
  --plyr-border-radius: var(--radius-md);
}
```

### Loading State
- Spinner overlay during buffering (Plyr built-in)
- Skeleton shimmer when `skeleton` is true (before Plyr loads)

### Double-Tap to Seek (Mobile)
- Plyr supports double-tap left/right to seek backward/forward
- Visual ripple feedback

### Smooth Control Fade
- Controls fade in/out with opacity transition
- Immediate show on any interaction

## Browser API Requirements

| Feature | API | Support Notes |
|---------|-----|---------------|
| Fullscreen | Fullscreen API | All modern browsers; uses vendor-prefixed fallbacks |
| Picture-in-Picture | PiP API | Chrome 70+, Safari 13.1+, Edge 79+; limited in Firefox |
| Keyboard shortcuts | KeyboardEvent | Universal |
| Captions | TextTrack API | Universal |
| Quality switching | Source switching | Plyr handles seamlessly for MP4; for adaptive streaming (HLS/DASH), use a Plyr plugin |

## Accessibility

- Plyr provides built-in ARIA labels on all controls
- Keyboard navigation for all interactive elements
- Captions support for deaf/hard-of-hearing users
- Focus ring on controls matches `--color-focus-ring`
- Screen reader announces play state changes

## Code Example

```svelte
<script>
  import { Video } from '@delightstack/components';

  let { videoSrc } = $props();
  let player = $state(null);
</script>

<!-- Basic video with poster -->
<Video
  src="/videos/intro.mp4"
  poster="/videos/intro-poster.jpg"
/>

<!-- Multiple qualities -->
<Video
  src={[
    { src: '/video-1080.mp4', type: 'video/mp4', size: 1080 },
    { src: '/video-720.mp4', type: 'video/mp4', size: 720 }
  ]}
  poster="/poster.jpg"
/>

<!-- Autoplay muted background -->
<Video
  src="/background.mp4"
  autoplay
  muted
  loop
  controls={false}
/>

<!-- With captions and player binding -->
<Video
  src="/presentation.mp4"
  bind:player
  captions={[
    { kind: 'captions', src: '/captions-en.vtt', srclang: 'en', label: 'English', default: true }
  ]}
  onready={({ player }) => console.log('Player ready', player)}
/>

<!-- Skeleton state -->
<Video skeleton aspectRatio="16/9" />
```

## CSS Approach

```css
.video-container {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: black;

  --plyr-color-main: var(--color-action);
  --plyr-video-control-color: white;
  --plyr-video-control-background-hover: color-mix(in oklch, var(--color-action) 80%, transparent);
  --plyr-range-fill-background: var(--color-action);
  --plyr-font-family: var(--font-sans);
}

.video-container video {
  display: block;
  width: 100%;
  aspect-ratio: var(--video-aspect, 16/9);
}

.video-skeleton {
  aspect-ratio: var(--video-aspect, 16/9);
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
}
```
