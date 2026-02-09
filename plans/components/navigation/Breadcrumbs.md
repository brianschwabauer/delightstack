# Breadcrumbs

**Category**: Navigation
**File**: `packages/components/src/navigation/Breadcrumbs.svelte`

## Description

A navigation trail showing the user's location within the application hierarchy. Supports collapsing long trails into an ellipsis dropdown menu, outputs Schema.org BreadcrumbList structured data for SEO, and allows fully custom separators via a snippet.

## Dependencies

- **Components**: `Popover`, `Menu`, `MenuItem` -- used internally for the ellipsis dropdown when breadcrumbs are collapsed
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Layout
- Horizontal list of links separated by configurable separators
- Last item styled as the current page (non-linked, bolder weight)
- Truncates individual labels with text-overflow ellipsis when space is limited
- Tooltip on truncated items shows full text

### Items
- Clickable links for all items except the last (current page)
- Subtle text color (`--color-text-secondary`), current item uses `--color-text-primary`
- Optional leading icon per item
- Hover underline on linked items

### Separator
- Displayed between each breadcrumb item
- Default is a chevron icon (`>`)
- Consistent spacing and muted color (`--color-text-tertiary`)

### Collapsed State
When items exceed `maxItems`:
```
Home > ... > Parent > Current
```
- First item always visible
- Last `maxItems - 2` items visible (always includes the current page)
- Hidden middle items accessible via an ellipsis dropdown menu (uses Popover/Menu internally)
- Clicking "..." opens a dropdown listing the hidden items

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `BreadcrumbItem[]` | `[]` | Breadcrumb items to display |
| `maxItems` | `number` | - | Maximum visible items before collapsing |
| `showHome` | `boolean` | `true` | Show a home icon as the first breadcrumb |
| `homeHref` | `string` | `'/'` | Home link destination |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Text and spacing size |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `3` | Number of skeleton items to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Custom rendering (overrides `items`) |
| `separator` | `Snippet` | - | Custom separator content |
| `onclick` | `(detail: { item: BreadcrumbItem, index: number }) => void` | - | Fires when a breadcrumb item is clicked |

### BreadcrumbItem Interface

```typescript
interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: Component;
}
```

## Schema.org Structured Data

The component automatically renders a `<script type="application/ld+json">` block containing Schema.org BreadcrumbList structured data. This is generated from the `items` array:

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://example.com/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Products",
      "item": "https://example.com/products"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "Laptops"
    }
  ]
}
```

Items without an `href` (the current page) omit the `item` property. The base URL is resolved from the current page URL.

## Custom Separator

The default separator is a chevron icon. Override it with the `separator` snippet:

```svelte
<Breadcrumbs {items}>
  {#snippet separator()}
    <span class="custom-sep">/</span>
  {/snippet}
</Breadcrumbs>
```

```svelte
<Breadcrumbs {items}>
  {#snippet separator()}
    <ArrowRightIcon size={12} />
  {/snippet}
</Breadcrumbs>
```

## Collapsing Behavior

When `maxItems` is set and the number of items exceeds it:

1. The first item (or home icon) is always shown.
2. An ellipsis button ("...") replaces the hidden middle items.
3. The last `maxItems - 2` items are shown (always including the current page).
4. Clicking the ellipsis opens a dropdown menu (Popover + Menu) listing all hidden items as clickable links.
5. Selecting an item from the dropdown navigates to it and closes the menu.

## Responsive Behavior

- On narrow viewports, individual labels truncate with `text-overflow: ellipsis` and `max-width` constraints.
- The `maxItems` collapsing engages automatically when items exceed the threshold.
- Full label text is available via tooltip on hover for truncated items.

## Delightful Details

### Hover Effects
- Link underline appears on hover
- Subtle color transition to `--color-text-primary`
- Clear clickability indication

### Separator Spacing
- Consistent gap around separators using flexbox
- Separators are purely decorative (`aria-hidden="true"`)

### Skeleton State
When `skeleton` is true, render `skeletonCount` shimmering placeholder bars separated by static separator shapes. Maintains the same layout dimensions as real breadcrumbs.

## Accessibility

- `<nav>` element with `aria-label="Breadcrumb"`
- Semantic `<ol>` / `<li>` list structure
- `aria-current="page"` on the last item (current page)
- Separators marked `aria-hidden="true"`
- Keyboard navigable (Tab through links)
- Ellipsis dropdown is keyboard accessible (Enter/Space to open, arrow keys within)

## CSS Approach

```css
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-sm);
  color: light-dark(var(--color-text-secondary), var(--color-text-secondary));
}

.breadcrumb-item a {
  color: inherit;
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-default);
}

.breadcrumb-item a:hover {
  color: light-dark(var(--color-text-primary), var(--color-text-primary));
  text-decoration: underline;
}

.breadcrumb-item.current {
  color: light-dark(var(--color-text-primary), var(--color-text-primary));
  font-weight: var(--font-weight-medium);
}

.breadcrumb-separator {
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
  display: flex;
  align-items: center;
}

.breadcrumb-label {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

## Code Example

```svelte
<script>
  import { Breadcrumbs } from '@delightstack/components';

  const items = [
    { label: 'Home', href: '/' },
    { label: 'Products', href: '/products' },
    { label: 'Electronics', href: '/products/electronics' },
    { label: 'Laptops' }
  ];
</script>

<!-- Basic breadcrumbs -->
<Breadcrumbs {items} />

<!-- With collapse for long trails -->
<Breadcrumbs {items} maxItems={3} />

<!-- Custom slash separator -->
<Breadcrumbs {items}>
  {#snippet separator()}
    <span>/</span>
  {/snippet}
</Breadcrumbs>

<!-- Without home icon -->
<Breadcrumbs {items} showHome={false} />

<!-- With icons -->
<Breadcrumbs items={[
  { label: 'Home', href: '/', icon: HomeIcon },
  { label: 'Products', href: '/products', icon: BoxIcon },
  { label: 'Laptops' }
]} />

<!-- Skeleton loading -->
<Breadcrumbs skeleton skeletonCount={4} />

<!-- Dynamic from SvelteKit route -->
<script>
  import { page } from '$app/state';

  const breadcrumbItems = $derived(generateBreadcrumbs(page.url.pathname));
</script>

<Breadcrumbs items={breadcrumbItems} />
```
