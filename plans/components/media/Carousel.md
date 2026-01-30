# Carousel

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/Carousel.svelte`

## Description

A swipeable content slider for images, cards, or any content. Features smooth animations, touch support, autoplay, and multiple navigation options.

## Visual Design

### Container
- Horizontal scrolling area
- Visible overflow indicators
- Navigation arrows on sides
- Dots/indicators below

### Slides
- Full width or partial peek
- Smooth snap to position
- Gap between slides (optional)

### Navigation
- Previous/Next arrows
- Dot indicators
- Optional thumbnails
- Keyboard navigation

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `any[]` | `[]` | Carousel items |
| `current` | `number` | `0` | Current slide (bindable) |
| `loop` | `boolean` | `false` | Enable infinite loop |
| `autoplay` | `boolean \| number` | `false` | Auto-advance (ms) |
| `pauseOnHover` | `boolean` | `true` | Pause autoplay on hover |
| `showArrows` | `boolean` | `true` | Show prev/next arrows |
| `showDots` | `boolean` | `true` | Show dot indicators |
| `slidesPerView` | `number \| 'auto'` | `1` | Visible slides |
| `gap` | `string \| number` | `0` | Gap between slides |
| `peek` | `number` | `0` | Peek of adjacent slides |
| `transition` | `'slide' \| 'fade' \| 'cards'` | `'slide'` | Transition effect |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Slide direction |
| `freeScroll` | `boolean` | `false` | Free scroll without snapping |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ index }` | Slide changed |
| `onslidestart` | `{ index }` | Transition started |
| `onslideend` | `{ index }` | Transition ended |

## Features

### Touch/Swipe
- Swipe to navigate
- Momentum scrolling
- Snap to nearest slide
- Prevent vertical scroll during swipe

### Autoplay
```svelte
<Carousel autoplay={5000} loop>
```
- Auto-advance every N ms
- Pause on hover/touch
- Resume after interaction

### Multiple Slides
```svelte
<Carousel slidesPerView={3} gap="1rem">
```
- Show multiple items
- Responsive count
- Partial peek for next

### Loop Mode
- Infinite scrolling
- Seamless transition
- Clone slides for continuity

### Thumbnails
```svelte
<Carousel showThumbnails>
```
- Thumbnail strip below
- Click to navigate
- Synced highlight

## Delightful Details

### Smooth Transitions
- CSS scroll-snap for native feel
- Spring animation option
- No janky snapping

### Swipe Velocity
- Fast swipe = skip slides
- Slow swipe = adjacent only
- Natural feel

### Progressive Enhancement
- Works without JS (scroll-snap)
- Enhanced with JS interactions
- Touch and mouse support

### Arrow Visibility
- Hidden when at start/end (non-loop)
- Fade on hover
- Clear clickable area

### Dot Indicators
- Current dot highlighted
- Click to jump to slide
- Responsive sizing

### Loading States
- Skeleton slides
- Progressive image loading
- Lazy load off-screen slides

## Accessibility

- Keyboard navigation (arrows)
- ARIA live region for changes
- Pause button for autoplay
- Reduced motion support

## Code Example

```svelte
<script>
  import { Carousel } from '@delightstack/components';

  const images = [
    { src: '/image1.jpg', alt: 'Image 1' },
    { src: '/image2.jpg', alt: 'Image 2' },
    { src: '/image3.jpg', alt: 'Image 3' }
  ];
</script>

<!-- Image gallery -->
<Carousel items={images} loop>
  {#snippet slide(item)}
    <img src={item.src} alt={item.alt} />
  {/snippet}
</Carousel>

<!-- Product carousel -->
<Carousel
  items={products}
  slidesPerView={{ sm: 1, md: 2, lg: 4 }}
  gap="1rem"
>
  {#snippet slide(product)}
    <ProductCard {product} />
  {/snippet}
</Carousel>

<!-- Hero slider with autoplay -->
<Carousel
  items={heroSlides}
  autoplay={5000}
  loop
  showDots
  showArrows={false}
>
  {#snippet slide(slide)}
    <div class="hero-slide" style="background-image: url({slide.image})">
      <h2>{slide.title}</h2>
    </div>
  {/snippet}
</Carousel>
```

## Implementation Notes

- Use CSS scroll-snap as foundation
- Handle touch events for swipe
- Intersection Observer for lazy loading
- Clone slides for seamless loop
- Support RTL layouts
