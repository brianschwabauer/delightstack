# Avatar

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Avatar.svelte`

## Description

A profile image component that gracefully handles missing images with initials or icon fallbacks. Supports various sizes, shapes, and status indicators for representing users and entities throughout the application.

## Visual Design

### Image State
- Circular crop (default) or rounded square
- Cover fit, centered
- Subtle border for definition on light backgrounds
- Smooth fade-in on load

### Fallback States
1. **Initials**: First letter(s) of name on colored background
2. **Icon**: Generic user icon
3. **Placeholder**: Subtle gradient or pattern

### Status Indicator
- Small dot positioned bottom-right
- Colors: green (online), yellow (away), red (busy), gray (offline)
- Optional pulse animation for online

### Sizes

| Size | Dimensions | Font Size | Use Case |
|------|------------|-----------|----------|
| `xs` | 24px | 10px | Inline mentions |
| `sm` | 32px | 12px | Comments, lists |
| `md` | 40px | 14px | Navigation, cards |
| `lg` | 56px | 18px | Profile headers |
| `xl` | 80px | 24px | Profile pages |
| `2xl` | 120px | 36px | Hero sections |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | Image URL |
| `alt` | `string` | - | Alt text |
| `name` | `string` | - | Name for initials fallback |
| `size` | `Size` | `'md'` | Avatar size |
| `shape` | `'circle' \| 'square'` | `'circle'` | Shape variant |
| `status` | `'online' \| 'away' \| 'busy' \| 'offline'` | - | Status indicator |
| `statusPosition` | `'top' \| 'bottom'` | `'bottom'` | Indicator position |

## Fallback Logic

```
1. Try to load `src` image
2. On error or no src:
   a. If `name` provided → show initials
   b. Else → show default icon
```

### Initials Generation
- Single word: First letter capitalized
- Multiple words: First letter of first two words
- "John Doe" → "JD"
- "Alice" → "A"
- "Jean-Pierre Martin" → "JM"

### Background Color
- Generated from name hash for consistency
- Same name always gets same color
- Colors from a curated, accessible palette

## Delightful Details

### Image Loading
- Placeholder shown while loading
- Smooth fade-in when loaded
- No layout shift

### Initials Animation
- Subtle scale on first render
- Color transitions smoothly if name changes

### Status Pulse
```css
.status.online {
  animation: pulse 2s infinite;
}
```
- Gentle pulse for online status
- Draws attention without being annoying

### Hover Effects (Interactive)
```svelte
<Avatar src={user.avatar} onclick={() => openProfile(user)} />
```
- Subtle scale on hover
- Cursor pointer
- Focus ring for keyboard

## Avatar Group

For showing multiple avatars stacked:

```svelte
<AvatarGroup max={4}>
  {#each users as user}
    <Avatar src={user.avatar} name={user.name} />
  {/each}
</AvatarGroup>
```

- Overlapping layout
- "+3" overflow indicator
- Consistent sizing

## Accessibility

- Always requires `alt` or `name` for screen readers
- Decorative avatars use `alt=""`
- Status has `aria-label` ("User is online")

## Code Example

```svelte
<script>
  import { Avatar } from '@delightstack/components';
</script>

<!-- With image -->
<Avatar
  src={user.avatarUrl}
  name={user.name}
  alt={user.name}
  size="lg"
  status="online"
/>

<!-- Initials fallback -->
<Avatar
  name="John Doe"
  size="md"
/>

<!-- In a list -->
<List>
  {#each users as user}
    <ListItem>
      {#snippet start()}
        <Avatar src={user.avatar} name={user.name} size="sm" />
      {/snippet}
      {user.name}
    </ListItem>
  {/each}
</List>
```

### Avatar Group
```svelte
<div class="avatar-group">
  {#each team.slice(0, 3) as member}
    <Avatar src={member.avatar} name={member.name} size="sm" />
  {/each}
  {#if team.length > 3}
    <div class="overflow">+{team.length - 3}</div>
  {/if}
</div>
```

## Implementation Notes

- Use `object-fit: cover` for images
- Generate colors deterministically from name
- Handle broken image URLs gracefully
- Consider lazy loading for lists
