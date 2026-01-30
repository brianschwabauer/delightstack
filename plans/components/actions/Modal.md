# Modal

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/Modal.svelte`

## Description

A polished dialog overlay for focused content and interactions. Features smooth entrance/exit animations, proper focus trapping, and a beautiful backdrop blur effect that maintains context while drawing attention to the modal content.

## Visual Design

### Container
- Centered in viewport
- White/dark background based on theme
- Rounded corners (`--radius-3`)
- Soft shadow for elevation (`--shadow-3`)
- Max-width with responsive padding

### Backdrop
- Semi-transparent dark overlay
- Subtle blur effect on background content
- Click to dismiss (optional)

### Header
- Optional title with medium-large font weight
- Close button (X) in top-right corner
- Subtle bottom border separator
- Supports custom header content

### Content Area
- Scrollable when content exceeds max-height
- Custom scrollbar styling
- Comfortable padding

### Footer
- Sticky at bottom for action buttons
- Subtle top border separator
- Right-aligned buttons by default
- Supports custom layout

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `title` | `string` | - | Modal title text |
| `closable` | `boolean` | `true` | Allow closing via backdrop/escape |
| `disableCloseIcon` | `boolean` | `false` | Hide the X close button |
| `width` | `string` | `'auto'` | Modal width |
| `maxWidth` | `string` | `'500px'` | Maximum width |
| `height` | `string` | `'auto'` | Modal height |
| `maxHeight` | `string` | `'85vh'` | Maximum height |
| `transitionTarget` | `HTMLElement` | - | Element to morph from/to |

## Slots/Children

| Slot | Description |
|------|-------------|
| `children` (default) | Main modal content |
| `header` | Replace entire header |
| `headerStart` | Content before title |
| `headerEnd` | Content after title (before close) |
| `footer` | Footer content area |
| `footerStart` | Left side of footer |
| `footerEnd` | Right side of footer |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onopen` | - | Modal opened |
| `onclose` | - | Modal closed |
| `onbackdropclick` | - | Backdrop was clicked |

## Animations

### Opening
1. Backdrop fades in (150ms)
2. Modal scales from 0.95 to 1.0
3. Modal fades in simultaneously
4. Total duration: 200ms ease-out

### Closing
1. Modal scales to 0.95
2. Modal fades out
3. Backdrop fades out
4. Total duration: 150ms ease-in

### Hero Transition (Optional)
When `transitionTarget` is provided:
- Modal morphs from the target element's position
- Smooth size and position interpolation
- Creates a connected, spatial experience

## Delightful Details

### Backdrop Blur
- `backdrop-filter: blur(8px)`
- Content remains visible but defocused
- Creates depth without complete occlusion

### Focus Management
- Focus trapped within modal
- First focusable element receives focus on open
- Focus returns to trigger element on close
- Tab cycles through modal content only

### Escape Key
- Closes modal when `closable` is true
- Respects nested modals (only closes topmost)

### Scroll Lock
- Body scroll disabled when modal is open
- Prevents background scroll on mobile
- Restores scroll position on close

### Custom Scrollbar
- Styled scrollbar in content area
- Matches theme colors
- Thin, unobtrusive design

### Nested Modals
- Supports stacking multiple modals
- Each level gets slightly darker backdrop
- Proper z-index management

## Accessibility

- `role="dialog"` with `aria-modal="true"`
- `aria-labelledby` pointing to title
- Focus trap implementation
- Escape key dismissal
- Background content marked `inert`

## Current Implementation

The current implementation is **complete** with:
- All animation transitions
- Focus trap functionality
- Escape key handling
- Custom header/footer slots
- Crossfade transitions
- Responsive design
- Nested modal support

## Code Example

```svelte
<script>
  import { Modal, Button } from '@delightstack/components';

  let showModal = $state(false);
</script>

<Button onclick={() => showModal = true}>
  Open Modal
</Button>

<Modal
  bind:open={showModal}
  title="Confirm Action"
>
  <p>Are you sure you want to proceed?</p>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => showModal = false}>
      Cancel
    </Button>
    <Button onclick={handleConfirm}>
      Confirm
    </Button>
  {/snippet}
</Modal>
```

## Responsive Behavior

- Full-width on mobile (< 480px) with small margin
- Bottom-aligned on mobile for thumb reach
- Standard centered on larger screens
- Adjusts max-height for smaller viewports
