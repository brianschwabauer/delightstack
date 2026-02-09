# Callout

**Status**: Planned
**Category**: Feedback
**File**: `packages/components/src/feedback/Callout.svelte`

## Description

A highlighted information block for drawing attention to important content. Handles both inline callouts (tips, warnings, notes within content) and full-width banners (announcements, system notifications at the top of the page). The `banner` prop switches between these two modes.

## Dependencies

- **Components**: None (standalone)
- **Utilities**: `autoAnimate` from `@delightstack/utilities` (for entrance/exit animations)

## Visual Design

### Inline Mode (Default)

- Left border accent (4px) in the variant color
- Soft tinted background using `--color-{variant}-bg`
- Rounded corners (`--radius-md`)
- Comfortable padding
- Optional close button (top-right)

```
┌─────────────────────────────────────┐
│ ▌ [Icon]  Title (optional)      [×] │
│ ▌ Content goes here...              │
│ ▌                    [Action?]      │
└─────────────────────────────────────┘
```

### Banner Mode (`banner` prop)

- Full viewport width
- Centered content with max-width
- Solid background color (variant color)
- White/dark text for contrast
- No left border accent
- Optional sticky positioning

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Icon?] Message text here   [Action?]    [×?]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Variants (Boolean Props)

| Prop | Color | Default Icon | Use Case |
|------|-------|-------------|----------|
| (none/`info`) | `--color-info` | Information circle | General information |
| `success` | `--color-success` | Checkmark circle | Positive feedback |
| `warning` | `--color-warning` | Triangle alert | Important notices |
| `error` | `--color-error` | X circle | Errors, critical info |
| `tip` | `--color-accent` | Lightbulb | Pro tips, suggestions |

When no variant boolean is set, defaults to `info` styling.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `success` | `boolean` | `false` | Success variant (green) |
| `warning` | `boolean` | `false` | Warning variant (yellow/orange) |
| `error` | `boolean` | `false` | Error variant (red) |
| `tip` | `boolean` | `false` | Tip variant (accent/purple) |
| `banner` | `boolean` | `false` | Full-width banner mode |
| `title` | `string` | - | Optional heading text |
| `dismissible` | `boolean` | `false` | Show close button |
| `sticky` | `boolean` | `false` | Stick to top on scroll (banner mode) |
| `dense` | `boolean` | `false` | Compact padding |
| `comfortable` | `boolean` | `false` | Relaxed padding |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `ondismiss` | `() => void` | Called when close button is clicked |

### Snippets

| Snippet | Parameters | Description |
|---------|------------|-------------|
| `children` | - | Main content |
| `icon` | - | Custom icon (overrides default) |
| `action` | - | Action area (button, link, etc.) |

## Behavior

### Dismissible

- Close button appears top-right (inline) or far-right (banner)
- Content collapses smoothly with height animation
- Fires `ondismiss` callback
- Optionally persist dismissal state to `localStorage` via `id` prop

### Sticky Banner

- Uses `position: sticky; top: 0`
- Subtle shadow appears when scrolled past original position
- Proper z-index layering (`--layer-sticky`)
- Does not interfere with main navigation

## Delightful Details

### Entrance Animation

**Inline mode:**
- Fade in with subtle scale from 0.98 to 1
- Icon has a slight bounce entrance (delay 100ms)
- Duration: 200ms

**Banner mode:**
- Slide down from top (translateY: -100% → 0)
- Duration: 300ms with `--ease-spring`

### Exit Animation

- Content fades out (opacity 1 → 0)
- Container height collapses smoothly (using CSS `grid-template-rows: 1fr → 0fr` trick)
- No layout jump — surrounding content flows in naturally
- Duration: 200ms

### Icon Treatment

- Sized to match the first line of text
- Color matches variant
- Vertically centered with the title or first line of content
- Subtle entrance animation (scale pop)

### Scroll Behavior (Sticky Banner)

- Smooth transition when entering/leaving sticky state
- Shadow fades in when elevated
- Background gains slight opacity increase when sticky

## Accessibility

- `role="status"` for info/success/tip variants
- `role="alert"` for warning/error variants
- Icon has `aria-hidden="true"`
- Dismiss button has `aria-label="Dismiss"`
- Banner mode uses `<aside>` element
- Inline mode uses `<div>` with appropriate role
- Respects `prefers-reduced-motion` (disables animations)

## Code Example

```svelte
<script>
	import { Callout } from '@delightstack/components';

	let showBanner = $state(true);
</script>

<!-- Info callout (default) -->
<Callout>
	Your changes are automatically saved.
</Callout>

<!-- Warning with title -->
<Callout warning title="Heads up">
	This action cannot be undone.
</Callout>

<!-- Error callout -->
<Callout error>
	Failed to connect to the server. Please try again.
</Callout>

<!-- Dismissible tip -->
<Callout tip title="Pro Tip" dismissible>
	Press <kbd>Cmd+K</kbd> to open the command palette.
</Callout>

<!-- Custom icon and action -->
<Callout>
	{#snippet icon()}
		<RocketIcon />
	{/snippet}

	New feature available! Check out our latest update.

	{#snippet action()}
		<Button size="0" transparent>Learn more</Button>
	{/snippet}
</Callout>

<!-- Full-width banner -->
{#if showBanner}
	<Callout banner dismissible ondismiss={() => showBanner = false}>
		We've updated our privacy policy.

		{#snippet action()}
			<a href="/privacy">Learn more</a>
		{/snippet}
	</Callout>
{/if}

<!-- Sticky warning banner -->
<Callout banner warning sticky>
	Scheduled maintenance tonight at 11pm UTC.
</Callout>

<!-- Success banner -->
<Callout banner success dismissible ondismiss={() => showBanner = false}>
	Your changes have been saved successfully!
</Callout>
```

## CSS Approach

```css
.callout {
	--callout-color: var(--color-info);
	--callout-bg: var(--color-info-bg);

	display: grid;
	grid-template-rows: 1fr;
	border-radius: var(--radius-md);
	background: var(--callout-bg);
	border-left: 4px solid var(--callout-color);
	padding: 1rem 1.25rem;
	transition: grid-template-rows var(--duration-normal) var(--ease-default);

	&.success { --callout-color: var(--color-success); --callout-bg: var(--color-success-bg); }
	&.warning { --callout-color: var(--color-warning); --callout-bg: var(--color-warning-bg); }
	&.error   { --callout-color: var(--color-error);   --callout-bg: var(--color-error-bg);   }
	&.tip     { --callout-color: var(--color-accent);  --callout-bg: color-mix(in oklch, var(--color-accent) 10%, transparent); }

	&.banner {
		border-left: none;
		border-radius: 0;
		width: 100%;
		background: var(--callout-color);
		color: white;
		text-align: center;
	}

	&.sticky {
		position: sticky;
		top: 0;
		z-index: var(--layer-sticky);
	}

	&.dismissing {
		grid-template-rows: 0fr;
		opacity: 0;
	}
}
```

## Implementation Notes

- Use semantic `<aside>` for banner mode, `<div>` for inline
- The grid-template-rows trick allows smooth height collapse without knowing the content height
- For sticky banner shadow, use an `IntersectionObserver` on a sentinel element to detect when the banner becomes sticky
- Icon defaults are imported lazily — only load the icon SVG for the active variant
