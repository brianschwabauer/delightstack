# Alert

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/Alert.svelte`

## Description

A streamlined confirmation dialog built on top of the Modal component. Provides a consistent pattern for yes/no decisions with clear visual hierarchy and sensible defaults.

## Visual Design

### Layout

- Compact modal with focused content
- Title in bold at top
- Message text in body
- Two action buttons in footer

### Button Arrangement

- Cancel button on left (ghost/outline style)
- Confirm button on right (solid style)
- Consistent with platform conventions

### Sizing

- Narrow max-width (400px)
- Minimal padding
- Content-driven height

## Props

| Prop           | Type      | Default      | Description                         |
| -------------- | --------- | ------------ | ----------------------------------- |
| `open`         | `boolean` | `false`      | Controls visibility (bindable)      |
| `title`        | `string`  | `'Confirm'`  | Alert title                         |
| `message`      | `string`  | -            | Alert message/question              |
| `cancelText`   | `string`  | `'Cancel'`   | Cancel button text                  |
| `continueText` | `string`  | `'Continue'` | Confirm button text                 |
| `destructive`  | `boolean` | `false`      | Style confirm as destructive action |

## Events

| Event        | Payload | Description            |
| ------------ | ------- | ---------------------- |
| `oncancel`   | -       | Cancel button clicked  |
| `oncontinue` | -       | Confirm button clicked |

## Variants

### Standard Confirmation

```svelte
<Alert
	title="Save Changes?"
	message="You have unsaved changes. Would you like to save before leaving?"
	continueText="Save" />
```

### Destructive Action

```svelte
<Alert
	title="Delete Item"
	message="This action cannot be undone. Are you sure?"
	continueText="Delete"
	destructive />
```

- Confirm button uses error color
- More prominent warning styling

## Delightful Details

### Focus Default

- Confirm button auto-focused for quick keyboard confirmation
- Unless `destructive`, then cancel is focused (safer default)

### Quick Dismiss

- Enter key confirms
- Escape key cancels
- Backdrop click cancels

### Transition

- Inherits smooth modal animations
- Quick in/out for responsive feel

## Accessibility

- Inherits all Modal accessibility features
- Clear button labeling
- Keyboard navigable

## Current Implementation

The current implementation is **complete**:

- Uses Modal component internally
- Button arrangement with callbacks
- Title and message display
- Customizable button text

## Code Example

```svelte
<script>
	import { Alert } from '@delightstack/components';

	let showAlert = $state(false);

	function handleDelete() {
		showAlert = true;
	}

	async function confirmDelete() {
		await api.deleteItem(itemId);
		showAlert = false;
	}
</script>

<Alert
	bind:open={showAlert}
	title="Delete Item"
	message="Are you sure you want to delete this item? This cannot be undone."
	cancelText="Keep It"
	continueText="Delete"
	destructive
	oncancel={() => (showAlert = false)}
	oncontinue={confirmDelete} />
```

## Programmatic API

Consider adding a programmatic API for convenience:

```typescript
import { alert } from '@delightstack/components';

const confirmed = await alert({
	title: 'Delete?',
	message: 'This cannot be undone.',
	destructive: true,
});

if (confirmed) {
	// proceed with deletion
}
```
