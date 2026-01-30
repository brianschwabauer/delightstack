# Spinner

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Spinner.svelte`

## Description

A compact spinning loading indicator for inline use. Smaller and simpler than the Loading component, perfect for buttons, form fields, and inline loading states.

## Visual Design

### Appearance
- Circular rotating indicator
- Partial arc (not complete circle)
- Smooth continuous rotation
- Consistent stroke width

### Sizes

| Size | Dimensions | Stroke | Use Case |
|------|------------|--------|----------|
| `xs` | 12px | 1.5px | Tiny inline |
| `sm` | 16px | 2px | Buttons small |
| `md` | 20px | 2px | Buttons, inputs |
| `lg` | 24px | 2.5px | Standalone |

### Colors
- Inherits `currentColor` by default
- Adapts to parent text color
- Can be explicitly set

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `Size \| number` | `'md'` | Spinner size |
| `color` | `string` | `'currentColor'` | Spinner color |
| `speed` | `'slow' \| 'normal' \| 'fast'` | `'normal'` | Rotation speed |
| `label` | `string` | - | Accessible label |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Speed Values

| Speed | Duration |
|-------|----------|
| `slow` | 1200ms |
| `normal` | 800ms |
| `fast` | 500ms |

## Delightful Details

### Smooth Animation
- CSS animation for performance
- Consistent timing function
- No judder or stutter

### Entry Animation
- Optional fade-in on mount
- Prevents flash for fast loads
- Delay before showing

### Color Inheritance
Works naturally in context:
```svelte
<button style="color: white;">
  <Spinner /> Loading  <!-- Spinner is white -->
</button>
```

### SVG Implementation
- Crisp at any size
- Scalable via CSS
- No image assets

## Common Patterns

### In Buttons
```svelte
<Button disabled={loading}>
  {#if loading}
    <Spinner size="sm" />
  {/if}
  Submit
</Button>
```

### In Inputs
```svelte
<Input>
  {#snippet end()}
    {#if validating}
      <Spinner size="sm" />
    {/if}
  {/snippet}
</Input>
```

### Inline Text
```svelte
<p>
  Checking availability <Spinner size="xs" />
</p>
```

## Accessibility

- `role="status"` for live region
- `aria-label` for screen readers
- Hidden from accessibility tree if decorative

## Code Example

```svelte
<script>
  import { Spinner } from '@delightstack/components';

  let isSaving = $state(false);
</script>

<!-- Basic spinner -->
<Spinner />

<!-- In a button -->
<button disabled={isSaving}>
  {#if isSaving}
    <Spinner size="sm" /> Saving...
  {:else}
    Save
  {/if}
</button>

<!-- Custom color -->
<Spinner color="var(--color-success)" />

<!-- Large standalone -->
<div class="loading-container">
  <Spinner size="lg" />
  <span>Loading...</span>
</div>
```

## Implementation Notes

- SVG with animated stroke-dashoffset
- Or: CSS border with partial transparency
- Use `transform: rotate()` for animation
- GPU-accelerated (will-change: transform)
- Single element if possible
