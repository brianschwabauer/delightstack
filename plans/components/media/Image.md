# Image

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Image.svelte`

## Description

An optimized image component with loading states, lazy loading, and fallback handling. Provides a polished image experience with blur-up placeholders and error states.

## Visual Design

### Loading State
- Low-quality placeholder (LQIP)
- Blur effect
- Smooth transition to full image

### Error State
- Fallback image or icon
- Error message (optional)
- Maintains aspect ratio

### Loaded State
- Full resolution image
- Crisp rendering
- Proper aspect ratio

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | Image source URL |
| `alt` | `string` | required | Alt text (required!) |
| `width` | `number` | - | Image width |
| `height` | `number` | - | Image height |
| `aspectRatio` | `string` | - | Aspect ratio (e.g., "16/9") |
| `fit` | `'cover' \| 'contain' \| 'fill'` | `'cover'` | Object-fit |
| `position` | `string` | `'center'` | Object-position |
| `lazy` | `boolean` | `true` | Lazy load |
| `placeholder` | `string` | - | Placeholder image/color |
| `fallback` | `string` | - | Error fallback image |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onload` | `{ width, height }` | Image loaded |
| `onerror` | `{ error }` | Load failed |

## Features

### Lazy Loading
- Loads when near viewport
- Configurable threshold
- Native lazy loading with fallback

### Blur-Up Placeholder
```svelte
<Image
  src="/photo.jpg"
  placeholder="/photo-blur.jpg"
  alt="Photo"
/>
```
- Tiny blurred version shown first
- Smooth transition to full image
- Reduces perceived load time

### Aspect Ratio
```svelte
<Image src="/photo.jpg" aspectRatio="16/9" alt="Photo" />
```
- Reserves space before load
- Prevents layout shift
- Works with unknown dimensions

### Error Handling
- Shows fallback image
- Or: placeholder icon
- Error callback for logging

### Responsive Images
```svelte
<Image
  src="/photo.jpg"
  srcset="/photo-400.jpg 400w, /photo-800.jpg 800w"
  sizes="(max-width: 600px) 400px, 800px"
  alt="Photo"
/>
```
- Support srcset and sizes
- Browser picks optimal size

## Delightful Details

### Load Transition
- Blur to clear
- Opacity fade
- Smooth, not jarring

### Progressive Enhancement
- Works without JS
- Enhanced with intersection observer

### Skeleton State
- Animated skeleton while loading
- Matches image dimensions

### High-DPI Support
- Automatically use 2x images
- devicePixelRatio awareness

### Error Recovery
- Retry option
- Graceful degradation

## Accessibility

- Alt text is required
- Decorative images: `alt=""`
- Proper role for decorative

## Code Example

```svelte
<script>
  import { Image } from '@delightstack/components';
</script>

<!-- Basic image -->
<Image
  src="/photos/hero.jpg"
  alt="Hero banner"
  aspectRatio="21/9"
/>

<!-- With placeholder -->
<Image
  src="/photos/profile.jpg"
  placeholder="/photos/profile-blur.jpg"
  alt="Profile photo"
  width={200}
  height={200}
/>

<!-- Contained image -->
<Image
  src="/logos/partner.png"
  alt="Partner logo"
  fit="contain"
  width={150}
  height={100}
/>

<!-- With fallback -->
<Image
  src={user.avatar}
  fallback="/images/default-avatar.png"
  alt={user.name}
  aspectRatio="1"
/>

<!-- In a card -->
<div class="card">
  <Image
    src={post.coverImage}
    alt={post.title}
    aspectRatio="16/9"
    lazy
  />
  <div class="content">
    <h3>{post.title}</h3>
  </div>
</div>
```

## Implementation Notes

- Use Intersection Observer for lazy loading
- Support native loading="lazy"
- Generate blur placeholders server-side
- Handle broken image gracefully
- Consider CDN integration for transforms
