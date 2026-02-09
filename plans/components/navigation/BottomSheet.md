# BottomSheet

**Category**: Navigation
**File**: `packages/components/src/navigation/BottomSheet.svelte`

## Description

A mobile-first slide-up panel for secondary content or actions. Features spring physics for gesture handling, configurable snap points (collapsed/peek, half, expanded, dismissed), a drag handle indicator, rubber banding at boundaries, and smooth scroll-to-dismiss integration. Distinct from Drawer: BottomSheet is mobile-first, touch-driven, and always emerges from the bottom; Drawer is desktop-friendly, supports any edge, and is pointer-driven.

## Dependencies

- **Components**: `Portal` -- used for DOM placement to ensure proper stacking context
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Container
- Slides up from the bottom edge of the viewport
- Rounded top corners (`--radius-lg`)
- Elevation shadow above the sheet (`--shadow-lg`)
- Background uses `light-dark()` for automatic theming
- Maximum height respects safe area insets

### Drag Handle
- Small pill-shaped indicator centered at the top of the sheet
- Width: 36px, Height: 4px, rounded
- Muted color (`--color-text-tertiary`)
- Visual cue that the sheet is draggable
- Subtle scale feedback on touch

### Content Area
- Scrollable when the sheet is at its maximum snap point
- Safe bottom padding for devices with home indicator/notch
- Content scrolling is disabled at intermediate snap points (to prioritize sheet dragging)

### Backdrop
- Semi-transparent dark overlay behind the sheet
- Opacity correlates with sheet height (more open = darker)
- Click/tap to dismiss (when `dismissible` is true)
- Optional backdrop blur effect

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `snapPoints` | `number[]` | `[0.5, 1]` | Snap positions as fractions of viewport height (0-1) |
| `defaultSnap` | `number` | `0` | Index into `snapPoints` for the initial snap position on open |
| `snap` | `number` | - | Current snap index (`$bindable()`) |
| `dismissible` | `boolean` | `true` | Allow dismissing by dragging down past the lowest snap point |
| `showHandle` | `boolean` | `true` | Show the drag handle indicator |
| `showBackdrop` | `boolean` | `true` | Show the backdrop overlay |
| `blocking` | `boolean` | `true` | Prevent body scroll when the sheet is open |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Sheet content |
| `header` | `Snippet` | - | Content below the handle, above the scrollable area |
| `onopen` | `() => void` | - | Fires when the sheet opens |
| `onclose` | `() => void` | - | Fires when the sheet closes (dismissed) |
| `onsnap` | `(detail: { index: number, height: number }) => void` | - | Fires when the sheet snaps to a position |

## Snap Points

Snap points define the resting positions of the sheet as fractions of the viewport height:

| Value | Position | Use Case |
|-------|----------|----------|
| `0.25` | Quarter height | Peek/preview, showing a summary |
| `0.5` | Half height | Default comfortable size for actions/lists |
| `0.75` | Three-quarter height | More content visible |
| `1` | Full height | Full-screen content view |

```svelte
<!-- Three snap points: peek, half, full -->
<BottomSheet snapPoints={[0.25, 0.5, 1]} defaultSnap={0}>
```

The sheet can be dragged between snap points. On release, it snaps to the nearest point based on the release position and velocity.

## Spring Physics and Gesture Handling

The sheet uses CSS `scroll-snap` combined with `overscroll-behavior` for smooth, native-feeling gesture interactions:

### Drag Behavior
- Touch/pointer events on the handle and header area initiate dragging.
- The sheet follows the finger/pointer position during drag.
- Movement is tracked to compute velocity on release.

### Snap Animation
- On release, the sheet animates to the nearest snap point.
- The animation uses a spring-like CSS transition: `transition: transform 350ms cubic-bezier(0.32, 0.72, 0, 1)`.
- Velocity at release influences the target snap point (a fast swipe down dismisses even if not past the midpoint).

### Velocity Thresholds
- Fast swipe down (velocity > 0.5px/ms): dismiss or snap to lower point.
- Fast swipe up (velocity > 0.5px/ms): snap to higher point.
- Slow release: snap to nearest point by distance.

### Rubber Banding
- Dragging past the top snap point (trying to pull higher than full height) applies a resistance effect.
- The sheet moves at a fraction of the drag distance (e.g., 30% of the overscroll).
- On release, it springs back to the maximum snap point.
- Implemented with `transform` and a dampened tracking calculation.

### Scroll Integration
- When the sheet is at its highest snap point and content is scrollable, scroll takes priority over sheet dragging.
- When content is scrolled to the top and the user continues pulling down, the gesture transitions from scrolling to sheet dragging (scroll-to-dismiss).
- `overscroll-behavior: none` prevents native bounce effects from interfering.

## Distinction from Drawer

| Aspect | BottomSheet | Drawer |
|--------|-------------|--------|
| **Primary platform** | Mobile / touch devices | Desktop / pointer devices |
| **Edge** | Always bottom | Left, right, top, or bottom |
| **Interaction** | Touch-driven drag gestures | Click/tap to open/close |
| **Snap points** | Multiple intermediate positions | Open or closed (binary) |
| **Resize** | User can drag between snap points | Fixed size |
| **Physics** | Spring animation, rubber banding | Simple slide transition |
| **Handle** | Drag handle indicator | No handle |
| **Content shift** | Overlays content | Can push content (push mode) |

## Portal

The BottomSheet renders via Portal to `document.body` to ensure proper stacking and avoid `overflow: hidden` or `z-index` issues from ancestor elements.

## Delightful Details

### Spring Animation
- Natural spring-like easing on snap transitions
- Slight overshoot when snapping to a position
- Settles smoothly without oscillation

### Backdrop Correlation
- Backdrop opacity is calculated based on the sheet's current position.
- More open = darker backdrop. Fully dismissed = fully transparent.
- Updates in real-time during drag for a smooth, connected feel.

### Rubber Banding
- Resistance effect when dragging past the top boundary.
- Uses a diminishing returns formula: `offset * (1 - Math.min(overscroll / maxOverscroll, 1) * 0.7)`.
- Springs back on release with the same spring easing.

### Handle Feedback
- Subtle scale increase on touch start (`transform: scaleX(1.2)`).
- Returns to normal on release.
- Indicates the grab state to the user.

### Scroll Lock
- Body scroll is locked when `blocking` is true and the sheet is open.
- Background content does not scroll.
- Scroll position is preserved and restored on close.

### Safe Area Handling
- Bottom padding respects `env(safe-area-inset-bottom)` for devices with home indicators.
- Content never renders behind the home indicator area.

## Accessibility

- `role="dialog"` with `aria-modal="true"`
- `aria-label` describing the sheet's purpose
- Focus trapped within the sheet when open
- Escape key closes the sheet
- Drag handle has `role="slider"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` reflecting snap position
- Screen reader announcement on open/close

## CSS Approach

```css
.bottom-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: light-dark(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.7));
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-default);
  z-index: var(--z-overlay);
}

.bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: light-dark(var(--color-surface-0), var(--color-surface-0));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-lg);
  z-index: var(--z-overlay);
  transform: translateY(100%);
  transition: transform 350ms cubic-bezier(0.32, 0.72, 0, 1);
  max-height: calc(100vh - env(safe-area-inset-top) - 1rem);
  display: flex;
  flex-direction: column;
  touch-action: none;
}

.bottom-sheet.open {
  transform: translateY(0);
}

.bottom-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 0.75rem 0 0.5rem;
  cursor: grab;
}

.bottom-sheet-handle:active {
  cursor: grabbing;
}

.bottom-sheet-handle-bar {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-full);
  background: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
  transition: transform var(--duration-fast) var(--ease-default);
}

.bottom-sheet-handle:active .bottom-sheet-handle-bar {
  transform: scaleX(1.2);
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: none;
  padding-bottom: env(safe-area-inset-bottom);
}

.bottom-sheet-header {
  padding: 0 1rem;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .bottom-sheet {
    transition: none;
  }
}
```

## Code Example

```svelte
<script>
  import { BottomSheet, List, ListItem, Button } from '@delightstack/components';

  let sheetOpen = $state(false);
  let filterOpen = $state(false);
  let detailOpen = $state(false);
</script>

<!-- Simple action sheet -->
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

<!-- Filter sheet with peek + half snap points -->
<BottomSheet
  bind:open={filterOpen}
  snapPoints={[0.25, 0.5, 1]}
  defaultSnap={0}
>
  {#snippet header()}
    <h3>Filters</h3>
  {/snippet}

  <FilterForm />
</BottomSheet>

<!-- Full-screen detail view -->
<BottomSheet
  bind:open={detailOpen}
  snapPoints={[1]}
>
  {#snippet header()}
    <div class="detail-header">
      <h2>Item Details</h2>
      <Button transparent onclick={() => detailOpen = false}>Close</Button>
    </div>
  {/snippet}

  <DetailContent />
</BottomSheet>

<!-- Non-dismissible sheet with multiple snap points -->
<BottomSheet
  bind:open={playerOpen}
  snapPoints={[0.15, 0.5, 1]}
  defaultSnap={0}
  dismissible={false}
>
  <MusicPlayer />
</BottomSheet>

<!-- Sheet without backdrop -->
<BottomSheet
  bind:open={infoOpen}
  showBackdrop={false}
  snapPoints={[0.3, 0.6]}
>
  <InfoPanel />
</BottomSheet>
```
