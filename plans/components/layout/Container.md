# Container

**Status**: 🔲 Placeholder
**Category**: Layout
**File**: `packages/components/src/layout/Container.svelte`

## Description

A max-width content wrapper that centers content and provides consistent horizontal padding. The foundation for page layouts, ensuring content doesn't stretch too wide on large screens.

## Visual Design

### Behavior
- Centers content horizontally
- Applies max-width constraint
- Responsive padding at edges
- Transparent (no visual output)

### Widths

| Size | Max Width | Use Case |
|------|-----------|----------|
| `xs` | 480px | Narrow content, forms |
| `sm` | 640px | Blog posts, focused content |
| `md` | 768px | Standard content |
| `lg` | 1024px | Wider content |
| `xl` | 1280px | Full-width layouts |
| `full` | 100% | No max-width |

### Padding Scale

| Breakpoint | Padding |
|------------|---------|
| Mobile | 16px |
| Tablet | 24px |
| Desktop | 32px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `Size` | `'lg'` | Max-width preset |
| `maxWidth` | `string` | - | Custom max-width |
| `padding` | `boolean` | `true` | Apply horizontal padding |
| `center` | `boolean` | `true` | Center the container |
| `as` | `string` | `'div'` | HTML element to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Usage Patterns

### Page Layout
```svelte
<Container>
  <Header />
  <main>
    <!-- page content -->
  </main>
  <Footer />
</Container>
```

### Narrow Content
```svelte
<Container size="sm">
  <article>
    <!-- blog post -->
  </article>
</Container>
```

### Full-Width with Constrained Sections
```svelte
<section class="hero">
  <!-- full-width hero -->
</section>

<Container size="md">
  <!-- constrained content -->
</Container>
```

### Custom Max-Width
```svelte
<Container maxWidth="900px">
  <!-- custom width content -->
</Container>
```

## Delightful Details

### Responsive Padding
- Padding adjusts with viewport
- Never feels cramped on mobile
- Comfortable margins on desktop

### Breakout Support
```svelte
<Container>
  <div class="breakout">
    <!-- full-width image within container -->
  </div>
</Container>

<style>
  .breakout {
    width: 100vw;
    margin-left: calc(50% - 50vw);
  }
</style>
```

### Nested Containers
- Safe to nest
- Inner container respects outer
- Useful for section-specific widths

## Code Example

```svelte
<script>
  import { Container } from '@delightstack/components';
</script>

<!-- Standard page layout -->
<Container>
  <h1>Page Title</h1>
  <p>Content goes here...</p>
</Container>

<!-- Blog post (narrow) -->
<Container size="sm" as="article">
  <h1>Article Title</h1>
  <p>Article content with comfortable reading width...</p>
</Container>

<!-- Settings page with form -->
<Container size="xs">
  <h1>Settings</h1>
  <Form>
    <!-- form fields -->
  </Form>
</Container>

<!-- No padding (custom handling) -->
<Container padding={false}>
  <div class="custom-layout">
    <!-- custom padding -->
  </div>
</Container>
```

## CSS Output

```css
.container {
  width: 100%;
  max-width: var(--container-max-width);
  margin-left: auto;
  margin-right: auto;
  padding-left: var(--container-padding);
  padding-right: var(--container-padding);
}
```

## Implementation Notes

- Simple CSS-only implementation
- CSS custom properties for customization
- Support semantic elements (main, section, article)
- Work with CSS Grid/Flexbox parents
