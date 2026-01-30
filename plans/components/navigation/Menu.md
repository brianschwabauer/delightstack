# Menu

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Menu.svelte`

## Description

A dropdown menu component for navigation and actions. Appears on click or hover, containing a list of selectable options with support for icons, shortcuts, and nested submenus.

## Visual Design

### Container
- Card-style dropdown
- Subtle shadow for elevation
- Rounded corners
- Positioned relative to trigger

### Menu Items
- Clear text labels
- Optional leading icons
- Keyboard shortcuts right-aligned
- Hover highlight

### Separator
- Thin line between groups
- Visual section divider

### Submenu
- Arrow indicator
- Opens to side on hover
- Proper positioning

## Props

### Menu Container
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `trigger` | `HTMLElement` | - | Trigger element |
| `placement` | `Placement` | `'bottom-start'` | Menu position |
| `closeOnSelect` | `boolean` | `true` | Close after selection |
| `dense` | `boolean` | `false` | Compact item spacing |
| `comfortable` | `boolean` | `false` | Relaxed item spacing |

### MenuItem
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `Component` | - | Leading icon |
| `shortcut` | `string` | - | Keyboard shortcut |
| `disabled` | `boolean` | `false` | Disable item |
| `danger` | `boolean` | `false` | Destructive styling |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ item }` | Item selected |
| `onopen` | - | Menu opened |
| `onclose` | - | Menu closed |

## Structure

```svelte
<Menu bind:open trigger={buttonRef}>
  <MenuItem icon={EditIcon} shortcut="Cmd+E" onclick={edit}>
    Edit
  </MenuItem>
  <MenuItem icon={CopyIcon} shortcut="Cmd+C" onclick={copy}>
    Copy
  </MenuItem>
  <MenuSeparator />
  <MenuItem icon={TrashIcon} danger onclick={remove}>
    Delete
  </MenuItem>
</Menu>
```

## Features

### Trigger Integration
```svelte
<Button bind:element={buttonRef} onclick={() => open = !open}>
  Options
</Button>
<Menu bind:open trigger={buttonRef}>
  ...
</Menu>
```

### Submenus
```svelte
<MenuItem submenu>
  Share
  {#snippet menu()}
    <MenuItem onclick={shareEmail}>Email</MenuItem>
    <MenuItem onclick={shareSlack}>Slack</MenuItem>
    <MenuItem onclick={copyLink}>Copy Link</MenuItem>
  {/snippet}
</MenuItem>
```

### Grouped Items
```svelte
<MenuGroup label="Actions">
  <MenuItem>Edit</MenuItem>
  <MenuItem>Duplicate</MenuItem>
</MenuGroup>
<MenuSeparator />
<MenuGroup label="Danger Zone">
  <MenuItem danger>Delete</MenuItem>
</MenuGroup>
```

### Checkbox/Radio Items
```svelte
<MenuCheckboxItem checked={showGrid} onchange={toggleGrid}>
  Show Grid
</MenuCheckboxItem>

<MenuRadioGroup value={view} onchange={setView}>
  <MenuRadioItem value="list">List View</MenuRadioItem>
  <MenuRadioItem value="grid">Grid View</MenuRadioItem>
</MenuRadioGroup>
```

## Delightful Details

### Smooth Appearance
- Fade + scale animation
- Origin from trigger
- Quick and snappy

### Hover Transitions
- Smooth background transition
- Icon color changes
- Clear feedback

### Submenu Delay
- Brief delay before opening
- Prevents accidental opens
- Smooth experience

### Keyboard Navigation
- Arrow keys move focus
- Enter selects
- Escape closes (nested aware)
- Type-ahead search

### Shortcut Display
- Right-aligned, muted
- Platform-aware (Cmd vs Ctrl)
- Helps discoverability

## Accessibility

- `role="menu"` and `role="menuitem"`
- Keyboard fully functional
- Focus management
- ARIA states

## Code Example

```svelte
<script>
  import { Menu, MenuItem, MenuSeparator, Button } from '@delightstack/components';
  import EditIcon from '~icons/mdi/pencil';
  import CopyIcon from '~icons/mdi/content-copy';
  import TrashIcon from '~icons/mdi/delete';

  let buttonRef = $state<HTMLElement>();
  let menuOpen = $state(false);
</script>

<Button bind:element={buttonRef} onclick={() => menuOpen = !menuOpen}>
  Actions
</Button>

<Menu bind:open={menuOpen} trigger={buttonRef}>
  <MenuItem icon={EditIcon} shortcut="E" onclick={handleEdit}>
    Edit
  </MenuItem>
  <MenuItem icon={CopyIcon} shortcut="Cmd+D" onclick={handleDuplicate}>
    Duplicate
  </MenuItem>
  <MenuSeparator />
  <MenuItem icon={TrashIcon} danger onclick={handleDelete}>
    Delete
  </MenuItem>
</Menu>
```

## Implementation Notes

- Use Popover internally for positioning
- Focus management for keyboard nav
- Handle nested menu state
- Support both click and hover triggers
- Close on outside click
