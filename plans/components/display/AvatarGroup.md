# AvatarGroup

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/AvatarGroup.svelte`

## Description

A component for displaying a stack of overlapping avatars, commonly used to show multiple users or participants. Renders Avatar components internally and includes a "+N" overflow indicator when there are more avatars than can be displayed.

## Dependencies

- **Components**: `Avatar`
- **Utilities**: `@delightstack/utilities` -- `tooltip` (attachment, for individual avatar tooltips)
- **Libraries**: none

## Visual Design

### Appearance
- Avatars overlap horizontally
- Later avatars stack on top (or underneath, depending on direction)
- Consistent ring/border around each avatar to prevent visual blending
- "+N" overflow indicator when exceeding `max`

### Overlap
- Configurable overlap amount (ratio of avatar size)
- Default 25% overlap
- Ring/border prevents visual merging

### Overflow Indicator
- Styled to match avatar shape and size
- Shows "+N" where N is the number of hidden avatars
- Matches avatar ring styling
- Optionally clickable to expand

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `avatars` | `AvatarData[]` | `[]` | Array of avatar data |
| `max` | `number` | `5` | Maximum visible avatars |
| `size` | `'0' \| '1' \| '2' \| '3' \| '4' \| '5'` | `'1'` | Avatar size (passed to each Avatar) |
| `overlap` | `number` | `0.25` | Overlap ratio (0-1) |
| `direction` | `'left' \| 'right'` | `'right'` | Stack direction |
| `ringColor` | `string` | `'var(--color-bg)'` | Ring/border color around each avatar |
| `expandable` | `boolean` | `false` | Click overflow to reveal all |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `4` | Number of skeleton circles to show |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### AvatarData Interface
```typescript
interface AvatarData {
  src?: string;
  name: string;
  href?: string;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onclick` | `{ avatar: AvatarData, index: number }` | Individual avatar clicked |
| `onoverflowclick` | `{ remaining: AvatarData[] }` | Overflow "+N" indicator clicked |

## Skeleton State

When `skeleton` is true, render `skeletonCount` circular shimmer placeholders in the overlapping layout. Each placeholder matches the specified `size`. Maintains the same spacing and overlap as real avatars.

## Hover Effects

- Hovered avatar rises slightly (translateY -2px)
- Shows tooltip with the avatar's `name`
- Other avatars dim slightly (optional, subtle)

## Expand Behavior

When `expandable` is true and the overflow indicator is clicked:
- All hidden avatars are revealed
- Avatars fan out smoothly with animation
- A popover or inline expansion shows the full list

## Accessibility

- Each avatar has an accessible name (from `name` in AvatarData)
- Overflow indicator is focusable and has `aria-label` (e.g., "3 more participants")
- Screen reader announces total count
- Keyboard navigable when expandable (Enter/Space on overflow)

## CSS Approach

```css
.avatar-group {
  display: flex;
  align-items: center;
}

.avatar-group .avatar-wrapper {
  margin-left: calc(var(--avatar-size) * var(--overlap) * -1);
  box-shadow: 0 0 0 2px var(--ring-color);
  border-radius: 50%;
  position: relative;
}

.avatar-group .avatar-wrapper:first-child {
  margin-left: 0;
}

.avatar-group .overflow-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  background: light-dark(var(--color-surface-2), var(--color-surface-2));
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--ring-color);
  cursor: default;
}

.avatar-group .overflow-indicator.expandable {
  cursor: pointer;
}

.avatar-group .avatar-wrapper:hover {
  z-index: 1;
  transform: translateY(-2px);
  transition: transform 150ms ease;
}
```

## Code Example

```svelte
<script>
  import { AvatarGroup } from '@delightstack/components';

  const teamMembers = [
    { name: 'Alice', src: '/avatars/alice.jpg' },
    { name: 'Bob', src: '/avatars/bob.jpg' },
    { name: 'Charlie', src: '/avatars/charlie.jpg' },
    { name: 'Diana', src: '/avatars/diana.jpg' },
    { name: 'Eve', src: '/avatars/eve.jpg' },
    { name: 'Frank', src: '/avatars/frank.jpg' },
  ];
</script>

<!-- Basic usage -->
<AvatarGroup avatars={teamMembers} />

<!-- Limit visible -->
<AvatarGroup avatars={teamMembers} max={3} />

<!-- Small size for compact UI -->
<AvatarGroup avatars={teamMembers} size="0" max={4} />

<!-- Expandable list -->
<AvatarGroup
  avatars={teamMembers}
  max={3}
  expandable
  onoverflowclick={() => showAllParticipants()}
/>

<!-- Loading state -->
<AvatarGroup skeleton skeletonCount={4} />

<!-- Clickable avatars -->
<AvatarGroup
  avatars={teamMembers}
  onclick={({ avatar }) => openProfile(avatar)}
/>
```

## Implementation Notes

- Uses Avatar component internally for each visible avatar
- Flexbox with negative margins for overlap
- Z-index management for stacking order (hover raises z-index)
- Tooltips on each avatar showing the name
- Dynamic re-render when `avatars` array changes
- Overflow indicator count updates reactively
