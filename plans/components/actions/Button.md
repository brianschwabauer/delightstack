# Button

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/Button.svelte`

## Description

A versatile, polished button component that serves as the primary interactive element throughout the application. Features satisfying ripple effects, smooth loading states, and multiple visual variants while maintaining a cohesive design language.

## Visual Design

### Default Appearance
- Solid background using `--c-action` color
- White text with medium font weight
- Subtle rounded corners (`--radius-2`)
- Soft shadow on hover for depth
- Comfortable padding: `8px 16px` (default size)

### Hover State
- Slight brightness increase
- Gentle scale transform (1.01x)
- Shadow elevation increase
- Cursor pointer

### Active/Pressed State
- Scale down slightly (0.98x)
- Ripple effect emanates from click point
- Shadow reduces

### Focus State
- Visible focus ring using `--c-action` with alpha
- No outline (custom focus indicator)

### Disabled State
- Reduced opacity (0.5)
- No hover effects
- Cursor not-allowed
- No ripple on click

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | Button size variant |
| `variant` | `'solid' \| 'outline' \| 'ghost' \| 'link'` | `'solid'` | Visual style |
| `color` | `'action' \| 'accent' \| 'error' \| 'success'` | `'action'` | Color scheme |
| `icon` | `Component` | - | Icon component to display |
| `iconPosition` | `'start' \| 'end'` | `'start'` | Icon placement |
| `pill` | `boolean` | `false` | Fully rounded corners |
| `fullWidth` | `boolean` | `false` | Stretch to container width |
| `loading` | `boolean` | `false` | Show loading spinner |
| `disabled` | `boolean` | `false` | Disable interaction |
| `href` | `string` | - | Renders as anchor tag |
| `target` | `string` | - | Link target attribute |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | Button type |
| `disableRipple` | `boolean` | `false` | Disable ripple effect |
| `tooltip` | `string` | - | Hover tooltip text |
| `badge` | `string \| number` | - | Badge indicator |

## Variants

### Solid (Default)
```svelte
<Button>Primary Action</Button>
<Button color="accent">Secondary</Button>
<Button color="error">Delete</Button>
<Button color="success">Confirm</Button>
```

### Outline
```svelte
<Button variant="outline">Outlined</Button>
```
- Transparent background
- Border using color scheme
- Fill on hover

### Ghost
```svelte
<Button variant="ghost">Ghost</Button>
```
- No background or border
- Color on hover
- Subtle ripple

### Link
```svelte
<Button variant="link">Link Style</Button>
```
- Underline on hover
- No background ever
- Inline display option

## Sizes

| Size | Padding | Font Size | Min Height |
|------|---------|-----------|------------|
| `small` | `4px 12px` | `--font-size-00` | `28px` |
| `medium` | `8px 16px` | `--font-size-0` | `36px` |
| `large` | `12px 24px` | `--font-size-1` | `44px` |

## Delightful Details

### Ripple Effect
- Originates from exact click position
- Smooth radial expansion (300ms)
- Fades out gracefully
- Color matches button variant with reduced opacity

### Loading State
- Spinner replaces content (maintains button width)
- Subtle pulse animation on button
- Disabled during loading
- Supports async onclick that auto-manages loading:
  ```svelte
  <Button onclick={async () => {
    await saveData();
  }}>
    Save
  </Button>
  ```

### Success Feedback
- After successful async operation, brief success state
- Checkmark icon appears
- Green tint flash
- Returns to normal after 1.5s

### Icon Animation
- Icons have subtle hover transform
- Smooth transition between icon states

### Badge
- Small circular indicator
- Positioned top-right
- Pulse animation for attention
- Supports numbers (truncates at 99+)

## Accessibility

- Full keyboard navigation
- Clear focus indicators
- ARIA labels for icon-only buttons
- Loading state announced to screen readers
- Disabled state properly communicated

## Current Implementation

The current implementation is **complete** with:
- All variant styles
- Ripple effect system
- Loading states with Promise support
- Badge support
- Icon integration
- Dropdown/menu support via Popover
- Full keyboard accessibility
- Tooltip integration

## Code Example

```svelte
<script>
  import { Button } from '@delightstack/components';
  import SaveIcon from '~icons/mdi/content-save';

  async function handleSave() {
    await api.save(data);
  }
</script>

<Button
  icon={SaveIcon}
  onclick={handleSave}
  tooltip="Save changes"
>
  Save
</Button>

<Button variant="outline" color="error">
  Cancel
</Button>

<Button pill badge="3">
  Notifications
</Button>
```
