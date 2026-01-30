# Toast

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Toast.svelte`

## Description

A brief, non-blocking notification that appears temporarily to provide feedback about an action. Toasts stack nicely, auto-dismiss, and can include actions.

## Visual Design

### Container
- Compact, rounded card
- Subtle shadow for elevation
- Icon + message + optional action
- Consistent width (300-400px)

### Position
- Bottom-right (default)
- Configurable: top/bottom + left/center/right
- Stacks vertically with spacing

### Variants

| Variant | Color | Icon | Use Case |
|---------|-------|------|----------|
| `default` | Neutral | None | General info |
| `success` | Green | Checkmark | Confirmations |
| `error` | Red | X | Errors |
| `warning` | Orange | Alert | Warnings |
| `info` | Blue | Info | Information |

## API

### Programmatic (Recommended)
```typescript
import { toast } from '@delightstack/components';

// Simple
toast('Message saved');

// With options
toast.success('File uploaded successfully');
toast.error('Failed to save changes');
toast.warning('You have unsaved changes');

// With action
toast('Item deleted', {
  action: {
    label: 'Undo',
    onclick: () => restoreItem()
  }
});

// Promise toast
toast.promise(saveData(), {
  loading: 'Saving...',
  success: 'Saved!',
  error: 'Failed to save'
});
```

### Component API
```svelte
<Toast
  message="Changes saved"
  variant="success"
  duration={3000}
/>
```

## Props (Component)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string` | required | Toast message |
| `variant` | `Variant` | `'default'` | Visual variant |
| `duration` | `number` | `4000` | Auto-dismiss time (ms) |
| `dismissible` | `boolean` | `true` | Show close button |
| `action` | `Action` | - | Action button |
| `icon` | `Component` | - | Custom icon |
| `persistent` | `boolean` | `false` | Don't auto-dismiss |
| `sound` | `boolean \| string` | `false` | Play notification sound |
| `richContent` | `boolean` | `false` | Enable rich HTML content |
| `dense` | `boolean` | `false` | Compact padding |
| `comfortable` | `boolean` | `false` | Relaxed padding |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Toaster Container

Place once in your app layout:
```svelte
<script>
  import { Toaster } from '@delightstack/components';
</script>

<slot />
<Toaster position="bottom-right" />
```

### Toaster Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `Position` | `'bottom-right'` | Screen position |
| `maxVisible` | `number` | `5` | Max visible toasts |
| `gap` | `number` | `8` | Space between toasts |
| `grouping` | `boolean` | `false` | Group duplicate toasts |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Delightful Details

### Entry Animation
- Slide in from edge
- Subtle scale from 0.95
- Smooth entrance

### Exit Animation
- Slide out
- Height collapses
- Other toasts slide up smoothly

### Hover Pause
- Hovering pauses auto-dismiss
- Progress bar (if shown) pauses
- Resumes on mouse leave

### Progress Indicator
- Optional progress bar showing time remaining
- Smooth countdown
- Pauses on hover

### Stacking Behavior
- New toasts appear at bottom (or top)
- Old toasts slide to make room
- Excess toasts are queued

### Action Highlight
- Action button clearly visible
- Keyboard accessible
- Action cancels auto-dismiss

### Swipe to Dismiss
- Swipe left/right to dismiss (touch)
- Resistance at edges
- Velocity-based threshold

## Accessibility

- `role="status"` or `role="alert"` (based on type)
- Announced to screen readers
- Focus management for actions
- Keyboard dismissible

## Code Example

```svelte
<script>
  import { Toaster, toast } from '@delightstack/components';

  async function handleSave() {
    try {
      await saveData();
      toast.success('Changes saved successfully!');
    } catch (error) {
      toast.error('Failed to save changes');
    }
  }

  function handleDelete() {
    deleteItem();
    toast('Item deleted', {
      action: {
        label: 'Undo',
        onclick: () => restoreItem()
      }
    });
  }

  async function handleUpload() {
    toast.promise(uploadFile(), {
      loading: 'Uploading...',
      success: 'Upload complete!',
      error: (err) => `Upload failed: ${err.message}`
    });
  }
</script>

<!-- Place Toaster in layout -->
<Toaster />

<Button onclick={handleSave}>Save</Button>
<Button onclick={handleDelete}>Delete</Button>
```

## Implementation Notes

- Use store/context for toast state
- Portal to body for proper stacking
- Handle rapid successive toasts
- Clean up timers on unmount
- Support rich content (icons, custom components)
