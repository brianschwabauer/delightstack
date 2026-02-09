# Button

**Category**: Actions
**File**: `packages/components/src/actions/Button.svelte`

## Description

A versatile, polished button component that serves as the primary interactive element throughout the application. Features satisfying ripple effects, smooth loading states, promise-aware handlers, built-in Popover integration for dropdown menus and confirmation flows, and multiple visual variants that can be freely combined.

## Dependencies

- **Popover** -- used internally for `confirmMode` confirmation prompt and the `dropdown` snippet pattern
- **`@delightstack/utilities`**:
  - `ripple` -- material-style ripple effect on click (`{@attach ripple()}`)
  - `tooltip` -- hover tooltip when the `tooltip` prop is set (`{@attach tooltip(tooltipText)}`)

## Visual Design

### Default Appearance (Solid)
- Solid background using `--color-action`
- Tinted off-white text (`--color-action-text`) that brightens to pure white on hover
- Subtle rounded corners (`--radius-md`)
- Soft shadow on hover for depth
- Comfortable padding: `8px 16px` (size `'1'`)

### Hover State
- Background shifts to `--color-action-hover`
- Text brightens to `--color-action-text-hover`
- Gentle scale transform (`1.01x`)
- Shadow elevation increase
- Cursor pointer

### Active / Pressed State
- Scale down slightly (`0.98x`)
- Ripple effect emanates from exact click point
- Shadow reduces

### Focus State
- Visible focus ring using `--color-focus-ring`
- `outline: var(--focus-ring-width) solid var(--color-focus-ring)`
- Offset by `--focus-ring-offset`

### Disabled State
- Reduced opacity (`0.5`)
- No hover effects
- `cursor: not-allowed`
- Ripple suppressed

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'00' \| '0' \| '1' \| '2' \| '3'` | `'1'` | Button size |
| `transparent` | `boolean` | `false` | No background or border (ghost style) |
| `translucent` | `boolean` | `false` | Semi-transparent tinted background |
| `outline` | `boolean` | `false` | Transparent background with border |
| `accent` | `boolean` | `false` | Use `--color-accent` color scheme |
| `error` | `boolean` | `false` | Use `--color-error` color scheme |
| `success` | `boolean` | `false` | Use `--color-success` color scheme |
| `icon` | `Component` | - | Icon component to display |
| `iconPosition` | `'start' \| 'end'` | `'start'` | Icon placement relative to text |
| `iconOnly` | `boolean` | `false` | Icon-only button (circular, requires `aria-label`) |
| `pill` | `boolean` | `false` | Fully rounded corners (`--radius-full`) |
| `fullWidth` | `boolean` | `false` | Stretch to container width |
| `loading` | `boolean` | `false` | Show loading spinner (also set automatically by promise-aware handlers) |
| `loadingText` | `string` | - | Text to show while loading (e.g. `"Saving..."`) |
| `confirmMode` | `boolean` | `false` | Show a Popover confirmation prompt on click; fires `onconfirm` only when confirmed |
| `confirmText` | `string` | `'Are you sure?'` | Message shown inside the confirmation Popover |
| `onconfirm` | `() => void \| Promise<void>` | - | Callback fired when the user confirms inside the confirmation Popover |
| `disabled` | `boolean` | `false` | Disable interaction |
| `href` | `string` | - | Renders as `<a>` tag instead of `<button>` |
| `target` | `string` | - | Link target attribute (when `href` is set) |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | HTML button type |
| `menu` | `boolean` | `false` | Enable built-in Popover dropdown (render content via the `dropdown` snippet) |
| `disableRipple` | `boolean` | `false` | Disable ripple effect |
| `tooltip` | `string` | - | Hover tooltip text via `{@attach tooltip()}` |
| `badge` | `number \| boolean` | - | Badge indicator positioned top-right; `true` renders a dot, a number renders the count (truncated at `99+`) |
| `skeleton` | `boolean` | `false` | Render a skeleton placeholder instead of the button content |
| `active` | `boolean` | `false` | Visually pressed / selected state (useful inside ButtonGroup toggles) |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form element name |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the underlying DOM element (`$bindable()`) |
| `onclick` | `(e: MouseEvent) => void \| Promise<void>` | - | Click handler; returning a Promise enables automatic loading state |
| `children` | `Snippet` | - | Button label content |
| `dropdown` | `Snippet<[{ close: () => void }]>` | - | Content rendered inside the dropdown Popover when `menu` is true |

## Boolean Variant Props

Variant booleans can be combined freely. The default appearance (solid action-colored) requires no variant props at all.

| Combination | Result |
|-------------|--------|
| _(none)_ | Solid action button |
| `outline` | Bordered, transparent background, fills on hover |
| `transparent` | No background or border, color text, subtle hover fill |
| `translucent` | Light tinted background using `color-mix()` |
| `accent` | Purple/accent color scheme |
| `error` | Red/destructive color scheme |
| `success` | Green/success color scheme |
| `transparent error` | Ghost-style destructive button |
| `outline accent` | Bordered accent button |
| `translucent success` | Soft green tinted background |

## Sizes

| Size | Padding | Font Size | Min Height | Icon-Only Diameter |
|------|---------|-----------|------------|--------------------|
| `'00'` | `2px 8px` | `--text-xs` | `24px` | `24px` |
| `'0'` | `4px 12px` | `--text-sm` | `28px` | `28px` |
| `'1'` | `8px 16px` | `--text-base` | `36px` | `36px` |
| `'2'` | `10px 20px` | `--text-lg` | `40px` | `40px` |
| `'3'` | `12px 24px` | `--text-lg` | `44px` | `44px` |

## Delightful Details

### Ripple Effect
- Originates from exact click position via `{@attach ripple()}`
- Smooth radial expansion (`300ms`)
- Fades out gracefully
- Color matches button variant with reduced opacity
- Suppressed when `disableRipple` is true or button is disabled

### Promise-Aware Handlers
When `onclick` returns a `Promise`, the button automatically enters loading state until the promise settles. On success, a brief checkmark flash provides confirmation. On rejection, the button returns to its normal state.

```svelte
<Button onclick={async () => {
  await api.save(data);
}}>
  Save
</Button>
```

Optional `loadingText` changes the label while loading:

```svelte
<Button loadingText="Saving..." onclick={handleSave}>
  Save
</Button>
```

### Loading State
- Spinner replaces content (button width is preserved to prevent layout shift)
- Subtle pulse animation on button
- All interaction disabled during loading
- `aria-busy="true"` announced to screen readers

### Confirm Mode
For destructive or important actions. When `confirmMode` is true and the user clicks the button, a Popover appears anchored to the button asking for confirmation. Only when confirmed does `onconfirm` fire. The Popover closes automatically on cancel or outside click.

```svelte
<Button confirmMode error onconfirm={deleteItem} confirmText="Delete this permanently?">
  Delete
</Button>
```

Flow:
1. User clicks the button.
2. A Popover opens anchored to the button with the `confirmText` message and two actions: Cancel and Confirm.
3. **Cancel** (or clicking outside, or pressing Escape) closes the Popover. Nothing happens.
4. **Confirm** closes the Popover and fires `onconfirm`. If `onconfirm` returns a Promise, the button enters loading state until it resolves.

### Dropdown / Menu Pattern
When `menu` is true, clicking the button toggles a Popover containing the `dropdown` snippet. The snippet receives a `{ close }` function so items can dismiss the menu after acting.

```svelte
<Button menu icon={MoreIcon} iconOnly aria-label="More options">
  {#snippet dropdown({ close })}
    <List>
      <ListItem onclick={() => { editItem(); close(); }}>Edit</ListItem>
      <ListItem onclick={() => { duplicateItem(); close(); }}>Duplicate</ListItem>
      <ListItem onclick={() => { deleteItem(); close(); }} class="destructive">Delete</ListItem>
    </List>
  {/snippet}
</Button>
```

The Popover is positioned `bottom-start` by default and uses Floating UI for smart repositioning.

### Icon-Only Mode
- Circular button shape
- Requires `aria-label` or `tooltip` for accessibility
- Auto-applies tooltip from `aria-label` if `tooltip` is not explicitly set
- Consistent sizing across icon sizes

```svelte
<Button iconOnly icon={TrashIcon} tooltip="Delete item" error transparent />
```

### Success Feedback
- After a successful async operation, brief green checkmark flash
- Returns to normal after `1.5s`

### Badge
- Small circular indicator positioned top-right
- Pulse animation for attention
- `true` renders a dot; numbers display the count (truncated at `99+`)

## Accessibility

- Full keyboard navigation (Space / Enter to activate)
- Clear focus indicators
- `aria-label` required for icon-only buttons
- Loading state announced via `aria-busy`
- Disabled state communicated via `aria-disabled` (not the `disabled` attribute, so tooltip still works)
- Confirmation Popover is focus-trapped and keyboard-navigable

## Code Example

```svelte
<script>
  import { Button, List, ListItem } from '@delightstack/components';
  import SaveIcon from '~icons/mdi/content-save';
  import MoreIcon from '~icons/mdi/dots-vertical';

  let { data } = $props();

  async function handleSave() {
    await api.save(data);
  }
</script>

<!-- Basic button with icon and tooltip -->
<Button icon={SaveIcon} onclick={handleSave} tooltip="Save changes">
  Save
</Button>

<!-- Outline accent button -->
<Button outline accent>
  Cancel
</Button>

<!-- Pill button with badge -->
<Button pill badge={3}>
  Notifications
</Button>

<!-- Destructive confirmation -->
<Button confirmMode error onconfirm={deleteItem}>
  Delete
</Button>

<!-- Dropdown menu -->
<Button menu transparent icon={MoreIcon} iconOnly aria-label="Actions">
  {#snippet dropdown({ close })}
    <List>
      <ListItem onclick={() => { edit(); close(); }}>Edit</ListItem>
      <ListItem onclick={() => { remove(); close(); }}>Remove</ListItem>
    </List>
  {/snippet}
</Button>

<!-- Skeleton placeholder while loading content -->
<Button skeleton />
```

## CSS Approach

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition:
    background var(--duration-fast) var(--ease-default),
    color var(--duration-fast) var(--ease-default),
    transform var(--duration-fast) var(--ease-default),
    box-shadow var(--duration-fast) var(--ease-default);

  background: var(--color-action);
  color: var(--color-action-text);

  &:hover {
    background: var(--color-action-hover);
    color: var(--color-action-text-hover);
    transform: scale(1.01);
  }

  &:active {
    transform: scale(0.98);
  }

  &.outline {
    background: transparent;
    border-color: var(--color-border-strong);
    color: var(--color-action);
  }

  &.transparent {
    background: transparent;
    border-color: transparent;
    color: var(--color-action);
  }

  &.translucent {
    background: color-mix(in oklch, var(--color-action) 12%, transparent);
    color: var(--color-action);
  }

  &.error {
    background: var(--color-error);
    color: var(--color-action-text);
  }

  &.pill {
    border-radius: var(--radius-full);
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
}
```
