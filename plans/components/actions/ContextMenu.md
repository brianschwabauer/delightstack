# ContextMenu

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/ContextMenu.svelte`

## Description

A right-click context menu system that provides contextual actions for any element. Uses a Svelte action for easy attachment and renders menus through the Popover component for consistent positioning and behavior.

## Visual Design

### Menu Container
- Clean white/dark background
- Subtle shadow for elevation
- Rounded corners matching system
- Compact padding

### Menu Items
- Uses List/ListItem components
- Clear hover states
- Icon support
- Keyboard shortcuts displayed right-aligned
- Disabled state styling

### Positioning
- Opens at cursor position
- Flips/shifts to stay in viewport
- Smooth appearance animation

## API

### Svelte Action Usage

```svelte
<script>
  import { contextMenu } from '@delightstack/components';
</script>

<div use:contextMenu={menuOptions}>
  Right-click me
</div>
```

### Menu Options Interface

```typescript
interface ContextMenuOptions {
  items: ContextMenuItem[];
  onopen?: () => void;
  onclose?: () => void;
}

interface ContextMenuItem {
  label: string;
  icon?: Component;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onclick?: () => void;
  children?: ContextMenuItem[]; // Submenu
}
```

## Features

### Menu Items
- Text label
- Optional leading icon
- Optional keyboard shortcut hint
- Click handler
- Disabled state
- Separator lines

### Submenus
- Nested menus on hover
- Arrow indicator
- Positioned to the side
- Accessible via keyboard

### Context Tracking
- WeakMap-based context association
- Proper cleanup on element removal
- Multiple menus on same page supported

## Delightful Details

### Cursor Positioning
- Menu opens exactly at click position
- Slight offset to not cover cursor
- Smart edge detection

### Quick Actions
- Single click to execute
- Menu closes after action
- Keyboard navigation with arrows

### Smooth Reveal
- Subtle fade + scale animation
- Fast enough to feel instant
- Not so fast it feels jarring

### Scroll Handling
- Closes on scroll (configurable)
- Prevents scroll-behind on mobile

## Accessibility

- Full keyboard navigation
- Arrow keys to move between items
- Enter/Space to select
- Escape to close
- Proper ARIA roles

## Current Implementation

The current implementation is **complete** with:
- Svelte action for attachment
- WeakMap context management
- Popover-based rendering
- List/ListItem integration
- Click and scroll handling
- Position at cursor

## Code Example

```svelte
<script>
  import { contextMenu } from '@delightstack/components';
  import EditIcon from '~icons/mdi/pencil';
  import CopyIcon from '~icons/mdi/content-copy';
  import DeleteIcon from '~icons/mdi/delete';

  const fileMenuOptions = {
    items: [
      {
        label: 'Edit',
        icon: EditIcon,
        shortcut: 'E',
        onclick: () => editFile()
      },
      {
        label: 'Copy',
        icon: CopyIcon,
        shortcut: 'Ctrl+C',
        onclick: () => copyFile()
      },
      { separator: true },
      {
        label: 'Delete',
        icon: DeleteIcon,
        onclick: () => deleteFile(),
        // Visual indication this is destructive
        class: 'destructive'
      }
    ]
  };
</script>

<div class="file-item" use:contextMenu={fileMenuOptions}>
  <span>document.pdf</span>
</div>
```

### With Submenus
```svelte
const menuOptions = {
  items: [
    { label: 'Cut', shortcut: 'Ctrl+X' },
    { label: 'Copy', shortcut: 'Ctrl+C' },
    { label: 'Paste', shortcut: 'Ctrl+V' },
    { separator: true },
    {
      label: 'Share',
      children: [
        { label: 'Email' },
        { label: 'Slack' },
        { label: 'Copy Link' }
      ]
    }
  ]
};
```

## Browser Context Menu

The native browser context menu is automatically prevented when using the action. If you need to allow the native menu in certain conditions:

```svelte
<div use:contextMenu={{
  items: [...],
  allowNative: (e) => e.shiftKey // Shift+right-click shows native menu
}}>
```
