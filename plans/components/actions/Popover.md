# Popover

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/Popover.svelte`

## Description

A sophisticated floating content container that intelligently positions itself relative to a trigger element. Supports multiple trigger modes, smart positioning with Floating UI, and smooth animations for a polished experience.

## Visual Design

### Container
- Background uses `light-dark()` for automatic theming
- Subtle rounded corners (`--radius-md`)
- Soft shadow for elevation (`--shadow-md`)
- Optional arrow pointing to trigger

### Arrow
- Triangular pointer
- Matches popover background
- Positioned automatically based on placement
- Smooth position updates

### Animation
- Fade in with slight scale
- Origin from trigger direction
- Quick, snappy timing (150ms)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `refElement` | `HTMLElement` | - | Element to position relative to |
| `placement` | `Placement` | `'bottom'` | Preferred position |
| `strategy` | `'absolute' \| 'fixed'` | `'absolute'` | CSS positioning strategy |
| `arrow` | `boolean` | `true` | Show arrow pointer |
| `radius` | `string` | - | Border radius override |
| `matchTriggerWidth` | `boolean` | `false` | Match width of trigger element |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Trigger Modes

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `openOnHover` | `boolean` | `false` | Open on mouse hover |
| `openOnClick` | `boolean` | `true` | Open on click |
| `openOnFocus` | `boolean` | `false` | Open on focus |
| `openDelay` | `number` | `200` | Delay before opening (ms) |
| `closeDelay` | `number` | `0` | Delay before closing (ms) |

### Close Behavior

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `closeOnOutsideClick` | `boolean` | `true` | Close when clicking outside |
| `closeOnInsideClick` | `boolean` | `false` | Close when clicking inside |
| `closeOnEscape` | `boolean` | `true` | Close on escape key |
| `disableInitialFocus` | `boolean` | `false` | Don't auto-focus content |

## Placement Options

```
     top-start     top     top-end
           ┌─────────────────┐
           │                 │
left-start │                 │ right-start
      left │    [trigger]    │ right
  left-end │                 │ right-end
           │                 │
           └─────────────────┘
  bottom-start  bottom  bottom-end
```

## Smart Positioning

Using Floating UI, the popover:
- Flips to opposite side if not enough space
- Shifts along axis to stay in viewport
- Updates position on scroll/resize
- Handles nested scrolling containers

## Delightful Details

### Hover Trapezoid
When `openOnHover` is enabled:
- Invisible trapezoid extends from trigger to popover
- Allows diagonal mouse movement without closing
- Prevents frustrating "gap jumping"

### Focus Trap
- Focus contained within popover when open
- Tab cycles through focusable elements
- Returns focus to trigger on close

### Escape Sequence
- Escape closes popover
- Works with nested popovers (closes innermost)

### Animation Origin
- Scale animation originates from trigger direction
- Creates spatial connection between trigger and content

### Position Updates
- Smooth position recalculation
- No jarring jumps on content resize

## Accessibility

- Proper ARIA attributes
- Focus management
- Keyboard navigation
- Screen reader announcements

## Current Implementation

The current implementation is **complete** with:
- Floating UI integration
- All trigger modes (hover, click, focus)
- Arrow positioning
- Focus trap
- Escape key handling
- Outside click detection
- Hover delay with trapezoid detection

## Code Example

```svelte
<script>
  import { Popover, Button } from '@delightstack/components';

  let buttonRef = $state<HTMLElement>();
  let isOpen = $state(false);
</script>

<Button bind:element={buttonRef} onclick={() => isOpen = !isOpen}>
  Show Options
</Button>

<Popover
  bind:open={isOpen}
  refElement={buttonRef}
  placement="bottom-start"
>
  <div class="options-menu">
    <button>Option 1</button>
    <button>Option 2</button>
    <button>Option 3</button>
  </div>
</Popover>
```

### Hover Tooltip Pattern
```svelte
<span bind:this={infoRef}>
  <InfoIcon />
</span>

<Popover
  refElement={infoRef}
  openOnHover
  openOnClick={false}
  hoverDelay={300}
  placement="top"
>
  <p>Helpful information here</p>
</Popover>
```

## Integration Notes

The Button component has built-in Popover support via the `menu` prop:

```svelte
<Button menu>
  Options
  {#snippet dropdown()}
    <List>
      <ListItem>Edit</ListItem>
      <ListItem>Delete</ListItem>
    </List>
  {/snippet}
</Button>
```
