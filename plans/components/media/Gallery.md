# Gallery

**Category**: Media
**File**: `packages/components/src/media/Gallery.svelte`

## Description

An image grid display with built-in lightbox functionality. Shows a collection of images in a responsive grid or masonry layout with lazy loading, hover effects, and a full-screen lightbox for detailed viewing with keyboard navigation.

## Dependencies

- **Modal** -- used internally for the lightbox overlay (provides backdrop, focus trap, escape-to-close)
- **Image** -- used for lazy-loaded thumbnails in the grid

## Visual Design

### Grid Layout
- Responsive CSS Grid columns
- Consistent gap between items
- Thumbnails maintain aspect ratio or use a uniform ratio

### Masonry Layout
- CSS `columns` approach for varied image heights
- `break-inside: avoid` on each item
- Pinterest-style vertical flow filling gaps efficiently

### Thumbnails
- Hover overlay with semi-transparent scrim and zoom icon
- Subtle scale transform on hover (`1.03x`)
- Cursor pointer when lightbox is enabled

### Lightbox
- Uses Modal internally with fullscreen presentation
- Large image centered on dark backdrop
- Navigation arrows on left/right
- Close button top-right
- Image counter ("3 of 12") at top
- Caption below image

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `images` | `GalleryImage[]` | `[]` | Gallery images |
| `columns` | `number` | `3` | Column count |
| `gap` | `string` | `'0.5rem'` | Grid gap |
| `masonry` | `boolean` | `false` | Use CSS columns masonry layout instead of grid |
| `aspectRatio` | `string` | - | Thumbnail aspect ratio (e.g. `'1'`, `'4/3'`); omit for natural ratio |
| `lightbox` | `boolean` | `true` | Enable lightbox on click |
| `dense` | `boolean` | `false` | Compact grid gap (`0.25rem`) |
| `comfortable` | `boolean` | `false` | Relaxed grid gap (`1rem`) |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `6` | Number of skeleton items to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the underlying DOM element (`$bindable()`) |
| `item` | `Snippet<[image: GalleryImage, index: number]>` | - | Custom render snippet for each grid item |

### GalleryImage Interface

```typescript
interface GalleryImage {
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
| `onselect` | `{ image: GalleryImage, index: number }` | Image clicked |
| `onlightboxopen` | `{ index: number }` | Lightbox opened |
| `onlightboxclose` | - | Lightbox closed |

## Features

### Responsive Grid
```svelte
<Gallery images={photos} columns={4} gap="1rem" />
```
- CSS Grid with configurable column count
- Consistent spacing
- Images fill cells with `object-fit: cover`

### Masonry Layout
```svelte
<Gallery images={photos} masonry columns={3} />
```
- Uses CSS `columns` property (no JavaScript masonry library)
- Each item uses `break-inside: avoid`
- Natural image heights preserved
- Fills vertical space efficiently

```css
.gallery-masonry {
  columns: var(--gallery-columns, 3);
  column-gap: var(--gallery-gap, 0.5rem);
}

.gallery-masonry-item {
  break-inside: avoid;
  margin-bottom: var(--gallery-gap, 0.5rem);
}
```

### Lightbox (via Modal)
- Click any thumbnail to open lightbox
- Uses Modal component internally with `fullscreen` mode and dark backdrop
- Large image displayed centered
- Swipe or arrow-key navigation between images
- Close via backdrop click, Escape key, or close button

### Lazy Loading Images
- Thumbnails use the Image component with native `loading="lazy"`
- Only images near the viewport are loaded
- Blur-up placeholder if `thumbnail` is provided in the image data

### Keyboard Navigation in Lightbox
- **Left/Right arrows**: navigate between images
- **Escape**: close lightbox
- **Home/End**: jump to first/last image
- Focus trapped within lightbox (handled by Modal)

## Delightful Details

### Thumbnail Hover
- Subtle scale up (`1.03x`)
- Dark overlay fades in with zoom icon
- Smooth transition (`var(--duration-fast)`)

### Image Loading
- Skeleton shimmer placeholder before image loads
- Fade-in when image is ready
- No layout shift (aspect ratio reserved via CSS)

### Lightbox Transitions
- Image fades in with subtle scale
- Background dims smoothly (via Modal backdrop)
- Caption fades in after image

### Caption Display
- Shown below image in lightbox
- White text on dark background
- Scrollable if long

### Touch Gestures in Lightbox
- Swipe left/right to navigate
- Pinch to zoom on current image
- Double-tap to zoom

## Accessibility

- All images require `alt` text
- Lightbox uses Modal with `role="dialog"` and `aria-modal="true"`
- `aria-label` on navigation buttons ("Previous image", "Next image")
- Image counter announced via `aria-live="polite"` ("Image 3 of 12")
- Keyboard navigation: arrows, Escape, Home, End
- Focus management handled by Modal

## Code Example

```svelte
<script>
  import { Gallery } from '@delightstack/components';

  let { photos } = $props();
</script>

<!-- Basic gallery -->
<Gallery images={photos} />

<!-- Masonry layout -->
<Gallery images={photos} masonry columns={3} />

<!-- Square thumbnails, no lightbox -->
<Gallery images={photos} aspectRatio="1" columns={4} lightbox={false} onselect={handleSelect} />

<!-- Comfortable spacing -->
<Gallery images={photos} comfortable columns={4} />

<!-- Custom item rendering -->
<Gallery images={portfolioImages}>
  {#snippet item(image)}
    <div class="portfolio-item">
      <img src={image.thumbnail ?? image.src} alt={image.alt} loading="lazy" />
      <span class="caption">{image.caption}</span>
    </div>
  {/snippet}
</Gallery>

<!-- Skeleton state -->
<Gallery skeleton skeletonCount={9} columns={3} />
```

## CSS Approach

```css
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(var(--gallery-columns, 3), 1fr);
  gap: var(--gallery-gap, 0.5rem);
}

.gallery-grid.dense {
  --gallery-gap: 0.25rem;
}

.gallery-grid.comfortable {
  --gallery-gap: 1rem;
}

.gallery-masonry {
  columns: var(--gallery-columns, 3);
  column-gap: var(--gallery-gap, 0.5rem);
}

.gallery-item {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.gallery-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery-item-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--color-surface-invert) 40%, transparent);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}

.gallery-item:hover .gallery-item-overlay {
  opacity: 1;
}

.gallery-item:hover img {
  transform: scale(1.03);
  transition: transform var(--duration-fast) var(--ease-default);
}

.lightbox-counter {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: var(--text-sm);
}

.lightbox-caption {
  text-align: center;
  color: light-dark(var(--color-text), white);
  padding-block: 0.75rem;
  font-size: var(--text-sm);
}
```
