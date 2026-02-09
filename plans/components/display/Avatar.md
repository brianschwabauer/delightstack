# Avatar

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Avatar.svelte`

## Description

A profile image component that gracefully handles missing images with initials or icon fallbacks. Supports various sizes, shapes, and status indicators for representing users and entities. The `name` prop automatically generates alt text, a deterministic background color using OKLCH hashing, and initials.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- `seededRandom` (for deterministic color hashing), `tooltip` (attachment)
- **Libraries**: none

## Visual Design

### Image State
- Circular crop (default) or rounded square
- `object-fit: cover`, centered
- Subtle border for definition on light backgrounds
- Smooth fade-in on load

### Fallback States
1. **Initials**: First letter(s) of name on OKLCH-hashed colored background
2. **Icon**: Generic user icon when no name is provided
3. **Placeholder**: Subtle gradient or pattern

### Status Indicator
- Small dot positioned bottom-right (default) or top-right
- Colors: green (online), yellow (away), red (busy), gray (offline)
- Optional pulse animation for online status

### Sizes

| Size | Dimensions | Font Size | Use Case |
|------|------------|-----------|----------|
| `'0'` | 24px | 10px | Inline mentions |
| `'1'` (default) | 32px | 12px | Comments, lists |
| `'2'` | 40px | 14px | Navigation, cards |
| `'3'` | 56px | 18px | Profile headers |
| `'4'` | 80px | 24px | Profile pages |
| `'5'` | 120px | 36px | Hero sections |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | Image URL |
| `name` | `string` | - | Name for initials fallback and auto alt text |
| `size` | `'0' \| '1' \| '2' \| '3' \| '4' \| '5'` | `'1'` | Avatar size |
| `square` | `boolean` | `false` | Rounded square shape instead of circle |
| `status` | `'online' \| 'away' \| 'busy' \| 'offline'` | - | Status indicator dot |
| `statusPosition` | `'top' \| 'bottom'` | `'bottom'` | Status dot position |
| `badge` | `number \| boolean` | - | Notification badge overlay |
| `ring` | `boolean` | `false` | Show colored ring around avatar |
| `ringColor` | `string` | `'var(--color-action)'` | Ring color |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `onclick` | `(e: MouseEvent) => void` | - | Click handler (makes avatar interactive) |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Custom fallback content |

## Fallback Logic

```
1. Try to load `src` image
2. On error or no src:
   a. If `name` provided -> show initials on colored background
   b. Else -> show default user icon
```

### Auto Alt Text

The `name` prop automatically becomes the `alt` attribute on the `<img>` element. No separate `alt` prop is needed. Decorative avatars (no name, no src) use `alt=""`.

### Initials Generation
- Single word: first letter capitalized ("Alice" -> "A")
- Two or more words: first letter of first and last word ("John Doe" -> "JD")
- Hyphenated names use the first letter of the overall first and last word ("Jean-Pierre Martin" -> "JM")

### OKLCH Deterministic Color Hashing

The background color for initials is generated deterministically from the `name` string so that the same name always produces the same color. The algorithm:

1. Compute a numeric hash from the name string (sum of char codes or similar)
2. Use `seededRandom` from `@delightstack/utilities` with the hash as seed
3. **Hue**: Derived directly from the seeded random value mapped to 0-360
4. The component accepts `minSaturation`, `maxSaturation`, `minLightness`, `maxLightness` props (or sensible defaults) to constrain the OKLCH saturation and lightness
5. **Saturation**: A second seeded random call maps within `[minSaturation, maxSaturation]` (default 0.12-0.18)
6. **Lightness**: A third seeded random call maps within `[minLightness, maxLightness]` (default 0.55-0.75)
7. Result: `oklch(L S H)` with natural variation across names while staying within accessible ranges

This produces a wide variety of pleasant, accessible background colors that are stable per name.

## Skeleton State

When `skeleton` is true, render a circular (or square) shimmering placeholder matching the specified size. No initials, image, or status indicator.

## Badge

When `badge` is provided:
- `badge={true}`: small dot indicator (no number), top-right
- `badge={5}`: circular badge with number, top-right
- Numbers above 99 display as "99+"

## Tooltip

When `tooltip` is provided, the tooltip attachment from `@delightstack/utilities` is applied to the avatar element: `{@attach tooltip(tooltipText)}`.

## Accessibility

- `name` prop auto-generates `alt` text on the image
- Decorative avatars (no name) use `alt=""`
- Status indicator has `aria-label` (e.g., "Status: online")
- Badge has `aria-label` (e.g., "3 notifications")
- Interactive avatars (with `onclick`) are focusable with keyboard support

## CSS Approach

```css
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.avatar.square {
  border-radius: var(--radius-3);
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar .initials {
  font-weight: 500;
  color: white;
  user-select: none;
}

.avatar .status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  border-radius: 50%;
  border: 2px solid var(--color-bg);
}

.avatar .status-dot.online {
  background-color: var(--color-success);
  animation: pulse 2s infinite;
}
```

## Code Example

```svelte
<script>
  import { Avatar } from '@delightstack/components';
</script>

<!-- With image -->
<Avatar
  src={user.avatarUrl}
  name={user.name}
  size="3"
  status="online"
/>

<!-- Initials fallback -->
<Avatar name="John Doe" size="2" />

<!-- With badge -->
<Avatar
  src={user.avatarUrl}
  name={user.name}
  badge={5}
/>

<!-- With tooltip -->
<Avatar
  name="Alice"
  tooltip="Alice Johnson - Online"
/>

<!-- Interactive -->
<Avatar
  src={user.avatar}
  name={user.name}
  onclick={() => openProfile(user)}
/>

<!-- In a list -->
<List>
  {#each users as user}
    <ListItem>
      {#snippet start()}
        <Avatar src={user.avatar} name={user.name} size="1" />
      {/snippet}
      {user.name}
    </ListItem>
  {/each}
</List>
```

## Implementation Notes

- Use `object-fit: cover` for images
- Generate OKLCH colors deterministically from name using `seededRandom`
- Handle broken image URLs gracefully with `onerror` fallback
- Lazy loading for avatars in lists via `loading="lazy"` on the `<img>`
- Fade-in animation on image load to avoid flash
