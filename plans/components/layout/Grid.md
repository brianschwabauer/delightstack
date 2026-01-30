# Grid

**Status**: 🔲 Placeholder
**Category**: Layout
**File**: `packages/components/src/layout/Grid.svelte`

## Description

A CSS Grid layout helper for creating responsive grid layouts. Provides sensible defaults while allowing full customization for complex layouts.

## Visual Design

This is a layout utility - no visual output, pure structure.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `columns` | `number \| string` | `12` | Column template |
| `rows` | `string` | `'auto'` | Row template |
| `gap` | `string \| number` | `'1rem'` | Grid gap |
| `columnGap` | `string \| number` | - | Column gap only |
| `rowGap` | `string \| number` | - | Row gap only |
| `align` | `string` | `'stretch'` | Align items |
| `justify` | `string` | `'stretch'` | Justify items |
| `flow` | `'row' \| 'column' \| 'dense'` | `'row'` | Auto flow |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### GridItem Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `column` | `string` | - | Grid column span |
| `row` | `string` | - | Grid row span |
| `span` | `number` | - | Shorthand for column span |

## Responsive Columns

```svelte
<Grid columns={{ sm: 1, md: 2, lg: 3 }}>
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</Grid>
```

## Preset Patterns

### Equal Columns
```svelte
<Grid columns={3}>
  <!-- 3 equal columns -->
</Grid>
```

### Auto-Fit (Responsive)
```svelte
<Grid columns="repeat(auto-fit, minmax(250px, 1fr))">
  <!-- Responsive cards -->
</Grid>
```

### Sidebar Layout
```svelte
<Grid columns="250px 1fr">
  <aside>Sidebar</aside>
  <main>Content</main>
</Grid>
```

### Complex Layout
```svelte
<Grid columns="1fr 2fr 1fr" rows="auto 1fr auto">
  <GridItem column="1 / -1">Header</GridItem>
  <GridItem>Sidebar</GridItem>
  <GridItem>Main</GridItem>
  <GridItem>Aside</GridItem>
  <GridItem column="1 / -1">Footer</GridItem>
</Grid>
```

## Delightful Details

### Responsive Gap
- Gap scales with viewport
- Or: explicit responsive gap

### Nested Grids
- Grids can nest
- Each maintains its own context

### Auto Placement
- Items auto-place by default
- Dense packing option
- Control flow direction

## Code Example

```svelte
<script>
  import { Grid, GridItem } from '@delightstack/components';
</script>

<!-- Simple card grid -->
<Grid columns={3} gap="2rem">
  {#each cards as card}
    <Card {card} />
  {/each}
</Grid>

<!-- Responsive grid -->
<Grid columns={{ sm: 1, md: 2, lg: 4 }} gap="1.5rem">
  {#each products as product}
    <ProductCard {product} />
  {/each}
</Grid>

<!-- Dashboard layout -->
<Grid columns="250px 1fr" rows="auto 1fr" gap="1rem">
  <GridItem column="1 / -1">
    <Header />
  </GridItem>
  <Sidebar />
  <main>
    <Grid columns={2} gap="1rem">
      <Widget />
      <Widget />
      <GridItem span={2}>
        <Chart />
      </GridItem>
    </Grid>
  </main>
</Grid>
```

## CSS Output

```css
.grid {
  display: grid;
  grid-template-columns: var(--columns);
  grid-template-rows: var(--rows);
  gap: var(--gap);
}

.grid-item {
  grid-column: var(--column);
  grid-row: var(--row);
}
```

## Implementation Notes

- Thin wrapper around CSS Grid
- Support responsive object syntax
- Convert numbers to repeat(n, 1fr)
- Forward all CSS grid properties
