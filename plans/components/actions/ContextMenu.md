# ContextMenu

**Category**: Actions
**File**: `packages/components/src/actions/ContextMenu.svelte`

## Description

A right-click context menu system that provides contextual actions for any element. Uses the `{@attach contextMenu()}` Svelte action API for easy attachment and renders menus through the Popover component for consistent positioning and behavior. Context data is tracked via WeakMap for clean, garbage-collectible associations.

## Dependencies

- **Popover** -- used internally for positioning and rendering the menu
- **List** / **ListItem** -- renders menu items
- **Portal** -- DOM placement (used internally by Popover)
- **`@delightstack/utilities`**:
  - `focusTrap` -- inherited from Popover

## Visual Design

### Menu Container
- Clean background using `light-dark()`
- Subtle shadow for elevation (`--shadow-md`)
- Rounded corners (`--radius-md`)
- Compact padding
- Border: `1px solid var(--border-elevated-2)`

### Menu Items
- Rendered using List / ListItem components
- Clear hover states with `--color-overlay-hover`
- Leading icon support
- Keyboard shortcuts displayed right-aligned in muted text
- Disabled items styled with reduced opacity

### Positioning
- Opens at exact cursor position
- Uses Floating UI (via Popover) to flip/shift and stay in viewport
- Smooth appearance animation (fade + scale, `150ms`)

## API

### Svelte Action Usage

```svelte
<script>
  import { contextMenu } from '@delightstack/components';
</script>

<div {@attach contextMenu(menuOptions)}>
  Right-click me
</div>
```

### ContextMenuOptions Interface

```typescript
interface ContextMenuOptions {
  items: ContextMenuItem[];
  dense?: boolean;
  onopen?: () => void;
  onclose?: () => void;
  allowNative?: (e: MouseEvent) => boolean;  // Return true to show browser menu instead
}

interface ContextMenuItem {
  label: string;
  icon?: Component;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  class?: string;                           // e.g. 'destructive' for red styling
  onclick?: () => void | Promise<void>;     // Promise-aware handler
  children?: ContextMenuItem[];             // Submenu items
}
```

## Features

### Menu Items
- Text label
- Optional leading icon
- Optional keyboard shortcut hint (right-aligned)
- Click handler (promise-aware -- shows spinner on the item while executing)
- Disabled state
- Separator lines between groups
- Custom class support (e.g. `'destructive'` for red text)

### Submenus
- Nested menus via `children` array
- Arrow indicator on parent item
- Opens to the side on hover or keyboard right-arrow
- Accessible via keyboard (Right arrow opens, Left arrow closes)

### Context Tracking with WeakMap
- Each element's menu options stored in a `WeakMap<HTMLElement, ContextMenuOptions>`
- Automatically garbage-collected when the element is removed from the DOM
- Multiple independent context menus on the same page
- Clean, no memory leaks

### Promise-Aware Item Handlers
When an item's `onclick` returns a Promise, a small spinner appears on that item. The menu stays open until the promise resolves, then closes.

## Delightful Details

### Cursor Positioning
- Menu opens exactly at the right-click position
- Slight offset (`4px`) to not cover the cursor
- Smart edge detection via Floating UI keeps the menu fully in viewport

### Quick Actions
- Single click to execute an item
- Menu closes after action completes
- Keyboard navigation with arrow keys

### Smooth Reveal
- Subtle fade + scale animation (`150ms`)
- Fast enough to feel instant, slow enough to register visually

### Scroll Handling
- Closes on scroll (configurable)
- Prevents scroll-behind on mobile

## Accessibility

- Full keyboard navigation (Arrow Up/Down to move, Enter/Space to select)
- `role="menu"` on the container
- `role="menuitem"` on each item
- `aria-disabled` for disabled items
- Escape to close
- Submenu: Right arrow opens, Left arrow closes

## Code Example

### Basic Context Menu

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
        onclick: async () => {
          await api.deleteFile(fileId);
        },
        class: 'destructive'
      }
    ]
  };
</script>

<div class="file-item" {@attach contextMenu(fileMenuOptions)}>
  <span>document.pdf</span>
</div>
```

### With Submenus

```svelte
<script>
  import { contextMenu } from '@delightstack/components';

  const menuOptions = {
    items: [
      { label: 'Cut', shortcut: 'Ctrl+X', onclick: () => cut() },
      { label: 'Copy', shortcut: 'Ctrl+C', onclick: () => copy() },
      { label: 'Paste', shortcut: 'Ctrl+V', onclick: () => paste() },
      { separator: true },
      {
        label: 'Share',
        children: [
          { label: 'Email', onclick: () => shareViaEmail() },
          { label: 'Slack', onclick: () => shareViaSlack() },
          { label: 'Copy Link', onclick: () => copyLink() }
        ]
      }
    ]
  };
</script>

<div {@attach contextMenu(menuOptions)}>
  Right-click for options
</div>
```

### Conditional Native Menu

Allow the native browser context menu in certain conditions (e.g. Shift+right-click):

```svelte
<div {@attach contextMenu({
  items: [...],
  allowNative: (e) => e.shiftKey
})}>
  Right-click for custom menu, Shift+right-click for native
</div>
```

## CSS Approach

```css
.context-menu {
  min-width: 180px;
  padding: 0.25rem 0;
  background: var(--color-surface-2);
  border: 1px solid var(--border-elevated-2);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: var(--text-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default);

  &:hover {
    background: var(--color-overlay-hover);
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.destructive {
    color: var(--color-error);
  }
}

.context-menu-shortcut {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.context-menu-separator {
  height: 1px;
  margin: 0.25rem 0;
  background: var(--color-border);
}

.context-menu-submenu-arrow {
  margin-left: auto;
  color: var(--color-text-muted);
}
```
