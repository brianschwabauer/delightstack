# Drawer

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Drawer.svelte`

## Description

A slide-out side panel for navigation menus, settings, or supplementary content. Can emerge from either side of the screen with smooth animations and optional overlay.

## Visual Design

### Container
- Slides in from left or right
- Full height of viewport
- Fixed width (configurable)
- Shadow for depth

### Backdrop
- Semi-transparent overlay
- Covers main content
- Click to close

### Content Area
- Scrollable if content exceeds height
- Header section (optional)
- Footer section (optional)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `side` | `'left' \| 'right'` | `'left'` | Slide-in direction |
| `width` | `string` | `'280px'` | Drawer width |
| `overlay` | `boolean` | `true` | Show backdrop overlay |
| `closeOnOutsideClick` | `boolean` | `true` | Close on overlay click |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |
| `persistent` | `boolean` | `false` | Keep open (desktop sidebar) |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onopen` | - | Drawer opened |
| `onclose` | - | Drawer closed |

## Content Slots

```svelte
<Drawer bind:open>
  {#snippet header()}
    <div class="drawer-header">
      <Logo />
      <Button icon onclick={() => open = false}>
        <CloseIcon />
      </Button>
    </div>
  {/snippet}

  <nav>
    <List>
      <ListItem href="/">Home</ListItem>
      <ListItem href="/about">About</ListItem>
    </List>
  </nav>

  {#snippet footer()}
    <div class="drawer-footer">
      <Button onclick={logout}>Logout</Button>
    </div>
  {/snippet}
</Drawer>
```

## Variants

### Overlay Drawer (Default)
- Covers content
- Backdrop visible
- Click outside closes

### Push Drawer
```svelte
<Drawer variant="push">
```
- Pushes main content aside
- No overlay
- Content remains interactive

### Persistent Drawer
```svelte
<Drawer persistent open>
```
- Always visible (desktop)
- Part of layout
- No overlay

## Responsive Behavior

```svelte
<Drawer
  persistent={isDesktop}
  open={isDesktop || mobileMenuOpen}
>
```
- Persistent on desktop
- Overlay on mobile
- Smooth transition between

## Delightful Details

### Slide Animation
- Smooth slide from edge
- Content follows (push variant)
- Spring easing

### Swipe to Close
- Swipe toward edge to dismiss
- Velocity-based threshold
- Natural gesture

### Focus Trap
- Focus contained in drawer
- Returns on close

### Backdrop Animation
- Fades in with drawer
- Opacity tied to position
- Smooth correlation

### Transform Performance
- Uses CSS transforms
- GPU accelerated
- Smooth on mobile

## Accessibility

- Focus trap when open
- Escape to close
- ARIA attributes
- Screen reader announcements

## Code Example

```svelte
<script>
  import { Drawer, List, ListItem, Button } from '@delightstack/components';

  let menuOpen = $state(false);
</script>

<!-- Mobile menu button -->
<Button onclick={() => menuOpen = true}>
  <MenuIcon />
</Button>

<!-- Navigation drawer -->
<Drawer bind:open={menuOpen}>
  {#snippet header()}
    <div class="drawer-header">
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
    <div class="drawer-footer">
      <ThemeToggle />
    </div>
  {/snippet}
</Drawer>

<!-- Right-side settings drawer -->
<Drawer bind:open={settingsOpen} side="right" width="350px">
  <h2>Settings</h2>
  <!-- settings content -->
</Drawer>
```

## Implementation Notes

- Portal to body for proper stacking
- Handle touch/swipe gestures
- CSS transforms for animation
- Proper z-index management
- Consider body scroll lock
