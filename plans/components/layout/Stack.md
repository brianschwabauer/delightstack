# Stack

**Status**: 🔲 Placeholder
**Category**: Layout
**File**: `packages/components/src/layout/Stack.svelte`

## Description

A flexbox layout helper for stacking elements vertically or horizontally with consistent spacing. The most commonly needed layout primitive for organizing content.

## Visual Design

This is a layout utility - no visual output, pure structure.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | Stack direction |
| `gap` | `string \| number` | `'1rem'` | Space between items |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` | Cross-axis alignment |
| `justify` | `'start' \| 'center' \| 'end' \| 'between' \| 'around'` | `'start'` | Main-axis alignment |
| `wrap` | `boolean` | `false` | Allow wrapping |
| `reverse` | `boolean` | `false` | Reverse order |

## Common Patterns

### Vertical Stack (Default)
```svelte
<Stack>
  <Card />
  <Card />
  <Card />
</Stack>
```
Elements stack top to bottom with gap.

### Horizontal Stack
```svelte
<Stack direction="horizontal" gap="0.5rem">
  <Button>Cancel</Button>
  <Button>Save</Button>
</Stack>
```
Elements flow left to right.

### Centered Content
```svelte
<Stack align="center" justify="center">
  <Logo />
  <h1>Welcome</h1>
</Stack>
```

### Space Between
```svelte
<Stack direction="horizontal" justify="between" align="center">
  <Logo />
  <nav>...</nav>
  <Button>Sign In</Button>
</Stack>
```

## Responsive

```svelte
<Stack
  direction={{ sm: 'vertical', md: 'horizontal' }}
  gap={{ sm: '1rem', md: '2rem' }}
>
  <!-- Vertical on mobile, horizontal on desktop -->
</Stack>
```

## Delightful Details

### Gap Consistency
- Uses CSS gap (not margins)
- No extra margin on first/last
- Clean, predictable spacing

### Flexible Items
- Items can grow/shrink naturally
- Or: controlled sizing

### Nesting
- Stacks nest cleanly
- Each maintains own context

## Shortcuts

Consider aliases for common directions:
```svelte
<VStack>  <!-- vertical -->
<HStack>  <!-- horizontal -->
```

## Code Example

```svelte
<script>
  import { Stack } from '@delightstack/components';
</script>

<!-- Vertical form fields -->
<Stack gap="1.5rem">
  <Input label="Name" />
  <Input label="Email" />
  <Input label="Message" type="textarea" />
</Stack>

<!-- Horizontal button group -->
<Stack direction="horizontal" gap="0.5rem" justify="end">
  <Button variant="ghost">Cancel</Button>
  <Button>Submit</Button>
</Stack>

<!-- Page header -->
<Stack direction="horizontal" justify="between" align="center">
  <h1>Dashboard</h1>
  <Stack direction="horizontal" gap="1rem">
    <Button variant="ghost">Export</Button>
    <Button>Add New</Button>
  </Stack>
</Stack>

<!-- Card content -->
<Stack gap="0.75rem">
  <h3>{title}</h3>
  <p>{description}</p>
  <Stack direction="horizontal" gap="0.5rem">
    <Badge>{category}</Badge>
    <Badge>{status}</Badge>
  </Stack>
</Stack>
```

## CSS Output

```css
.stack {
  display: flex;
  flex-direction: var(--direction);
  gap: var(--gap);
  align-items: var(--align);
  justify-content: var(--justify);
}
```

## Implementation Notes

- Thin wrapper around flexbox
- Support responsive props
- Convert justify aliases (between → space-between)
- Consider inline variant (inline-flex)
