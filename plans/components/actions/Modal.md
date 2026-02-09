# Modal

**Category**: Actions
**File**: `packages/components/src/actions/Modal.svelte`

## Description

A polished dialog overlay for focused content and interactions. Features smooth entrance/exit animations, proper focus trapping, and a beautiful backdrop blur effect that maintains context while drawing attention to the modal content. Renders via Portal for correct DOM stacking.

## Dependencies

- **Portal** -- DOM placement to escape parent stacking contexts
- **`@delightstack/utilities`**:
  - `focusTrap` -- traps focus within the modal while open (`{@attach focusTrap()}`)

## Visual Design

### Container
- Centered in viewport
- Background uses `light-dark()` for automatic theming
- Rounded corners (`--radius-lg`)
- Soft shadow for elevation (`--shadow-xl`)
- Max-width with responsive padding
- Border: `1px solid var(--border-elevated-3)`

### Backdrop
- Semi-transparent dark overlay (`--color-backdrop`)
- Blur effect on background content (`backdrop-filter: blur(var(--backdrop-blur))`)
- Click to dismiss (when `closable` is true)

### Header
- Optional title with `--font-weight-semibold`
- Close button (X) in top-right corner
- Subtle bottom border separator
- Supports custom header content via snippets

### Content Area
- Scrollable when content exceeds max-height
- Styled scrollbar matching theme
- Comfortable padding

### Footer
- Sticky at bottom for action buttons
- Subtle top border separator
- Right-aligned buttons by default
- Supports custom layout via snippets

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `title` | `string` | - | Modal title text |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Modal width preset (`'0'` = `400px`, `'1'` = `500px`, `'2'` = `640px`, `'3'` = `800px`) |
| `closable` | `boolean` | `true` | Allow closing via backdrop click and Escape key |
| `preventClose` | `boolean` | `false` | Prevent all close methods (for required flows) |
| `disableCloseIcon` | `boolean` | `false` | Hide the X close button |
| `fullscreen` | `boolean` | `false` | Full viewport modal |
| `scrollBehavior` | `'inside' \| 'outside'` | `'inside'` | Where scrollbar appears |
| `initialFocus` | `HTMLElement \| string` | - | Element or CSS selector to focus on open |
| `width` | `string` | - | Explicit modal width (overrides `size`) |
| `maxHeight` | `string` | `'85vh'` | Maximum height |
| `transitionTarget` | `HTMLElement` | - | Element to morph from/to (hero transition) |
| `skeleton` | `boolean` | `false` | Render skeleton placeholders for title and content area |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Main modal content |
| `header` | `Snippet` | - | Replace entire header |
| `headerStart` | `Snippet` | - | Content before title |
| `headerEnd` | `Snippet` | - | Content after title (before close button) |
| `footer` | `Snippet` | - | Footer content area |
| `footerStart` | `Snippet` | - | Left side of footer |
| `footerEnd` | `Snippet` | - | Right side of footer |
| `onopen` | `() => void` | - | Called when modal opens |
| `onclose` | `() => void` | - | Called when modal closes |
| `onbackdropclick` | `() => void` | - | Called when backdrop is clicked |

## Keyboard Interaction

| Key | Action |
|-----|--------|
| `Escape` | Closes the modal (when `closable` is true). Respects nested modals -- only the topmost modal closes. |
| `Tab` / `Shift+Tab` | Cycles through focusable elements within the modal (focus trap). |

## Animations

### Opening
1. Backdrop fades in (`150ms`)
2. Modal scales from `0.95` to `1.0`
3. Modal fades in simultaneously
4. Total duration: `200ms` ease-out

### Closing
1. Modal scales to `0.95`
2. Modal fades out
3. Backdrop fades out
4. Total duration: `150ms` ease-in

### Hero Transition
When `transitionTarget` is provided:
- Modal morphs from the target element's position and size
- Smooth size and position interpolation
- Creates a connected, spatial experience

## Delightful Details

### Backdrop Blur
- `backdrop-filter: blur(var(--backdrop-blur))`
- Content remains visible but defocused
- Creates depth without complete occlusion

### Focus Management
- Focus trapped within modal via `focusTrap` from `@delightstack/utilities`
- `initialFocus` element (or first focusable element) receives focus on open
- Focus returns to the trigger element on close
- Tab cycles through modal content only

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
- Each level gets a slightly darker backdrop
- Proper z-index management
- Escape only closes the topmost modal

## Accessibility

- `role="dialog"` with `aria-modal="true"`
- `aria-labelledby` pointing to title element
- Focus trap via `@delightstack/utilities` `focusTrap`
- Escape key dismissal
- Background content marked `inert`
- `prefers-reduced-motion` respected for animations

## Responsive Behavior

- Full-width on mobile (`< 480px`) with small margin
- Bottom-aligned on mobile for thumb reach
- Standard centered on larger screens
- `maxHeight` adjusts for smaller viewports

## Code Example

```svelte
<script>
  import { Modal, Button } from '@delightstack/components';

  let showModal = $state(false);

  async function handleConfirm() {
    await api.performAction();
    showModal = false;
  }
</script>

<Button onclick={() => showModal = true}>
  Open Modal
</Button>

<Modal
  bind:open={showModal}
  title="Confirm Action"
>
  <p>Are you sure you want to proceed? This will apply the changes immediately.</p>

  {#snippet footer()}
    <Button transparent onclick={() => showModal = false}>
      Cancel
    </Button>
    <Button onclick={handleConfirm}>
      Confirm
    </Button>
  {/snippet}
</Modal>
```

### Custom Header

```svelte
<Modal bind:open={showSettings} size="2">
  {#snippet header()}
    <div class="settings-header">
      <h2>Settings</h2>
      <span class="subtitle">Configure your preferences</span>
    </div>
  {/snippet}

  <!-- Settings content -->
</Modal>
```

## CSS Approach

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-backdrop);
  backdrop-filter: blur(var(--backdrop-blur));
  z-index: var(--layer-modal);
}

.modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--layer-modal);
  padding: 1rem;
}

.modal-content {
  background: var(--color-surface-2);
  border: 1px solid var(--border-elevated-3);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  max-height: var(--modal-max-height, 85vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 480px) {
  .modal {
    align-items: flex-end;
    padding: 0.5rem;
  }

  .modal-content {
    width: 100%;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
```
