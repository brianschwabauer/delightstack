# BottomSheet

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/BottomSheet.svelte`

## Description

A mobile-style slide-up panel for secondary content or actions. Emerges from the bottom of the screen with smooth drag gestures, commonly used for mobile navigation, filters, or contextual options.

## Visual Design

### Container
- Slides up from bottom edge
- Rounded top corners
- Handle/grip indicator at top
- Semi-transparent backdrop

### Handle
- Small pill-shaped indicator
- Centered at top
- Visual cue for dragging
- Subtle color

### Content Area
- Scrollable when tall
- Safe bottom padding (notch)
- Maximum height constraint

### Backdrop
- Semi-transparent overlay
- Click to dismiss
- Blur effect (optional)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `snapPoints` | `number[]` | `[0.5, 1]` | Snap positions (0-1) |
| `defaultSnap` | `number` | `0` | Initial snap index |
| `dismissible` | `boolean` | `true` | Allow dismiss by gesture |
| `showHandle` | `boolean` | `true` | Show drag handle |
| `showBackdrop` | `boolean` | `true` | Show backdrop |
| `blocking` | `boolean` | `true` | Prevent body scroll |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onopen` | - | Sheet opened |
| `onclose` | - | Sheet closed |
| `onsnap` | `{ index, height }` | Snapped to position |

## Snap Points

```svelte
<BottomSheet snapPoints={[0.25, 0.5, 1]}>
```
- 0.25: Quarter height
- 0.5: Half height
- 1: Full height

Drag releases snap to nearest point.

## Features

### Drag Gestures
- Drag handle to resize
- Swipe down to dismiss
- Velocity-based snapping
- Resistance at boundaries

### Scroll Integration
- Content scrollable at full height
- Scroll-to-dismiss when at top
- Smooth handoff between gestures

### Keyboard Avoidance
- Adjusts for on-screen keyboard
- Maintains visibility of focused input

### Safe Areas
- Respects device safe areas
- Proper notch handling
- Home indicator spacing

## Delightful Details

### Spring Animation
- Natural spring physics
- Overshoots slightly
- Settles smoothly

### Backdrop Fade
- Opacity tied to sheet position
- More open = darker backdrop
- Smooth correlation

### Rubber Banding
- Stretch effect at limits
- Pull past edge springs back
- Satisfying resistance

### Handle Feedback
- Subtle scale on touch
- Indicates grab state

### Scroll Lock
- Background doesn't scroll
- Returns to position on close

## Accessibility

- Focus trapped when open
- Escape to close
- Screen reader announcements
- Proper role (dialog)

## Code Example

```svelte
<script>
  import { BottomSheet, List, ListItem } from '@delightstack/components';

  let sheetOpen = $state(false);
</script>

<Button onclick={() => sheetOpen = true}>
  Open Options
</Button>

<BottomSheet bind:open={sheetOpen}>
  <List>
    <ListItem onclick={handleShare}>Share</ListItem>
    <ListItem onclick={handleEdit}>Edit</ListItem>
    <ListItem onclick={handleDelete}>Delete</ListItem>
  </List>
</BottomSheet>

<!-- Filter sheet with multiple snap points -->
<BottomSheet
  bind:open={filterOpen}
  snapPoints={[0.4, 0.8]}
  defaultSnap={0}
>
  <div class="filter-content">
    <h3>Filters</h3>
    <!-- filter options -->
  </div>
</BottomSheet>

<!-- Full screen sheet for complex content -->
<BottomSheet
  bind:open={detailOpen}
  snapPoints={[1]}
>
  <div class="detail-view">
    <header>
      <h2>Item Details</h2>
      <Button onclick={() => detailOpen = false}>Close</Button>
    </header>
    <!-- full content -->
  </div>
</BottomSheet>
```

## Implementation Notes

- Use CSS transforms for performance
- Touch event handling for gestures
- Spring physics for animations
- Portal to body for proper stacking
- Handle both touch and mouse
