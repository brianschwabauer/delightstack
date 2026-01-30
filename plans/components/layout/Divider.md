# Divider

**Status**: 🔲 Placeholder
**Category**: Layout
**File**: `packages/components/src/layout/Divider.svelte`

## Description

A visual separator for dividing content sections. Provides horizontal or vertical lines with optional text labels, supporting both structural separation and visual hierarchy.

## Visual Design

### Appearance
- Thin line (1px default)
- Subtle color (border color)
- Optional text label centered
- Optional decorative styles

### Orientations
- **Horizontal**: Full-width line (default)
- **Vertical**: Full-height line

### With Text
```
─────────── OR ───────────
```
Text centered with lines on both sides.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Line direction |
| `label` | `string` | - | Centered text |
| `labelPosition` | `'start' \| 'center' \| 'end'` | `'center'` | Label placement |
| `thickness` | `number \| string` | `1` | Line thickness |
| `color` | `string` | - | Custom line color |
| `spacing` | `string` | - | Vertical margin |
| `style` | `'solid' \| 'dashed' \| 'dotted'` | `'solid'` | Line style |

## Variants

### Simple
```svelte
<Divider />
```
Plain horizontal line.

### With Label
```svelte
<Divider label="or" />
```
Line with centered text.

### Vertical (In Flex)
```svelte
<Stack direction="horizontal">
  <div>Left</div>
  <Divider orientation="vertical" />
  <div>Right</div>
</Stack>
```

### Styled
```svelte
<Divider style="dashed" color="var(--color-action)" />
```

## Delightful Details

### Text Label Styling
- Muted text color
- Small caps option
- Background matches parent (no overlap)

### Spacing Control
- Default margin based on context
- Customizable with spacing prop
- Works in flex/grid layouts

### Semantic HTML
```svelte
<!-- Renders as <hr> when appropriate -->
<Divider />
```

## Code Example

```svelte
<script>
  import { Divider } from '@delightstack/components';
</script>

<!-- Between sections -->
<section>Content A</section>
<Divider />
<section>Content B</section>

<!-- In a list -->
<List>
  <ListItem>Item 1</ListItem>
  <Divider />
  <ListItem>Item 2</ListItem>
</List>

<!-- Login alternatives -->
<Button>Sign in with Email</Button>
<Divider label="or continue with" />
<Stack direction="horizontal" gap="1rem">
  <Button variant="outline">Google</Button>
  <Button variant="outline">GitHub</Button>
</Stack>

<!-- Vertical in toolbar -->
<Stack direction="horizontal" gap="0.5rem" align="center">
  <Button>Bold</Button>
  <Button>Italic</Button>
  <Divider orientation="vertical" />
  <Button>Link</Button>
  <Button>Image</Button>
</Stack>
```

## CSS Output

```css
.divider {
  border: none;
  border-top: 1px solid var(--divider-color, var(--border-color));
  margin: var(--spacing, 1rem) 0;
}

.divider.vertical {
  border-top: none;
  border-left: 1px solid var(--divider-color, var(--border-color));
  margin: 0 var(--spacing, 1rem);
  align-self: stretch;
}

.divider.with-label {
  display: flex;
  align-items: center;
  gap: 1rem;
}
```

## Implementation Notes

- Use `<hr>` for semantic horizontal dividers
- Use `<div>` for vertical or labeled dividers
- Handle flexbox context for vertical orientation
- Support custom decorative elements
