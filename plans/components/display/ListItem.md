# ListItem

**Status**: ✅ Complete
**Category**: Display
**File**: `packages/components/src/display/ListItem.svelte`

## Description

A versatile list item component that adapts to its parent List context. Supports multiple interaction modes, loading states, and rich content layouts. Works standalone but shines within a List container.

## Visual Design

### Layout
- Flexible horizontal layout
- Leading content area (icon, avatar, checkbox)
- Main content (text, description)
- Trailing content area (action, chevron)

### States
- **Default**: Subtle background
- **Hover**: Elevated background color
- **Active/Selected**: Accent background tint
- **Disabled**: Reduced opacity
- **Loading**: Spinner replacing content

### Selection Indicators
- **Radio**: Circle with filled dot
- **Checkbox**: Square with checkmark
- Smooth animation on state change

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Value for selection modes |
| `disabled` | `boolean` | `false` | Disable interaction |
| `active` | `boolean` | `false` | Force active appearance |
| `href` | `string` | - | Render as link |
| `target` | `string` | - | Link target |
| `menu` | `boolean` | `false` | Has submenu |

### Popover Integration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `popoverPlacement` | `Placement` | `'right-start'` | Submenu position |
| `popoverCloseOnInsideClick` | `boolean` | `true` | Close on submenu click |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onclick` | `MouseEvent` | Item clicked (supports Promise) |
| `onchange` | `{ checked, value }` | Selection changed |

## Content Structure

```svelte
<ListItem>
  {#snippet start()}
    <Avatar src={user.avatar} />
  {/snippet}

  <span class="title">{user.name}</span>
  <span class="subtitle">{user.email}</span>

  {#snippet end()}
    <ChevronIcon />
  {/snippet}
</ListItem>
```

## Variants Based on List Type

### Button Type (Default)
- Clickable with ripple effect
- Hover/active states
- Optional loading on async click

### Radio Type
- Radio button on left
- Label is clickable
- Single selection per list

### Checkbox Type
- Checkbox on left
- Supports indeterminate state
- Multiple selection

### Text Type
- Non-interactive
- No hover effects
- Display-only

## Delightful Details

### Async Click Handling
```svelte
<ListItem onclick={async () => {
  await api.saveItem();
}}>
  Save Item
</ListItem>
```
- Automatically shows loading spinner
- Prevents double-clicks
- Returns to normal on complete

### Smooth Selection
- Checkbox/radio animate smoothly
- Background color transitions
- No jarring state changes

### Submenu Support
```svelte
<ListItem menu>
  More Options
  {#snippet dropdown()}
    <List>
      <ListItem>Option A</ListItem>
      <ListItem>Option B</ListItem>
    </List>
  {/snippet}
</ListItem>
```
- Chevron indicator
- Hover opens submenu
- Keyboard accessible

### Custom Checkbox/Radio Styling
- Not using native inputs
- Consistent cross-browser
- Animated check/fill
- Custom colors supported

## Accessibility

- Proper roles based on type
- Keyboard navigation
- Focus indicators
- ARIA states for selection

## Current Implementation

The current implementation is **complete** with:
- All interaction types
- Async onclick with loading
- Custom checkbox/radio styling
- Submenu support via Popover
- Context integration with List
- Full accessibility

## Code Example

```svelte
<script>
  import { List, ListItem } from '@delightstack/components';
  import UserIcon from '~icons/mdi/account';
  import SettingsIcon from '~icons/mdi/cog';
  import LogoutIcon from '~icons/mdi/logout';
</script>

<!-- Menu with icons -->
<List>
  <ListItem href="/profile">
    {#snippet start()}<UserIcon />{/snippet}
    Profile
  </ListItem>
  <ListItem href="/settings">
    {#snippet start()}<SettingsIcon />{/snippet}
    Settings
  </ListItem>
  <ListItem onclick={handleLogout}>
    {#snippet start()}<LogoutIcon />{/snippet}
    Log Out
  </ListItem>
</List>

<!-- Settings with toggles -->
<List type="checkbox" bind:value={settings}>
  <ListItem value="notifications">
    Enable Notifications
    {#snippet end()}
      <span class="hint">Recommended</span>
    {/snippet}
  </ListItem>
  <ListItem value="darkMode">
    Dark Mode
  </ListItem>
  <ListItem value="sounds">
    Sound Effects
  </ListItem>
</List>
```

## Styling

Override with CSS custom properties:

```css
.my-list-item {
  --list-item-padding-x: 16px;
  --list-item-padding-y: 12px;
  --list-item-hover-bg: rgba(0, 0, 0, 0.05);
  --list-item-active-bg: var(--c-action-alpha);
  --checkbox-size: 20px;
  --radio-size: 20px;
}
```
