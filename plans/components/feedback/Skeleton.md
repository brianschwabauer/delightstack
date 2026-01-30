# Skeleton

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Skeleton.svelte`

## Description

A placeholder component that mimics content structure while loading. Creates a better perceived performance by showing the layout before data arrives, reducing layout shift and providing visual feedback.

## Visual Design

### Appearance
- Gray/neutral background
- Subtle shimmer animation
- Matches content shape
- Rounded corners

### Animation
- Subtle gradient sweep (shimmer)
- Left to right movement
- Continuous loop
- Not too fast or distracting

### Shapes
- Rectangle (text, buttons)
- Circle (avatars)
- Custom shapes via CSS

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'text' \| 'circular' \| 'rectangular'` | `'text'` | Shape |
| `width` | `string \| number` | `'100%'` | Width |
| `height` | `string \| number` | - | Height |
| `lines` | `number` | `1` | Number of text lines |
| `animation` | `'shimmer' \| 'pulse' \| 'none'` | `'shimmer'` | Animation type |
| `rounded` | `boolean \| string` | `true` | Border radius |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Presets

### Text
```svelte
<Skeleton variant="text" />
```
- Single line of text height
- Slight radius
- Full width or auto

### Text Block
```svelte
<Skeleton variant="text" lines={3} />
```
- Multiple lines
- Last line shorter (natural feel)
- Consistent spacing

### Circular
```svelte
<Skeleton variant="circular" width={48} />
```
- Perfect circle
- For avatars, icons

### Rectangular
```svelte
<Skeleton variant="rectangular" height={200} />
```
- Custom dimensions
- For images, cards

## Compound Skeletons

Create complex loading states by combining:

```svelte
<!-- Card skeleton -->
<div class="card-skeleton">
  <Skeleton variant="rectangular" height={150} />
  <div class="content">
    <Skeleton variant="text" width="60%" />
    <Skeleton variant="text" lines={2} />
  </div>
</div>

<!-- List item skeleton -->
<div class="list-item-skeleton">
  <Skeleton variant="circular" width={40} />
  <div class="text">
    <Skeleton variant="text" width="70%" />
    <Skeleton variant="text" width="50%" />
  </div>
</div>
```

## Delightful Details

### Shimmer Effect
```css
background: linear-gradient(
  90deg,
  var(--skeleton-base) 0%,
  var(--skeleton-highlight) 50%,
  var(--skeleton-base) 100%
);
animation: shimmer 1.5s infinite;
```

### Pulse Alternative
- Simple opacity pulse
- Less visually active
- Better for large areas

### Matching Content
- Skeleton height matches real content
- Same margins/padding
- Smooth transition to real content

### Staggered Animation
For multiple skeletons:
- Slight animation delay offset
- Creates wave effect
- More visually interesting

## Accessibility

- `aria-hidden="true"` (decorative)
- Real content announced when loaded
- Respects reduced motion (no animation)

## Code Example

```svelte
<script>
  import { Skeleton } from '@delightstack/components';

  let user = $state(null);

  onMount(async () => {
    user = await fetchUser();
  });
</script>

{#if user}
  <div class="profile">
    <Avatar src={user.avatar} />
    <h2>{user.name}</h2>
    <p>{user.bio}</p>
  </div>
{:else}
  <div class="profile">
    <Skeleton variant="circular" width={64} height={64} />
    <Skeleton variant="text" width="60%" height={24} />
    <Skeleton variant="text" lines={2} />
  </div>
{/if}
```

### Skeleton Wrapper
```svelte
<!-- Auto-skeleton any component -->
<Skeleton loading={isLoading}>
  <Card data={cardData} />
</Skeleton>
```
- Automatically renders skeleton version
- Transitions to real content

## Implementation Notes

- Use CSS animations (GPU accelerated)
- Single animation for synced shimmer
- Handle very long content gracefully
- Consider content-visibility for performance
- Match real component dimensions exactly
