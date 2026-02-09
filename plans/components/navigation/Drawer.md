# Drawer

**Category**: Navigation
**File**: `packages/components/src/navigation/Drawer.svelte`

## Description

A slide-out side panel for navigation menus, settings, or supplementary content. Supports four edge positions via boolean props, three interaction modes (overlay, push, persistent), body scroll locking, swipe-to-close on touch devices, responsive behavior that auto-switches between persistent and overlay modes at breakpoints, and focus trapping for accessibility.

## Dependencies

- **Components**: `Portal` -- used for DOM placement to ensure proper stacking context
- **Utilities**: `@delightstack/utilities` -- `focusTrap` for trapping keyboard focus within the drawer when in overlay mode
- **Libraries**: none

## Visual Design

### Container
- Slides in from the specified edge (left by default)
- Full height for left/right, full width for top/bottom
- Configurable width (left/right) or height (top/bottom)
- Elevation shadow for depth separation
- Background uses `light-dark()` for theming

### Backdrop (Overlay Mode)
- Semi-transparent dark overlay covering the main content
- Click to close the drawer
- Fades in/out with the drawer animation
- Opacity correlates with drawer open progress

### Content Area
- Scrollable when content exceeds the drawer dimensions
- Supports `header`, `footer`, and default children snippets
- Comfortable padding

### Modes

| Mode | Overlay | Content Shift | Always Visible |
|------|---------|---------------|----------------|
| **Overlay** (default) | Yes | No | No |
| **Push** (`push`) | No | Yes, main content shifts | No |
| **Persistent** (`persistent`) | No | Yes, is part of layout flow | Yes |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `right` | `boolean` | `false` | Slide in from the right edge (default is left) |
| `top` | `boolean` | `false` | Slide in from the top edge |
| `bottom` | `boolean` | `false` | Slide in from the bottom edge |
| `push` | `boolean` | `false` | Push mode: main content shifts to make room |
| `persistent` | `boolean` | `false` | Persistent mode: always visible, no overlay, part of layout |
| `width` | `string` | `'280px'` | Drawer width (for left/right positions) |
| `height` | `string` | `'280px'` | Drawer height (for top/bottom positions) |
| `closeOnOutsideClick` | `boolean` | `true` | Close when clicking outside/on backdrop (overlay mode) |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key press |
| `breakpoint` | `string` | - | CSS media query breakpoint for responsive mode switching (e.g. `'768px'`) |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Main drawer content |
| `header` | `Snippet` | - | Header area content |
| `footer` | `Snippet` | - | Footer area content |
| `onopen` | `() => void` | - | Fires when the drawer opens |
| `onclose` | `() => void` | - | Fires when the drawer closes |

## Position Props

Position is controlled via boolean props. Only one should be active at a time. The default (no boolean set) is left.

| Configuration | Edge |
|--------------|------|
| _(none)_ | Left |
| `right` | Right |
| `top` | Top |
| `bottom` | Bottom |

## Mode Props

Mode is controlled via boolean props. The default (no boolean set) is overlay mode.

| Configuration | Behavior |
|--------------|----------|
| _(none)_ | Overlay: backdrop, focus trap, body scroll lock |
| `push` | Content shifts, no backdrop, content remains interactive |
| `persistent` | Always visible, part of layout flow, no overlay |

## Body Scroll Lock

In overlay mode, when the drawer is open:
- `document.body` receives `overflow: hidden` to prevent background scrolling.
- The scroll position is preserved and restored on close.
- This prevents the common issue of background content scrolling behind the overlay on mobile.
- Not applied in `push` or `persistent` modes since the main content remains interactive.

## Swipe to Close

On touch devices, the drawer supports swipe gestures to dismiss:
- Swipe toward the edge the drawer came from (e.g., swipe left for a left-positioned drawer).
- The drawer follows the finger position during the swipe.
- Release velocity and distance determine whether to close or snap back.
- Threshold: 30% of drawer width/height or velocity > 0.5px/ms.
- Rubber banding effect if swiped in the wrong direction.

## Responsive Behavior

When `breakpoint` is set, the drawer auto-switches between persistent and overlay modes based on the viewport width:

```svelte
<Drawer persistent breakpoint="768px" bind:open={drawerOpen}>
  <!-- persistent on desktop (>= 768px), overlay on mobile (< 768px) -->
</Drawer>
```

- Above the breakpoint: behaves as `persistent` (always visible, part of layout).
- Below the breakpoint: behaves as overlay (backdrop, focus trap, can be toggled).
- Transition between modes is seamless; the drawer does not close when crossing the breakpoint.
- Uses `window.matchMedia` to observe breakpoint changes.

## Focus Trap

In overlay mode, focus is trapped within the drawer using `focusTrap` from `@delightstack/utilities`:
- Focus moves to the first focusable element inside the drawer on open.
- Tab cycles through drawer content only.
- Focus returns to the trigger element on close.
- Not applied in `push` or `persistent` modes (main content remains accessible).

## Portal

The drawer renders via Portal to `document.body` to ensure proper stacking context and avoid `overflow: hidden` or `z-index` issues from ancestor elements. In `persistent` mode, the drawer renders inline (no Portal) since it is part of the layout flow.

## Delightful Details

### Slide Animation
- CSS `transform: translateX()` / `translateY()` for GPU-accelerated animation
- Smooth ease-out on open, ease-in on close
- Duration: 250ms

### Push Content Animation
- Main content wrapper shifts via `margin-left`/`margin-right`/`margin-top`/`margin-bottom`
- Animated in sync with the drawer slide
- Content remains fully interactive during and after animation

### Backdrop Fade
- Backdrop opacity is tied to the drawer's open progress
- Fades in as the drawer slides open
- Creates a smooth, correlated visual effect

### Swipe Tracking
- During swipe, the drawer follows the finger exactly
- Backdrop opacity updates in real-time based on drawer position
- Smooth spring animation on release (snap open or closed)

## Accessibility

- `role="dialog"` with `aria-modal="true"` (overlay mode)
- `role="complementary"` with `aria-label` (persistent mode)
- Focus trap in overlay mode via `focusTrap`
- Escape key closes the drawer (when `closeOnEscape` is true)
- Focus returns to trigger element on close
- Screen reader announcement on open/close

## CSS Approach

```css
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: light-dark(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.7));
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-default);
  z-index: var(--z-overlay);
}

.drawer-backdrop.open {
  opacity: 1;
}

.drawer {
  position: fixed;
  background: light-dark(var(--color-surface-0), var(--color-surface-0));
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  z-index: var(--z-overlay);
  transition: transform var(--duration-normal) var(--ease-default);
}

.drawer.left {
  top: 0;
  left: 0;
  bottom: 0;
  transform: translateX(-100%);
}

.drawer.left.open {
  transform: translateX(0);
}

.drawer.right {
  top: 0;
  right: 0;
  bottom: 0;
  transform: translateX(100%);
}

.drawer.right.open {
  transform: translateX(0);
}

.drawer.top {
  top: 0;
  left: 0;
  right: 0;
  transform: translateY(-100%);
}

.drawer.top.open {
  transform: translateY(0);
}

.drawer.bottom {
  bottom: 0;
  left: 0;
  right: 0;
  transform: translateY(100%);
}

.drawer.bottom.open {
  transform: translateY(0);
}

.drawer.persistent {
  position: relative;
  box-shadow: none;
  transform: none;
  border-right: 1px solid light-dark(var(--color-border), var(--color-border));
}

.drawer-header {
  padding: 1rem;
  border-bottom: 1px solid light-dark(var(--color-border), var(--color-border));
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
}

.drawer-footer {
  padding: 1rem;
  border-top: 1px solid light-dark(var(--color-border), var(--color-border));
}
```

## Code Example

```svelte
<script>
  import { Drawer, List, ListItem, Button } from '@delightstack/components';

  let menuOpen = $state(false);
  let settingsOpen = $state(false);
</script>

<!-- Left navigation drawer (default overlay) -->
<Button onclick={() => menuOpen = true}>
  Open Menu
</Button>

<Drawer bind:open={menuOpen}>
  {#snippet header()}
    <div class="drawer-brand">
      <Logo />
    </div>
  {/snippet}

  <nav>
    <List>
      <ListItem href="/">Home</ListItem>
      <ListItem href="/products">Products</ListItem>
      <ListItem href="/about">About</ListItem>
      <ListItem href="/contact">Contact</ListItem>
    </List>
  </nav>

  {#snippet footer()}
    <ThemeToggle />
  {/snippet}
</Drawer>

<!-- Right-side settings drawer -->
<Drawer bind:open={settingsOpen} right width="350px">
  <h2>Settings</h2>
  <!-- settings content -->
</Drawer>

<!-- Top notification tray -->
<Drawer bind:open={notificationsOpen} top height="200px">
  <NotificationList />
</Drawer>

<!-- Push mode drawer -->
<Drawer bind:open={sidebarOpen} push width="240px">
  <SideNavigation />
</Drawer>

<!-- Persistent desktop sidebar with responsive fallback -->
<Drawer persistent breakpoint="768px" bind:open={sidebarOpen} width="260px">
  <SideNavigation />
</Drawer>

<!-- Bottom drawer -->
<Drawer bind:open={bottomOpen} bottom height="300px">
  <FilterPanel />
</Drawer>
```
