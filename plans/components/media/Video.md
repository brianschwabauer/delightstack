# Video

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Video.svelte`

## Description

A custom video player with styled controls and enhanced functionality. Provides a consistent playback experience with support for various video sources and formats.

## Visual Design

### Container
- Responsive aspect ratio
- Rounded corners (optional)
- Poster image when paused

### Controls
- Play/pause button
- Progress bar
- Volume control
- Time display
- Fullscreen button
- Settings menu (optional)

### Control Bar
- Overlays video bottom
- Fades out when playing
- Shows on hover/tap
- Semi-transparent background

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string \| Source[]` | required | Video source(s) |
| `poster` | `string` | - | Poster image |
| `autoplay` | `boolean` | `false` | Auto-play video |
| `muted` | `boolean` | `false` | Start muted |
| `loop` | `boolean` | `false` | Loop playback |
| `controls` | `boolean` | `true` | Show controls |
| `aspectRatio` | `string` | `'16/9'` | Aspect ratio |
| `preload` | `'auto' \| 'metadata' \| 'none'` | `'metadata'` | Preload behavior |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Source Interface
```typescript
interface Source {
  src: string;
  type: string;  // 'video/mp4', 'video/webm', etc.
  quality?: string;  // '1080p', '720p', etc.
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onplay` | - | Playback started |
| `onpause` | - | Playback paused |
| `onended` | - | Playback ended |
| `ontimeupdate` | `{ currentTime, duration }` | Time updated |
| `onerror` | `{ error }` | Error occurred |
| `onfullscreen` | `{ active }` | Fullscreen toggled |

## Features

### Custom Controls
- Styled to match design system
- Consistent across browsers
- Touch-friendly on mobile

### Progress Bar
- Seek by clicking/dragging
- Buffered indicator
- Preview thumbnail on hover (optional)

### Volume Control
- Slider with icon
- Mute toggle
- Remember volume preference

### Quality Selection
```svelte
<Video
  src={[
    { src: '/video-1080.mp4', type: 'video/mp4', quality: '1080p' },
    { src: '/video-720.mp4', type: 'video/mp4', quality: '720p' },
    { src: '/video-480.mp4', type: 'video/mp4', quality: '480p' }
  ]}
/>
```
- Quality selector in settings
- Remember preference

### Playback Speed
- Speed options: 0.5x, 1x, 1.5x, 2x
- Settings menu access

### Picture-in-Picture
- PiP button (if supported)
- Continue watching while browsing

## Delightful Details

### Big Play Button
- Large centered play button on poster
- Fades out on play
- Pulses on hover

### Progress Preview
- Thumbnail preview on progress hover
- Shows preview frame
- Time indicator

### Double-Tap to Seek
- Double-tap left: back 10s
- Double-tap right: forward 10s
- Visual feedback

### Smooth Fades
- Controls fade smoothly
- Poster transitions to video
- Volume slider animations

### Loading States
- Spinner during buffering
- Progress indication
- Skeleton before load

### Keyboard Shortcuts
- Space: play/pause
- Arrows: seek
- M: mute
- F: fullscreen

## Accessibility

- Keyboard controls
- Captions support (VTT)
- Screen reader announcements
- Focus visible on controls

## Code Example

```svelte
<script>
  import { Video } from '@delightstack/components';
</script>

<!-- Basic video -->
<Video
  src="/videos/intro.mp4"
  poster="/videos/intro-poster.jpg"
/>

<!-- With multiple qualities -->
<Video
  src={[
    { src: '/video-1080.mp4', type: 'video/mp4', quality: '1080p' },
    { src: '/video-720.mp4', type: 'video/mp4', quality: '720p' }
  ]}
  poster="/poster.jpg"
/>

<!-- Autoplay muted (for backgrounds) -->
<Video
  src="/background.mp4"
  autoplay
  muted
  loop
  controls={false}
/>

<!-- With captions -->
<Video src="/video.mp4">
  <track
    kind="captions"
    src="/captions-en.vtt"
    srclang="en"
    label="English"
    default
  />
</Video>
```

## Implementation Notes

- Wrap native video element
- Custom controls overlay
- Handle fullscreen API differences
- Support HLS/DASH streaming (optional)
- Consider video.js for advanced features
