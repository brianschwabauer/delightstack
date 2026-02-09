# Image

**Category**: Media
**File**: `packages/components/src/media/Image.svelte`

## Description

An optimized image component with native lazy loading, blur-up placeholder technique, responsive `srcset`/`sizes` support, and graceful error fallback handling. Provides a polished image experience that prevents layout shift and reduces perceived load times.

## Dependencies

None. This is a standalone component using native browser APIs only.

## Visual Design

### Loading State
- Low-quality blurred placeholder displayed immediately (blur-up technique)
- Smooth crossfade transition to full image when loaded
- Skeleton shimmer when `skeleton` is true

### Error State
- Broken image icon (SVG) centered in the container
- Or custom fallback image via `fallback` prop
- Maintains aspect ratio to prevent layout shift
- Muted background color (`--color-surface-raised`)

### Loaded State
- Full resolution image, crisp rendering
- Proper aspect ratio preserved
- `object-fit` and `object-position` applied

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | Image source URL |
| `alt` | `string` | required | Alt text (required for accessibility) |
| `width` | `number` | - | Image width in pixels |
| `height` | `number` | - | Image height in pixels |
| `aspectRatio` | `string` | - | CSS aspect ratio (e.g. `'16/9'`, `'1'`) |
| `fit` | `'cover' \| 'contain' \| 'fill' \| 'none'` | `'cover'` | CSS `object-fit` value |
| `position` | `string` | `'center'` | CSS `object-position` value |
| `lazy` | `boolean` | `true` | Use native `loading="lazy"` |
| `placeholder` | `string` | - | Low-resolution placeholder image URL for blur-up effect |
| `fallback` | `string \| boolean` | `false` | Error fallback: a URL for a custom image, or `true` for the default broken-image icon |
| `srcset` | `string` | - | Responsive image `srcset` attribute |
| `sizes` | `string` | - | Responsive image `sizes` attribute |
| `skeleton` | `boolean` | `false` | Show skeleton shimmer placeholder |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the underlying DOM element (`$bindable()`) |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onload` | `{ naturalWidth: number, naturalHeight: number }` | Image loaded successfully |
| `onerror` | `{ error: Event }` | Image failed to load |

## Features

### Native Lazy Loading
```svelte
<Image src="/photos/hero.jpg" alt="Hero" lazy />
```
- Uses the browser's native `loading="lazy"` attribute
- No custom IntersectionObserver needed
- The browser handles viewport proximity detection efficiently
- Set `lazy={false}` for above-the-fold images that should load immediately

### Blur-Up Placeholder
```svelte
<Image
  src="/photos/portrait.jpg"
  placeholder="/photos/portrait-lqip.jpg"
  alt="Portrait"
/>
```
- Displays a tiny, heavily compressed placeholder image immediately
- Placeholder is rendered at full size with CSS `filter: blur(20px)` and `transform: scale(1.1)` to hide pixelation
- When the full image loads, it crossfades in over `300ms`
- **Build-time step required**: The low-resolution placeholder images (typically 20-40px wide, ~200 bytes as base64 data URIs) must be generated during the build process using a tool like `sharp`, `sqip`, or a framework image pipeline. This component does not generate placeholders at runtime.

### Error Fallback
```svelte
<!-- Default broken-image icon -->
<Image src={user.avatar} fallback alt={user.name} />

<!-- Custom fallback image -->
<Image src={user.avatar} fallback="/images/default-avatar.png" alt={user.name} />
```
- When the image fails to load, displays a fallback
- `fallback={true}`: shows a built-in broken-image SVG icon centered in a muted container
- `fallback="/path/to/image.png"`: shows the specified fallback image
- Maintains the container's aspect ratio so layout does not shift

### Responsive Images with srcset/sizes
```svelte
<Image
  src="/photos/hero.jpg"
  srcset="/photos/hero-400.jpg 400w, /photos/hero-800.jpg 800w, /photos/hero-1200.jpg 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1000px) 800px, 1200px"
  alt="Hero banner"
/>
```
- Passes `srcset` and `sizes` directly to the underlying `<img>` element
- Browser selects the optimal image size based on viewport and device pixel ratio
- Works in combination with lazy loading and blur-up placeholder

### Aspect Ratio Preservation
```svelte
<Image src="/photo.jpg" aspectRatio="16/9" alt="Photo" />
```
- CSS `aspect-ratio` reserves space before image loads
- Prevents cumulative layout shift (CLS)
- Works with or without explicit `width`/`height`

## Delightful Details

### Load Transition
- Placeholder (blurred) crossfades to full image
- Opacity transition over `300ms` with `ease-out`
- No jarring pop-in

### Skeleton State
- Animated shimmer gradient when `skeleton` is true
- Respects `aspectRatio`, `width`, `height` for correct placeholder dimensions

### Error Recovery
- Error state shown immediately on failure
- If `src` changes after an error, attempts to load the new source

## Accessibility

- `alt` prop is required; the component warns in development if omitted
- For decorative images, pass `alt=""`
- `role="img"` applied when showing fallback content
- No additional ARIA needed for standard image display

## Code Example

```svelte
<script>
  import { Image } from '@delightstack/components';

  let { user, post } = $props();
</script>

<!-- Basic image with aspect ratio -->
<Image
  src="/photos/hero.jpg"
  alt="Hero banner"
  aspectRatio="21/9"
/>

<!-- Blur-up placeholder -->
<Image
  src="/photos/profile.jpg"
  placeholder="data:image/jpeg;base64,/9j/4AAQ..."
  alt="Profile photo"
  width={200}
  height={200}
/>

<!-- Responsive with srcset -->
<Image
  src="/photos/landscape.jpg"
  srcset="/photos/landscape-400.jpg 400w, /photos/landscape-800.jpg 800w"
  sizes="(max-width: 600px) 400px, 800px"
  alt="Mountain landscape"
/>

<!-- With fallback -->
<Image
  src={user.avatar}
  fallback="/images/default-avatar.png"
  alt={user.name}
  aspectRatio="1"
/>

<!-- Contained image (e.g. logo) -->
<Image
  src="/logos/partner.png"
  alt="Partner logo"
  fit="contain"
  width={150}
  height={100}
/>

<!-- Skeleton state -->
<Image skeleton aspectRatio="16/9" />
```

## CSS Approach

```css
.image-container {
  position: relative;
  overflow: hidden;
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
}

.image-container img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--image-fit, cover);
  object-position: var(--image-position, center);
}

.image-placeholder {
  position: absolute;
  inset: 0;
  filter: blur(20px);
  transform: scale(1.1);
  transition: opacity 300ms var(--ease-default);
}

.image-placeholder.loaded {
  opacity: 0;
  pointer-events: none;
}

.image-main {
  opacity: 0;
  transition: opacity 300ms var(--ease-default);
}

.image-main.loaded {
  opacity: 1;
}

.image-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
  color: var(--color-text-muted);
}

.image-fallback svg {
  width: 2rem;
  height: 2rem;
  opacity: 0.5;
}
```
