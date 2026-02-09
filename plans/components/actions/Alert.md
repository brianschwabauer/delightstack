# Alert

**Category**: Actions
**File**: `packages/components/src/actions/Alert.svelte`

## Description

A streamlined confirmation dialog built on top of Modal and Button. Provides a consistent pattern for yes/no decisions with clear visual hierarchy, sensible defaults, and a programmatic API for imperative usage.

## Dependencies

- **Modal** -- the overlay container (Alert wraps Modal internally)
- **Button** -- the Cancel and Confirm action buttons
- **Portal** -- DOM placement (used internally by Modal)
- **`@delightstack/utilities`**:
  - `focusTrap` -- inherited from Modal

## Visual Design

### Layout
- Compact Modal with focused content
- Title in bold at top
- Message text in body
- Two action buttons in footer

### Button Arrangement
- Cancel button on left (transparent style)
- Confirm button on right (solid style, or `error` when `destructive` is true)
- Consistent with platform conventions

### Sizing
- Narrow max-width (`400px`, equivalent to Modal `size="0"`)
- Minimal padding
- Content-driven height

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `title` | `string` | `'Confirm'` | Alert title |
| `message` | `string` | - | Alert message / question |
| `cancelText` | `string` | `'Cancel'` | Cancel button label |
| `continueText` | `string` | `'Continue'` | Confirm button label |
| `destructive` | `boolean` | `false` | Style confirm button with `error` color |
| `icon` | `Component` | - | Optional icon displayed above the title |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `oncancel` | `() => void` | - | Called when Cancel is clicked |
| `oncontinue` | `() => void \| Promise<void>` | - | Called when Confirm is clicked; promise-aware (button shows loading until resolved) |

## Variants

### Standard Confirmation

```svelte
<script>
  import { Alert } from '@delightstack/components';

  let showAlert = $state(false);
</script>

<Alert
  bind:open={showAlert}
  title="Save Changes?"
  message="You have unsaved changes. Would you like to save before leaving?"
  continueText="Save"
  oncontinue={async () => {
    await saveChanges();
    showAlert = false;
  }}
  oncancel={() => showAlert = false}
/>
```

### Destructive Action

```svelte
<Alert
  bind:open={showDelete}
  title="Delete Item"
  message="This action cannot be undone. Are you sure?"
  continueText="Delete"
  destructive
  oncontinue={async () => {
    await api.deleteItem(itemId);
    showDelete = false;
  }}
  oncancel={() => showDelete = false}
/>
```

- Confirm button uses `error` color
- Cancel button is auto-focused (safer default for destructive actions)

## Programmatic API

For convenience, Alert exports an `alert()` function that creates the dialog imperatively and returns a Promise resolving to `true` (confirmed) or `false` (cancelled).

```typescript
import { alert } from '@delightstack/components';

const confirmed = await alert({
  title: 'Delete?',
  message: 'This cannot be undone.',
  destructive: true,
  continueText: 'Delete'
});

if (confirmed) {
  await api.deleteItem(id);
}
```

The programmatic API internally mounts an Alert component into a Portal, waits for user interaction, and cleans up after resolving.

### Programmatic API Options

```typescript
interface AlertOptions {
  title?: string;
  message: string;
  cancelText?: string;
  continueText?: string;
  destructive?: boolean;
  icon?: Component;
}

function alert(options: AlertOptions): Promise<boolean>;
```

## Delightful Details

### Focus Default
- Confirm button auto-focused for quick keyboard confirmation
- When `destructive` is true, Cancel is focused instead (safer default)

### Quick Dismiss
- Enter key confirms (activates focused button)
- Escape key cancels and closes
- Backdrop click cancels and closes

### Promise-Aware Confirm
When `oncontinue` returns a Promise, the Confirm button enters loading state automatically until the promise resolves. The Alert stays open during loading and closes on success.

### Transition
- Inherits smooth Modal animations
- Quick in/out for responsive feel

## Accessibility

- Inherits all Modal accessibility features (`role="dialog"`, `aria-modal`, focus trap)
- Clear button labeling
- Keyboard navigable (Tab between Cancel and Confirm)
- `aria-labelledby` points to title
- `aria-describedby` points to message

## Code Example

```svelte
<script>
  import { Alert, Button } from '@delightstack/components';

  let showAlert = $state(false);

  async function confirmDelete() {
    await api.deleteItem(itemId);
    showAlert = false;
  }
</script>

<Button error onclick={() => showAlert = true}>
  Delete Item
</Button>

<Alert
  bind:open={showAlert}
  title="Delete Item"
  message="Are you sure you want to delete this item? This cannot be undone."
  cancelText="Keep It"
  continueText="Delete"
  destructive
  oncancel={() => showAlert = false}
  oncontinue={confirmDelete}
/>
```

## CSS Approach

```css
.alert {
  text-align: center;
}

.alert-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 0.75rem;
  color: var(--color-text-muted);
}

.alert-icon.destructive {
  color: var(--color-error);
}

.alert-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.alert-message {
  font-size: var(--text-base);
  color: var(--color-text-muted);
  line-height: var(--leading-relaxed);
}

.alert-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 1rem;
}
```
