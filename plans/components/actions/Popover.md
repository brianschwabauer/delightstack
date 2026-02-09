# Popover

**Category**: Actions
**File**: `packages/components/src/actions/Popover.svelte`

## Description

A sophisticated floating content container that intelligently positions itself relative to a trigger element. Supports multiple trigger modes, smart positioning with Floating UI, hover trapezoid for safe diagonal mouse movement, and smooth animations for a polished experience.

## Dependencies

- **Portal** -- DOM placement to escape overflow and stacking contexts
- **`@delightstack/utilities`**:
  - `focusTrap` -- traps focus within the popover when open
- **External**:
  - [`@floating-ui/dom`](https://floating-ui.com/) -- positioning engine (`computePosition`, `flip`, `shift`, `offset`, `arrow`)

## Visual Design

### Container
- Background uses `light-dark()` for automatic theming
- Subtle rounded corners (`--radius-md`)
- Soft shadow for elevation (`--shadow-md`)
- Border: `1px solid var(--border-elevated-2)`
- Optional arrow pointing to trigger

### Arrow
- Triangular pointer matching popover background
- Positioned automatically based on placement
- Smooth position updates on reflow

### Animation
- Fade in with slight scale from trigger direction
- Quick, snappy timing (`150ms`)
- `transform-origin` set to the edge facing the trigger

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `refElement` | `HTMLElement` | - | Element to position relative to |
| `placement` | `Placement` | `'bottom'` | Preferred position (Floating UI placement type) |
| `strategy` | `'absolute' \| 'fixed'` | `'absolute'` | CSS positioning strategy |
| `arrow` | `boolean` | `true` | Show arrow pointer |
| `offset` | `number` | `8` | Distance from trigger element (px) |
| `radius` | `string` | - | Border radius override |
| `matchTriggerWidth` | `boolean` | `false` | Match width of trigger element |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Popover content |

### Trigger Modes

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `openOnHover` | `boolean` | `false` | Open on mouse hover |
| `openOnClick` | `boolean` | `true` | Open on click |
| `openOnFocus` | `boolean` | `false` | Open on focus |
| `openDelay` | `number` | `200` | Delay before opening (ms, applies to hover) |
| `closeDelay` | `number` | `0` | Delay before closing (ms, applies to hover) |

### Close Behavior

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `closeOnOutsideClick` | `boolean` | `true` | Close when clicking outside |
| `closeOnInsideClick` | `boolean` | `false` | Close when clicking inside |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |
| `disableInitialFocus` | `boolean` | `false` | Do not auto-focus content on open |

### Callbacks

| Prop | Type | Description |
|------|------|-------------|
| `onopen` | `() => void` | Called when popover opens |
| `onclose` | `() => void` | Called when popover closes |

## Placement Options

```
     top-start     top     top-end
           +-----------------+
           |                 |
left-start |                 | right-start
      left |    [trigger]    | right
  left-end |                 | right-end
           |                 |
           +-----------------+
  bottom-start  bottom  bottom-end
```

## Smart Positioning (Floating UI)

The Popover uses Floating UI middleware for intelligent positioning:

- **`flip`** -- flips to opposite side if not enough space
- **`shift`** -- shifts along the axis to stay in viewport
- **`offset`** -- maintains configurable distance from trigger
- **`arrow`** -- positions the arrow element
- **`autoUpdate`** -- recalculates position on scroll, resize, and DOM mutations

```typescript
import { computePosition, flip, shift, offset, arrow, autoUpdate } from '@floating-ui/dom';

const cleanup = autoUpdate(refElement, popoverElement, async () => {
  const { x, y, placement, middlewareData } = await computePosition(
    refElement,
    popoverElement,
    {
      placement,
      strategy,
      middleware: [
        offset(8),
        flip(),
        shift({ padding: 8 }),
        arrow({ element: arrowElement })
      ]
    }
  );
  // Apply position...
});
```

## Delightful Details

### Hover Trapezoid
When `openOnHover` is enabled, an invisible trapezoid-shaped hit area extends from the trigger to the popover. This allows diagonal mouse movement between the trigger and the popover without the popover closing. The trapezoid is calculated dynamically based on the relative positions of the trigger and popover.

Without this, users moving their mouse diagonally from trigger to popover would cross "dead space" that closes the popover -- an infuriating experience.

### Focus Trap
- Focus contained within popover when open (via `focusTrap` from `@delightstack/utilities`)
- Tab cycles through focusable elements
- Returns focus to trigger on close

### Escape Sequence
- Escape closes popover
- Works with nested popovers (closes innermost first)

### Animation Origin
- Scale animation originates from the edge facing the trigger
- Creates a spatial connection between trigger and content
- `transform-origin` dynamically set based on computed placement

### Position Updates
- Smooth position recalculation via `autoUpdate`
- No jarring jumps on content resize or viewport changes

## Accessibility

- `aria-haspopup` on trigger element
- `aria-expanded` reflects open state
- `aria-controls` links trigger to popover
- Focus management with trap
- Keyboard navigation (Escape to close)
- Screen reader announcements

## Code Example

### Click-Triggered Popover

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
    <button onclick={() => { doSomething(); isOpen = false; }}>Option 1</button>
    <button onclick={() => { doAnother(); isOpen = false; }}>Option 2</button>
  </div>
</Popover>
```

### Hover Info Popover

```svelte
<script>
  import { Popover } from '@delightstack/components';

  let infoRef = $state<HTMLElement>();
</script>

<span bind:this={infoRef}>
  <InfoIcon />
</span>

<Popover
  refElement={infoRef}
  openOnHover
  openOnClick={false}
  openDelay={300}
  placement="top"
>
  <p class="info-text">Helpful information here</p>
</Popover>
```

### Button with Built-In Popover (via Button `menu` prop)

The Button component has built-in Popover support. Passing a `dropdown` snippet automatically manages the Popover lifecycle:

```svelte
<Button menu>
  Options
  {#snippet dropdown({ close })}
    <List>
      <ListItem onclick={() => { edit(); close(); }}>Edit</ListItem>
      <ListItem onclick={() => { remove(); close(); }}>Delete</ListItem>
    </List>
  {/snippet}
</Button>
```

## CSS Approach

```css
.popover {
  position: absolute;
  background: var(--color-surface-2);
  border: 1px solid var(--border-elevated-2);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: var(--layer-popover);
  animation: popover-in var(--duration-fast) var(--ease-out);
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.popover-arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--color-surface-2);
  border: 1px solid var(--border-elevated-2);
  transform: rotate(45deg);
}
```
