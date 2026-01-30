# Breadcrumbs

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Breadcrumbs.svelte`

## Description

A navigation trail showing the user's location within the application hierarchy. Helps users understand where they are and navigate back to parent pages.

## Visual Design

### Layout
- Horizontal list of links
- Separator between items
- Last item shows current page
- Truncates on overflow

### Items
- Clickable links (except last)
- Subtle text color
- Current item highlighted
- Optional icons

### Separator
- Chevron or slash (configurable)
- Consistent spacing
- Muted color

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `BreadcrumbItem[]` | `[]` | Breadcrumb items |
| `separator` | `'chevron' \| 'slash' \| Component` | `'chevron'` | Separator style |
| `maxItems` | `number` | - | Max visible items |
| `showHome` | `boolean` | `true` | Show home icon first |
| `homeHref` | `string` | `'/'` | Home link destination |
| `dense` | `boolean` | `false` | Compact item spacing |
| `comfortable` | `boolean` | `false` | Relaxed item spacing |

### BreadcrumbItem Interface
```typescript
interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: Component;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onclick` | `{ item, index }` | Item clicked |

## Features

### Collapsing
When exceeding `maxItems`:
```
Home / ... / Parent / Current
```
- Ellipsis menu for hidden items
- Click to expand or show menu

### Icons
```svelte
<Breadcrumbs items={[
  { label: 'Home', href: '/', icon: HomeIcon },
  { label: 'Products', href: '/products', icon: BoxIcon },
  { label: 'Laptops' }
]} />
```

### Current Page
- Last item is not a link
- Different styling (bolder)
- Indicates current location

### Responsive
- Truncates labels on mobile
- Collapses to essential items
- Expandable on tap

## Delightful Details

### Hover Effects
- Link underline on hover
- Subtle color change
- Clear clickability

### Separator Animation
- Slight animation on route change
- Helps indicate progression

### Truncation
- Long labels truncate with ellipsis
- Tooltip shows full text
- Consistent item widths

### Loading State
- Skeleton items while loading
- Smooth transition to real content

## Accessibility

- `<nav>` with `aria-label="Breadcrumb"`
- Proper `<ol>/<li>` list structure
- `aria-current="page"` on last item
- Keyboard navigable

## Code Example

```svelte
<script>
  import { Breadcrumbs } from '@delightstack/components';

  const items = [
    { label: 'Home', href: '/' },
    { label: 'Products', href: '/products' },
    { label: 'Electronics', href: '/products/electronics' },
    { label: 'Laptops' }  // Current page (no href)
  ];
</script>

<!-- Basic breadcrumbs -->
<Breadcrumbs {items} />

<!-- With custom separator -->
<Breadcrumbs {items} separator="slash" />

<!-- Limited items with collapse -->
<Breadcrumbs {items} maxItems={3} />

<!-- Without home icon -->
<Breadcrumbs {items} showHome={false} />

<!-- Dynamic from route -->
<script>
  import { page } from '$app/stores';

  $: breadcrumbItems = generateBreadcrumbs($page.url.pathname);
</script>

<Breadcrumbs items={breadcrumbItems} />
```

## Schema.org Integration

For SEO, consider outputting structured data:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [...]
}
</script>
```

## Implementation Notes

- Semantic HTML with nav/ol/li
- Support both href and onclick
- Handle SvelteKit page transitions
- Consider structured data output
