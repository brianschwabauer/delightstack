# Toast

**Status**: Planned
**Category**: Feedback
**File**: `packages/components/src/feedback/Toast.svelte`

## Description

A brief, non-blocking notification that appears temporarily to provide feedback about an action. Toasts are created programmatically via the `toast()` function and rendered by a `<Toaster />` container component that the user places once in their root layout. Supports auto-dismiss with progress indicators, stacking with compression, swipe-to-dismiss on touch, and promise-based toasts for async operations.

## Dependencies

- **Components**: Portal (renders Toaster outside the DOM hierarchy)
- **Utilities**: None

## Visual Design

### Individual Toast

- Compact rounded card with subtle shadow for elevation
- Left-aligned icon (variant-dependent) + message text + optional action button + close button
- Consistent width: `360px` (configurable on Toaster)
- Background uses `light-dark()` for automatic dark mode support

```
┌──────────────────────────────────────────┐
│ [Icon]  Message text here    [Action] [×] │
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← progress bar
└──────────────────────────────────────────┘
```

### Variants (Boolean Props on toast options)

| Prop | Color | Default Icon | Use Case |
|------|-------|-------------|----------|
| (none/default) | `--color-neutral` | None | General information |
| `success` | `--color-success` | Checkmark circle | Confirmations |
| `warning` | `--color-warning` | Triangle alert | Important notices |
| `error` | `--color-error` | X circle | Errors, failures |

### Stacking Behavior

- Latest toast appears on top of the stack
- Older toasts compress vertically: scale down slightly and reduce opacity
- Only the top 3 toasts are fully visible; older ones collapse into a compressed stack
- Hovering over the stack expands all visible toasts to full size
- Excess toasts beyond `maxVisible` are queued and shown as earlier ones dismiss

```
Expanded (on hover):         Compressed (default):

┌────────────────────┐       ┌────────────────────┐  ← newest
│ Toast 3 (newest)   │       │ Toast 3 (newest)   │
└────────────────────┘       └────────────────────┘
┌────────────────────┐        └──────────────────┘   ← scaled 0.95
│ Toast 2            │          └────────────────┘   ← scaled 0.90
└────────────────────┘
┌────────────────────┐
│ Toast 1 (oldest)   │
└────────────────────┘
```

## Programmatic API

```typescript
import { toast } from '@delightstack/components';

// Simple default toast
toast('Message saved');

// Variant shortcuts
toast.success('File uploaded successfully');
toast.error('Failed to save changes');
toast.warning('You have unsaved changes');

// With options
toast('Item deleted', {
	duration: 6000,
	action: {
		label: 'Undo',
		onclick: () => restoreItem(),
	},
});

// Promise toast — tracks async operation
toast.promise(saveData(), {
	loading: 'Saving...',
	success: 'Saved!',
	error: 'Failed to save',
});

// Promise with dynamic messages
toast.promise(uploadFile(), {
	loading: 'Uploading...',
	success: (result) => `Uploaded ${result.filename}`,
	error: (err) => `Upload failed: ${err.message}`,
});

// Custom content via snippet reference
toast('', { snippet: myCustomSnippet, data: { user } });

// Dismiss
toast.dismiss(toastId);    // Dismiss specific toast
toast.dismiss();           // Dismiss all toasts
```

### ToastOptions

```typescript
interface ToastOptions {
	duration?: number;            // Auto-dismiss time in ms. Default: 4000
	dismissible?: boolean;        // Show close button. Default: true
	success?: boolean;            // Success variant
	warning?: boolean;            // Warning variant
	error?: boolean;              // Error variant
	action?: {
		label: string;
		onclick: () => void;
	};
	icon?: Component;             // Custom icon component
	persistent?: boolean;         // Never auto-dismiss. Default: false
	progress?: boolean;           // Show countdown progress bar. Default: true
	snippet?: Snippet;            // Custom content snippet
	data?: Record<string, any>;   // Data passed to custom snippet
	id?: string;                  // Custom ID (auto-generated if omitted)
}
```

The `toast()` function and all variant shortcuts return the toast `id` (string) which can be passed to `toast.dismiss(id)`.

### Promise Toast

```typescript
toast.promise<T>(
	promise: Promise<T>,
	messages: {
		loading: string;
		success: string | ((result: T) => string);
		error: string | ((error: Error) => string);
	},
	options?: Omit<ToastOptions, 'success' | 'warning' | 'error' | 'persistent' | 'duration'>
): Promise<T>;
```

- While the promise is pending, shows a toast with a spinner and the `loading` message (non-dismissible, no countdown)
- On resolve, transitions to a success toast with the `success` message (auto-dismisses after `duration`)
- On reject, transitions to an error toast with the `error` message (auto-dismisses after `duration`)
- Returns the original promise so it can be awaited

## Toaster Container

The user places `<Toaster />` once in their root layout. It renders via Portal to the end of `<body>`.

```svelte
<script>
	import { Toaster } from '@delightstack/components';
</script>

{@render children()}
<Toaster />
```

### Toaster Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `Position` | `'bottom-right'` | Screen position for the toast stack |
| `maxVisible` | `number` | `5` | Maximum visible toasts before queuing |
| `gap` | `number` | `8` | Spacing between toasts (px) |
| `width` | `number` | `360` | Toast width (px) |
| `duration` | `number` | `4000` | Default auto-dismiss duration for all toasts (ms) |
| `progress` | `boolean` | `true` | Show progress bar by default |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Position Type

```typescript
type Position =
	| 'top-left' | 'top-center' | 'top-right'
	| 'bottom-left' | 'bottom-center' | 'bottom-right';
```

## Behavior

### Auto-Dismiss

- Default duration: 4000ms
- Setting `persistent: true` disables auto-dismiss (toast stays until manually dismissed)
- Toasts with an `action` add 2000ms to the duration to give the user time to interact
- If a toast has an action, clicking the action dismisses the toast after the callback runs

### Hover Pause

- Hovering anywhere over the toast stack pauses all active countdown timers
- Progress bars freeze at their current position
- Timers resume from their remaining time when the cursor leaves the stack
- This applies to all visible toasts, not just the one under the cursor

### Swipe to Dismiss (Touch)

- On touch devices, swipe horizontally to dismiss a toast
- Swipe follows the finger with resistance at the edges
- Toast dismisses when swipe distance exceeds 40% of toast width, or on a fast flick
- Visual: toast slides out and fades, then the gap collapses

### Progress Indicator

- Thin bar at the bottom of the toast showing remaining time
- Fills from 100% to 0% as the countdown runs
- Uses the variant color (success = green, error = red, etc.)
- Pauses when the stack is hovered
- Hidden when `progress: false` or when `persistent: true`

### Custom Content

Pass a Snippet reference via the `snippet` option:

```svelte
<script>
	import { toast, Toaster } from '@delightstack/components';
</script>

{#snippet profileToast(data)}
	<div class="custom-toast">
		<img src={data.user.avatar} alt="" />
		<p>{data.user.name} sent you a message</p>
	</div>
{/snippet}

<button onclick={() => toast('', { snippet: profileToast, data: { user } })}>
	Show Custom Toast
</button>

<Toaster />
```

## Delightful Details

### Entry Animation

- Slide in from the edge matching the position (e.g., slide up from bottom for `bottom-*`)
- Scale from 0.95 to 1.0
- Opacity 0 to 1
- Duration: 200ms with `--ease-spring`

### Exit Animation

- Slide out toward the edge
- Opacity fades to 0
- Height collapses smoothly so remaining toasts close the gap
- Duration: 150ms with `--ease-default`

### Stack Compression

- Each toast below the top one is offset vertically by a decreasing amount
- Scale decreases: 1.0, 0.95, 0.90 for the top 3
- Opacity decreases: 1.0, 0.8, 0.6
- On hover, all toasts expand to full size/opacity with a staggered transition (50ms delay per toast)

### Promise Toast Transitions

- Loading state: spinner icon rotates in the icon slot
- On resolve/reject: spinner crossfades to the success/error icon
- Background color transitions smoothly to the variant color
- Message text crossfades

### Swipe Feedback

- Toast follows the touch with slight resistance (0.7x multiplier past 20% width)
- Opacity decreases proportionally to swipe distance
- If released below threshold, toast springs back to original position

## Accessibility

- `role="status"` for default/success toasts (polite announcement)
- `role="alert"` for warning/error toasts (assertive announcement)
- Each toast is an `aria-live` region so screen readers announce new toasts
- Close button has `aria-label="Dismiss notification"`
- Action button is keyboard-focusable
- `Escape` key dismisses the most recent toast
- Focus does not move to toasts automatically (non-intrusive)
- Respects `prefers-reduced-motion`: disables slide/scale animations, uses opacity-only transitions

## Code Example

```svelte
<script>
	import { Toaster, toast, Button } from '@delightstack/components';

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
				onclick: () => restoreItem(),
			},
		});
	}

	async function handleUpload() {
		toast.promise(uploadFile(), {
			loading: 'Uploading...',
			success: 'Upload complete!',
			error: (err) => `Upload failed: ${err.message}`,
		});
	}
</script>

<!-- Place Toaster once in root layout -->
<Toaster position="bottom-right" />

<Button onclick={handleSave}>Save</Button>
<Button onclick={handleDelete}>Delete</Button>
<Button onclick={handleUpload}>Upload</Button>

<!-- Persistent warning -->
<Button onclick={() => toast.warning('Session expiring soon', { persistent: true })}>
	Warn
</Button>

<!-- Dismiss all -->
<Button onclick={() => toast.dismiss()}>Clear All</Button>
```

## CSS Approach

```css
.toaster {
	position: fixed;
	z-index: var(--layer-toast);
	display: flex;
	flex-direction: column;
	pointer-events: none;
	padding: 1rem;

	&.bottom-right { bottom: 0; right: 0; align-items: flex-end; }
	&.bottom-left  { bottom: 0; left: 0;  align-items: flex-start; }
	&.bottom-center { bottom: 0; left: 50%; transform: translateX(-50%); align-items: center; }
	&.top-right    { top: 0; right: 0; align-items: flex-end; flex-direction: column-reverse; }
	&.top-left     { top: 0; left: 0;  align-items: flex-start; flex-direction: column-reverse; }
	&.top-center   { top: 0; left: 50%; transform: translateX(-50%); align-items: center; flex-direction: column-reverse; }
}

.toast {
	pointer-events: auto;
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	border-radius: var(--radius-md);
	background: light-dark(var(--color-white), var(--color-gray-900));
	box-shadow: var(--shadow-lg);
	width: var(--toast-width, 360px);
	position: relative;
	overflow: hidden;
	transition:
		transform var(--duration-normal) var(--ease-spring),
		opacity var(--duration-normal) var(--ease-default);
	touch-action: pan-y;

	&.success .toast-icon { color: var(--color-success); }
	&.warning .toast-icon { color: var(--color-warning); }
	&.error   .toast-icon { color: var(--color-error); }
}

.toast-progress {
	position: absolute;
	bottom: 0;
	left: 0;
	height: 3px;
	background: var(--color-action);
	transition: width 100ms linear;

	.success & { background: var(--color-success); }
	.warning & { background: var(--color-warning); }
	.error &   { background: var(--color-error); }
}

.toast-action {
	margin-left: auto;
	flex-shrink: 0;
	font-weight: 600;
	color: var(--color-action);
	background: none;
	border: none;
	cursor: pointer;
	padding: 0.25rem 0.5rem;
	border-radius: var(--radius-sm);

	&:hover { background: var(--color-action-bg); }
}

.toast-dismiss {
	flex-shrink: 0;
	color: var(--color-text-muted);
	background: none;
	border: none;
	cursor: pointer;
	padding: 0.25rem;
	border-radius: var(--radius-sm);

	&:hover { color: var(--color-text); }
}
```

## Implementation Notes

- Use a shared reactive store (Svelte module-level `$state`) to hold the toast queue, accessible by both `toast()` and `<Toaster />`
- `<Toaster />` renders via Portal to `document.body`
- Each toast tracks its remaining time in a `$state` variable; countdown runs via `requestAnimationFrame` for smooth progress bar updates
- Hover detection on the `.toaster` container (not individual toasts) pauses all timers
- Swipe uses `pointerdown`/`pointermove`/`pointerup` events with `touch-action: pan-y` to allow vertical scrolling
- Stack compression uses CSS `transform: scale()` and `translateY()` calculated based on index from top
- Promise toast reuses the same toast ID, updating its content/variant reactively as the promise settles
- `toast.dismiss()` with no arguments iterates all active toasts and triggers their exit animation
