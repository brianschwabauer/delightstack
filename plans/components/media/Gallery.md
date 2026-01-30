# Gallery

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Gallery.svelte`

## Description

An image grid display with lightbox functionality. Shows a collection of images in an organized layout with the ability to view images in full-screen detail.

## Visual Design

### Grid Layout
- Responsive columns
- Consistent aspect ratios
- Gap between items
- Masonry option for varied heights

### Thumbnails
- Hover overlay with zoom icon
- Smooth scale on hover
- Loading placeholders

### Lightbox
- Full-screen overlay
- Large image centered
- Navigation arrows
- Close button
- Image counter

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `images` | `Image[]` | `[]` | Gallery images |
| `columns` | `number \| object` | `{ sm: 2, md: 3, lg: 4 }` | Column count |
| `gap` | `string` | `'0.5rem'` | Grid gap |
| `layout` | `'grid' \| 'masonry'` | `'grid'` | Layout style |
| `aspectRatio` | `string` | `'1'` | Thumbnail aspect ratio |
| `lightbox` | `boolean` | `true` | Enable lightbox |
| `dense` | `boolean` | `false` | Compact grid gap (`0.25rem`) |
| `comfortable` | `boolean` | `false` | Relaxed grid gap (`1rem`) |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `6` | Number of skeleton items |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Image Interface
```typescript
interface Image {
  src: string;
  thumbnail?: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ image, index }` | Image selected |
| `onlightboxopen` | `{ index }` | Lightbox opened |
| `onlightboxclose` | - | Lightbox closed |

## Features

### Responsive Grid
- Columns adjust to viewport
- Consistent spacing
- Clean alignment

### Masonry Layout
```svelte
<Gallery layout="masonry" images={images} />
```
- Varied image heights
- Pinterest-style layout
- Fills gaps efficiently

### Lightbox
- Click thumbnail to open
- Swipe/arrow navigation
- Pinch to zoom
- Close on backdrop click

### Lazy Loading
- Load images as visible
- Blur-up effect
- Placeholder skeleton

## Delightful Details

### Thumbnail Hover
- Subtle scale up
- Overlay fades in
- Zoom icon appears

### Lightbox Transitions
- Image morphs from thumbnail position
- Smooth scale and position
- Background fades in

### Image Loading
- Blur placeholder first
- Fade in when loaded
- No layout shift

### Keyboard Navigation
- Arrow keys in lightbox
- Escape to close
- Focus trapped in lightbox

### Touch Gestures
- Swipe in lightbox
- Pinch to zoom
- Double-tap to zoom

### Caption Display
- Shows below image in lightbox
- Fades in after image
- Scrollable if long

## Accessibility

- Alt text required
- Keyboard navigation
- Screen reader announcements
- Focus management in lightbox

## Code Example

```svelte
<script>
  import { Gallery } from '@delightstack/components';

  const photos = [
    { src: '/photos/1.jpg', thumbnail: '/photos/1-thumb.jpg', alt: 'Photo 1' },
    { src: '/photos/2.jpg', thumbnail: '/photos/2-thumb.jpg', alt: 'Photo 2' },
    { src: '/photos/3.jpg', thumbnail: '/photos/3-thumb.jpg', alt: 'Photo 3' },
    // ...
  ];
</script>

<!-- Basic gallery -->
<Gallery images={photos} />

<!-- Masonry layout -->
<Gallery images={photos} layout="masonry" columns={3} />

<!-- Custom aspect ratio (square) -->
<Gallery images={photos} aspectRatio="1" columns={4} gap="1rem" />

<!-- Without lightbox -->
<Gallery images={photos} lightbox={false} onselect={handleSelect} />

<!-- Portfolio with captions -->
<Gallery images={portfolioImages}>
  {#snippet item(image)}
    <div class="portfolio-item">
      <img src={image.thumbnail} alt={image.alt} />
      <span class="caption">{image.caption}</span>
    </div>
  {/snippet}
</Gallery>
```

## Implementation Notes

- Use CSS Grid for layout
- Intersection Observer for lazy load
- Portal lightbox to body
- Handle high-DPI thumbnails
- Consider virtual list for large galleries
