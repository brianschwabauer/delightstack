# AvatarGroup

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/AvatarGroup.svelte`

## Description

A component for displaying a stack of overlapping avatars, commonly used to show multiple users or participants. Includes an overflow indicator when there are more avatars than can be displayed.

## Visual Design

### Appearance
- Avatars overlap horizontally
- Later avatars stack on top (or underneath)
- Consistent ring/border around each
- "+N" overflow indicator

### Overlap
- Configurable overlap amount
- Typically 25-50% overlap
- Ring prevents visual blending

### Overflow
- Shows "+N" when exceeding max
- Overflow indicator matches avatar styling
- Click to expand (optional)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `avatars` | `AvatarData[]` | `[]` | Array of avatar data |
| `max` | `number` | `5` | Maximum visible avatars |
| `size` | `Size` | `'md'` | Avatar size |
| `overlap` | `number` | `0.25` | Overlap ratio (0-1) |
| `direction` | `'left' \| 'right'` | `'right'` | Stack direction |
| `ringColor` | `string` | `'var(--color-bg)'` | Ring/border color |
| `expandable` | `boolean` | `false` | Click overflow to show all |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### AvatarData Interface
```typescript
interface AvatarData {
  src?: string;
  name: string;
  fallback?: string;
  href?: string;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onclick` | `{ avatar, index }` | Avatar clicked |
| `onoverflowclick` | `{ remaining }` | Overflow indicator clicked |

## Delightful Details

### Hover Effects
- Hovered avatar rises slightly
- Shows tooltip with name
- Others dim slightly (optional)

### Stacking Animation
- Avatars animate in when added
- Smooth reflow when removed
- Overflow count updates smoothly

### Skeleton State
- Circular skeleton placeholders
- Shimmer animation
- Maintains layout

### Expand Animation
- Click overflow to expand
- Avatars fan out
- Popover with full list

### Ring/Border
- Consistent ring around each
- Prevents visual merging
- Matches background color

## Common Patterns

### Team Members
```svelte
<AvatarGroup
  avatars={teamMembers}
  max={4}
  size="sm"
/>
```

### With Tooltip
```svelte
<AvatarGroup avatars={participants}>
  {#snippet avatar(data, index)}
    <Tooltip content={data.name}>
      <Avatar src={data.src} name={data.name} />
    </Tooltip>
  {/snippet}
</AvatarGroup>
```

### Clickable Avatars
```svelte
<AvatarGroup
  avatars={users}
  onclick={({ avatar }) => openProfile(avatar)}
/>
```

### Expandable
```svelte
<AvatarGroup
  avatars={allParticipants}
  max={3}
  expandable
/>
```

## Accessibility

- Each avatar has accessible name
- Overflow indicator is focusable
- Screen reader announces count
- Keyboard navigable when expandable

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
<AvatarGroup avatars={teamMembers} size="sm" max={4} />

<!-- Expandable list -->
<AvatarGroup
  avatars={teamMembers}
  max={3}
  expandable
  onoverflowclick={() => showAllParticipants()}
/>

<!-- Loading state -->
<AvatarGroup skeleton avatars={[]} max={4} />

<!-- In a card header -->
<Card>
  <Card.Header>
    <span>Project Team</span>
    <AvatarGroup avatars={teamMembers} size="xs" max={3} />
  </Card.Header>
</Card>
```

## CSS Approach

```css
.avatar-group {
  display: flex;
  flex-direction: row-reverse; /* For right stacking */
}

.avatar-group > :global(*) {
  margin-left: calc(var(--size) * var(--overlap) * -1);
  box-shadow: 0 0 0 2px var(--ring-color);
  border-radius: 50%;
}

.avatar-group > :global(*:last-child) {
  margin-left: 0;
}

.overflow-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}
```

## Implementation Notes

- Use flexbox with negative margins for overlap
- Z-index management for stacking order
- Support both Avatar components and raw data
- Handle dynamic avatar changes gracefully
- Consider performance for large avatar lists
