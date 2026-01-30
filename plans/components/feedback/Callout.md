# Callout

**Status**: 🔲 Placeholder
**Category**: Feedback
**File**: `packages/components/src/feedback/Callout.svelte`

## Description

A highlighted information block for drawing attention to important content. Used for tips, warnings, notes, or any content that should stand out from the surrounding text.

## Visual Design

### Container
- Distinct background color based on variant
- Left border accent (4px)
- Rounded corners
- Comfortable padding

### Structure
```
[Icon] [Title (optional)]
[Content]
```

### Variants

| Variant | Color | Use Case |
|---------|-------|----------|
| `info` | Blue | General information |
| `success` | Green | Positive feedback |
| `warning` | Yellow/Orange | Important notices |
| `error` | Red | Errors, critical info |
| `tip` | Purple | Pro tips, suggestions |

### Icon Defaults
Each variant has a default icon:
- Info: Information circle
- Success: Checkmark
- Warning: Triangle alert
- Error: X circle
- Tip: Lightbulb

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `'info'` | Color/icon variant |
| `title` | `string` | - | Optional heading |
| `icon` | `Component \| false` | - | Custom icon or hide |
| `dismissible` | `boolean` | `false` | Show close button |
| `dense` | `boolean` | `false` | Compact padding |
| `comfortable` | `boolean` | `false` | Relaxed padding |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ondismiss` | - | Close button clicked |

## Delightful Details

### Subtle Animation
- Gentle fade-in on mount
- Icon has subtle entrance

### Dismiss Animation
- Collapse height smoothly
- Fade out content

### Icon Treatment
- Sized appropriately
- Color matches variant
- Vertically centered with first line

### Content Styling
- Links styled appropriately
- Code inline styled
- Lists with proper spacing

## Variants Visual

```
┌─────────────────────────────────────┐
│ ℹ️ Note                              │ Info
│ This is helpful information...      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ⚠️ Warning                           │ Warning
│ Be careful with this action...      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 💡 Pro Tip                           │ Tip
│ You can use keyboard shortcuts...   │
└─────────────────────────────────────┘
```

## Accessibility

- Proper role (note, alert based on variant)
- Icon has aria-hidden
- Dismissible has clear button label

## Code Example

```svelte
<script>
  import { Callout } from '@delightstack/components';
</script>

<!-- Info callout -->
<Callout>
  Your changes are automatically saved.
</Callout>

<!-- Warning with title -->
<Callout variant="warning" title="Heads up">
  This action cannot be undone.
</Callout>

<!-- Error callout -->
<Callout variant="error">
  Failed to connect to the server. Please try again.
</Callout>

<!-- Dismissible tip -->
<Callout variant="tip" title="Pro Tip" dismissible>
  Press <kbd>Cmd+K</kbd> to open the command palette.
</Callout>

<!-- Custom icon -->
<Callout icon={RocketIcon}>
  New feature available! Check out our latest update.
</Callout>
```

## Implementation Notes

- Use semantic elements (aside, section)
- Support markdown content
- Handle code blocks within
- Consistent spacing system
