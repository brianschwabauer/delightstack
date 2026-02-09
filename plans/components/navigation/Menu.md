# Menu

**Category**: Navigation
**File**: `packages/components/src/navigation/Menu.svelte`

## Description

A dropdown menu component for navigation and actions. Uses Popover internally for positioning and List/ListItem for rendering menu items. Supports submenus (hover on desktop, tap on mobile), multiple item types (action, checkbox, radio, separator, group header), full keyboard navigation with type-ahead search, and badge indicators on items.

## Dependencies

- **Components**: `Popover` -- used internally for floating positioning and open/close behavior; `List`, `ListItem` -- used internally for rendering menu items with consistent styling and interaction
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Container
- Card-style floating dropdown rendered via Popover
- Subtle shadow for elevation (`--shadow-md`)
- Rounded corners (`--radius-md`)
- Background uses `light-dark()` for automatic theming
- Positioned relative to the trigger element

### Menu Items
- Clear text labels with comfortable padding
- Optional leading icon
- Optional trailing badge
- Keyboard shortcut text right-aligned and muted
- Hover background highlight
- Danger items use `--color-error` text

### Separator
- Thin horizontal line (`1px`) between item groups
- Subtle color, margin above and below

### Group Header
- Small, muted, uppercase text label
- Non-interactive, purely organizational

### Submenu
- Trailing chevron/arrow icon on the parent item
- Opens to the side (right by default, flips if no space)
- Connected hover zone between parent item and submenu to prevent accidental close

### Checkbox Items
- Leading checkbox indicator
- Checked state shows checkmark

### Radio Items
- Leading radio indicator within a radio group
- Selected state shows filled circle

## Props

### Menu Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `trigger` | `HTMLElement` | - | Element to position relative to |
| `placement` | `Placement` | `'bottom-start'` | Popover placement |
| `closeOnSelect` | `boolean` | `true` | Close the menu after an item is selected |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Menu item size |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Menu items |
| `onopen` | `() => void` | - | Fires when the menu opens |
| `onclose` | `() => void` | - | Fires when the menu closes |

### MenuItem

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `Component` | - | Leading icon |
| `shortcut` | `string` | - | Keyboard shortcut display text |
| `badge` | `string \| number` | - | Trailing badge indicator |
| `disabled` | `boolean` | `false` | Disable this item |
| `danger` | `boolean` | `false` | Destructive/danger styling |
| `children` | `Snippet` | - | Item label content |
| `menu` | `Snippet` | - | Submenu content (renders a nested Menu) |
| `onclick` | `() => void` | - | Action handler |

### MenuCheckboxItem

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | `false` | Checkbox state (`$bindable()`) |
| `icon` | `Component` | - | Leading icon (after checkbox indicator) |
| `disabled` | `boolean` | `false` | Disable this item |
| `children` | `Snippet` | - | Item label content |
| `onchange` | `(detail: { checked: boolean }) => void` | - | Fires on toggle |

### MenuRadioGroup

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Selected value (`$bindable()`) |
| `children` | `Snippet` | - | MenuRadioItem children |
| `onchange` | `(detail: { value: string }) => void` | - | Fires on selection |

### MenuRadioItem

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Radio value |
| `icon` | `Component` | - | Leading icon (after radio indicator) |
| `disabled` | `boolean` | `false` | Disable this item |
| `children` | `Snippet` | - | Item label content |

### MenuSeparator

No props. Renders a horizontal divider line.

### MenuGroup

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Group header text |
| `children` | `Snippet` | - | Grouped menu items |

## Item Types

| Type | Component | Behavior |
|------|-----------|----------|
| **Action** | `MenuItem` | Fires `onclick`, optionally closes menu |
| **Checkbox** | `MenuCheckboxItem` | Toggles `checked` state, stays open |
| **Radio** | `MenuRadioItem` (inside `MenuRadioGroup`) | Selects one value in group, stays open |
| **Separator** | `MenuSeparator` | Visual divider, non-interactive |
| **Group Header** | `MenuGroup` | Labels a section of items |

## Submenu Support

Submenus are declared via the `menu` snippet on a MenuItem:

```svelte
<MenuItem icon={ShareIcon}>
  Share
  {#snippet menu()}
    <MenuItem onclick={shareEmail}>Email</MenuItem>
    <MenuItem onclick={shareSlack}>Slack</MenuItem>
    <MenuItem onclick={copyLink}>Copy Link</MenuItem>
  {/snippet}
</MenuItem>
```

Behavior:
- **Desktop**: Submenu opens on hover after a brief delay (150ms) to prevent accidental opens. A hover trapezoid zone connects the parent item to the submenu, allowing diagonal mouse movement without closing.
- **Mobile**: Submenu opens on tap. The parent item acts as a toggle. A back button or swipe navigates back to the parent menu.
- Submenus open to the right by default, flipping to the left if there is insufficient viewport space.
- Keyboard: Right arrow opens submenu, Left arrow closes it and returns focus to the parent item.
- Submenus can be nested to any depth (though more than 2 levels is discouraged for usability).

## Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Down | Move focus to next item |
| Arrow Up | Move focus to previous item |
| Enter / Space | Activate focused item |
| Escape | Close menu (or close submenu and return to parent) |
| Arrow Right | Open submenu on focused item |
| Arrow Left | Close submenu, return to parent |
| Home | Move focus to first item |
| End | Move focus to last item |
| Type-ahead | Typing characters focuses the first matching item by label |

Type-ahead search:
- Characters typed within 300ms are accumulated into a search string.
- The first item whose label starts with the accumulated string receives focus.
- After 300ms of no typing, the search buffer resets.

## Delightful Details

### Smooth Appearance
- Fade + scale animation from the trigger origin
- Quick timing (150ms ease-out)
- Uses Popover's built-in animation

### Hover Transitions
- Smooth background color transition on items
- Icon color follows text transition

### Submenu Delay
- 150ms hover delay before submenu opens
- Prevents accidental opens when moving the cursor past submenu items
- Trapezoid hover zone for diagonal mouse movement

### Shortcut Display
- Right-aligned, muted text (`--color-text-tertiary`)
- Platform-aware: shows "Cmd" on macOS, "Ctrl" on Windows/Linux
- Detected via `navigator.platform` or `navigator.userAgentData`

## Accessibility

- `role="menu"` on the menu container
- `role="menuitem"` on action items
- `role="menuitemcheckbox"` on checkbox items with `aria-checked`
- `role="menuitemradio"` on radio items with `aria-checked`
- `role="separator"` on dividers
- `role="group"` on menu groups with `aria-label`
- `aria-haspopup="menu"` on items with submenus
- `aria-expanded` on items with open submenus
- `aria-disabled` on disabled items
- Full keyboard navigation (arrows, Enter, Escape, Home, End, type-ahead)
- Focus management: focus moves into menu on open, returns to trigger on close

## CSS Approach

```css
.menu {
  min-width: 180px;
  max-width: 300px;
  padding: 0.25rem;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: light-dark(var(--color-text-primary), var(--color-text-primary));
  transition: background var(--duration-fast) var(--ease-default);
}

.menu-item:hover,
.menu-item:focus-visible {
  background: light-dark(var(--color-surface-2), var(--color-surface-2));
  outline: none;
}

.menu-item.danger {
  color: var(--color-error);
}

.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.menu-item-icon {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  color: light-dark(var(--color-text-secondary), var(--color-text-secondary));
}

.menu-item-shortcut {
  margin-left: auto;
  font-size: var(--text-xs);
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
}

.menu-item-badge {
  margin-left: auto;
}

.menu-separator {
  height: 1px;
  background: light-dark(var(--color-border), var(--color-border));
  margin: 0.25rem 0;
}

.menu-group-label {
  padding: 0.375rem 0.75rem;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.menu-item-submenu-arrow {
  margin-left: auto;
  width: 1rem;
  height: 1rem;
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
}
```

## Code Example

```svelte
<script>
  import {
    Menu, MenuItem, MenuSeparator, MenuGroup,
    MenuCheckboxItem, MenuRadioGroup, MenuRadioItem,
    Button
  } from '@delightstack/components';
  import EditIcon from '~icons/mdi/pencil';
  import CopyIcon from '~icons/mdi/content-copy';
  import ShareIcon from '~icons/mdi/share-variant';
  import TrashIcon from '~icons/mdi/delete';

  let buttonRef = $state<HTMLElement>();
  let menuOpen = $state(false);
  let showGrid = $state(true);
  let view = $state('list');
</script>

<Button bind:element={buttonRef} onclick={() => menuOpen = !menuOpen}>
  Actions
</Button>

<!-- Basic action menu -->
<Menu bind:open={menuOpen} trigger={buttonRef}>
  <MenuItem icon={EditIcon} shortcut="Cmd+E" onclick={handleEdit}>
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

<!-- Menu with submenu and badges -->
<Menu bind:open={shareMenuOpen} trigger={shareRef}>
  <MenuItem icon={ShareIcon}>
    Share
    {#snippet menu()}
      <MenuItem onclick={shareEmail}>Email</MenuItem>
      <MenuItem onclick={shareSlack}>Slack</MenuItem>
      <MenuItem onclick={copyLink}>Copy Link</MenuItem>
    {/snippet}
  </MenuItem>
  <MenuItem badge={3}>Notifications</MenuItem>
  <MenuItem badge="New">Updates</MenuItem>
</Menu>

<!-- Checkbox and radio items -->
<Menu bind:open={viewMenuOpen} trigger={viewRef}>
  <MenuGroup label="Display">
    <MenuCheckboxItem bind:checked={showGrid}>
      Show Grid
    </MenuCheckboxItem>
  </MenuGroup>
  <MenuSeparator />
  <MenuGroup label="View">
    <MenuRadioGroup bind:value={view}>
      <MenuRadioItem value="list">List View</MenuRadioItem>
      <MenuRadioItem value="grid">Grid View</MenuRadioItem>
      <MenuRadioItem value="board">Board View</MenuRadioItem>
    </MenuRadioGroup>
  </MenuGroup>
</Menu>

<!-- Grouped menu -->
<Menu bind:open={groupedOpen} trigger={groupedRef}>
  <MenuGroup label="Actions">
    <MenuItem onclick={edit}>Edit</MenuItem>
    <MenuItem onclick={duplicate}>Duplicate</MenuItem>
  </MenuGroup>
  <MenuSeparator />
  <MenuGroup label="Danger Zone">
    <MenuItem danger onclick={deleteItem}>Delete</MenuItem>
  </MenuGroup>
</Menu>
```
