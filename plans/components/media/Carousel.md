# Carousel

**Category**: Media
**File**: `packages/components/src/media/Carousel.svelte`

## Description

A swipeable content slider built on CSS scroll-snap for images, cards, or any content. Features smooth native scrolling, touch/swipe support, autoplay with accessibility-conscious motion handling, loop mode, and multiple navigation options including dot indicators and arrow buttons.

## Dependencies

- **`@delightstack/utilities`**:
  - `ripple` -- material-style ripple effect on arrow button clicks (`{@attach ripple()}`)

## Visual Design

### Container
- Horizontal scrolling area using CSS `scroll-snap-type: x mandatory`
- `overflow-x: auto` with hidden scrollbar styling (`scrollbar-width: none`)
- Navigation arrows positioned on left/right edges
- Dot indicators centered below

### Slides
- Each slide snaps via `scroll-snap-align: start`
- Configurable gap between slides
- Partial peek of adjacent slides (optional)

### Navigation Arrows
- Semi-transparent circular buttons with `light-dark()` themed backgrounds
- Hidden at start/end edges when `loop` is false
- Fade in on container hover
- Focus-visible ring for keyboard access

### Dot Indicators
- Small circles centered below slides
- Current dot highlighted with `--color-action`
- Inactive dots use `--color-border`
- Click to jump to slide

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `any[]` | `[]` | Carousel items |
| `current` | `number` | `0` | Current slide index (`$bindable()`) |
| `loop` | `boolean` | `false` | Enable infinite loop (clones edge slides for seamless wrapping) |
| `autoplay` | `boolean \| number` | `false` | Auto-advance interval in ms; `true` defaults to `5000`; disabled when `prefers-reduced-motion: reduce` is active |
| `pauseOnHover` | `boolean` | `true` | Pause autoplay on hover or touch |
| `showArrows` | `boolean` | `true` | Show prev/next arrow buttons |
| `showDots` | `boolean` | `true` | Show dot indicators |
| `slidesPerView` | `number` | `1` | Number of visible slides |
| `gap` | `string` | `'0'` | CSS gap between slides |
| `peek` | `string` | `'0'` | Amount of adjacent slide visible (CSS length, e.g. `'2rem'`) |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Scroll direction |
| `skeleton` | `boolean` | `false` | Show loading skeleton placeholders |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the underlying DOM element (`$bindable()`) |
| `slide` | `Snippet<[item: any, index: number]>` | - | Render snippet for each slide |
| `children` | `Snippet` | - | Default slot content |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ index: number }` | Active slide changed |

## Features

### CSS Scroll-Snap Foundation
The carousel is built on native CSS scroll-snap for a performant, natural scrolling feel. JavaScript enhances the experience with autoplay, loop cloning, and programmatic navigation but the core scrolling works without JS.

```css
.carousel-track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  gap: var(--carousel-gap);
}

.carousel-slide {
  scroll-snap-align: start;
  flex: 0 0 calc((100% - (var(--slides-per-view) - 1) * var(--carousel-gap)) / var(--slides-per-view));
}
```

### Touch/Swipe Support
- Native touch scrolling via CSS scroll-snap (no custom gesture code needed)
- Snap to nearest slide on release
- Momentum scrolling on iOS/Android
- Vertical scroll not blocked during horizontal swipe (handled by browser natively)

### Autoplay with Motion Respect
```svelte
<Carousel autoplay={5000} loop>
  {#snippet slide(item)}
    <img src={item.src} alt={item.alt} />
  {/snippet}
</Carousel>
```
- Auto-advances every N milliseconds
- Pauses on hover/focus/touch when `pauseOnHover` is true
- **Completely disabled** when `prefers-reduced-motion: reduce` is active (checked via `matchMedia`)
- Resumes after user interaction ends

### Loop Mode
- Clones first and last slides at opposite ends for seamless infinite scrolling
- When scroll reaches a clone, instantly resets position to the real slide (no visual jump)
- Arrow buttons always enabled in loop mode

### Multiple Slides Per View
```svelte
<Carousel slidesPerView={3} gap="1rem">
  {#snippet slide(product)}
    <ProductCard {product} />
  {/snippet}
</Carousel>
```
- Shows N items at once
- Scrolls one slide at a time
- Handles edge cases when items < slidesPerView

### Dot Indicators
- One dot per slide (or per "page" when `slidesPerView` > 1)
- Current dot highlighted
- Click to jump to corresponding slide
- Uses `role="tablist"` with `role="tab"` per dot

### Arrow Navigation
- Previous/Next buttons on container edges
- Hidden when at boundaries (non-loop mode)
- Keyboard accessible with focus ring

## Delightful Details

### Arrow Visibility
- Arrows fade in on container hover, hidden otherwise
- At first slide, previous arrow hidden (non-loop); at last slide, next arrow hidden
- Clear clickable area with padding for easy targeting

### Smooth Scroll
- `scroll-behavior: smooth` on the track for programmatic navigation
- Native snap deceleration for touch

### Skeleton State
- When `skeleton` is true, renders placeholder slide shapes with animated shimmer
- Respects `slidesPerView` to show correct number of skeleton items

## Accessibility

- `role="region"` with `aria-label="Carousel"` on container
- `aria-roledescription="carousel"` on container
- Each slide has `role="group"` with `aria-roledescription="slide"` and `aria-label="N of M"`
- Dot indicators use `role="tablist"` / `role="tab"` pattern
- Keyboard navigation: Left/Right arrows move between slides when focused
- `aria-live="polite"` region announces slide changes
- Autoplay includes a visible pause button; autoplay fully disabled when `prefers-reduced-motion: reduce`

## Code Example

```svelte
<script>
  import { Carousel } from '@delightstack/components';

  let { images } = $props();
  let current = $state(0);
</script>

<!-- Image carousel with dots and arrows -->
<Carousel items={images} bind:current loop>
  {#snippet slide(item)}
    <img src={item.src} alt={item.alt} />
  {/snippet}
</Carousel>

<!-- Product carousel, multiple per view -->
<Carousel items={products} slidesPerView={3} gap="1rem">
  {#snippet slide(product)}
    <ProductCard {product} />
  {/snippet}
</Carousel>

<!-- Hero slider with autoplay -->
<Carousel items={heroSlides} autoplay={5000} loop showArrows={false}>
  {#snippet slide(item)}
    <div class="hero-slide" style="background-image: url({item.image})">
      <h2>{item.title}</h2>
    </div>
  {/snippet}
</Carousel>

<!-- Skeleton state -->
<Carousel skeleton slidesPerView={3} />
```

## CSS Approach

```css
.carousel {
  position: relative;
  overflow: hidden;
}

.carousel-track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  gap: var(--carousel-gap, 0);
}

.carousel-track::-webkit-scrollbar {
  display: none;
}

.carousel-slide {
  scroll-snap-align: start;
  flex: 0 0 var(--slide-width);
}

.carousel-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  background: light-dark(
    color-mix(in oklch, var(--color-surface) 90%, transparent),
    color-mix(in oklch, var(--color-surface) 80%, transparent)
  );
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}

.carousel:hover .carousel-arrow {
  opacity: 1;
}

.carousel-arrow.prev { left: 0.5rem; }
.carousel-arrow.next { right: 0.5rem; }

.carousel-dots {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding-block: 0.75rem;
}

.carousel-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--color-border);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default);
}

.carousel-dot.active {
  background: var(--color-action);
}
```
