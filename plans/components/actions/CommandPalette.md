# CommandPalette

**Category**: Actions
**File**: `packages/components/src/actions/CommandPalette.svelte`

## Description

A keyboard-driven command interface inspired by VS Code, Raycast, and Linear. Allows users to quickly search and execute commands, navigate to pages, or perform actions without touching the mouse. Uses [orama.js](https://orama.com/) for fast, typo-tolerant fuzzy search with smart ranking.

## Dependencies

- **Modal** -- overlay container and backdrop
- **Portal** -- DOM placement (used internally by Modal)
- **List** / **ListItem** -- rendering search results
- **`@delightstack/utilities`**:
  - `focusTrap` -- focus trapped within the palette while open
- **External**:
  - [`@orama/orama`](https://orama.com/) -- fuzzy search engine for indexing and querying commands

## Visual Design

### Container
- Rendered inside a Modal, positioned in the upper third of the viewport
- Background uses `light-dark()` for automatic theming
- Generous width (`600px` max) for comfortable reading
- Rounded corners (`--radius-lg`)
- Soft shadow (`--shadow-xl`)

### Search Input
- Large, prominent input at top
- No visible border (focus is implicit since the input is always focused)
- Placeholder: `"Type a command or search..."`
- Clear button appears when text is present
- Subtle search icon on the left

### Results List
- Rendered using List / ListItem components
- Scrollable, maximum 8 visible items
- Keyboard-highlighted current selection
- Grouped by category with subtle headers

### Result Item
- Icon on left
- Title as primary text
- Description / path as secondary text (muted color)
- Keyboard shortcut badge on right (if applicable)
- Highlighted matching characters in the title

### Empty States
- When input is empty: show recent commands
- When search returns no matches: `"No results found"` message

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (`$bindable()`) |
| `commands` | `CommandOption[]` | `[]` | Available commands to search |
| `placeholder` | `string` | `'Type a command or search...'` | Input placeholder text |
| `recentLimit` | `number` | `5` | Number of recent items to show when input is empty |
| `groupBy` | `'category' \| 'none'` | `'category'` | How to group results |
| `dense` | `boolean` | `false` | Compact result item spacing |
| `onselect` | `(command: CommandOption) => void` | - | Called when any command is selected |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### CommandOption Interface

```typescript
interface CommandOption {
  id: string;
  title: string;
  description?: string;
  category?: string;
  icon?: Component;
  shortcut?: string[];        // e.g. ['Ctrl', 'S']
  keywords?: string[];        // additional search terms
  disabled?: boolean;
  onselect: () => void | Promise<void>;
}
```

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + K` | Toggle open (global shortcut) |
| `Arrow Up` / `Arrow Down` | Navigate results |
| `Enter` | Execute selected command |
| `Escape` | Close palette |
| `Tab` | Jump to next category group |
| `Backspace` (when input empty, in subcommand) | Go back to parent |

## Fuzzy Search with Orama

Commands are indexed into an Orama database on mount. The schema indexes `title`, `description`, `keywords`, and `category`. Searching is instant with no debounce for local data.

```typescript
import { create, insert, search } from '@orama/orama';

const db = await create({
  schema: {
    title: 'string',
    description: 'string',
    keywords: 'string[]',
    category: 'string'
  }
});

// Index all commands on mount
for (const cmd of commands) {
  await insert(db, {
    title: cmd.title,
    description: cmd.description ?? '',
    keywords: cmd.keywords ?? [],
    category: cmd.category ?? ''
  });
}

// Search with typo tolerance
const results = await search(db, {
  term: query,
  tolerance: 1,
  boost: { title: 2 }
});
```

Orama provides typo-tolerant matching, BM25 ranking, and highlighted match positions out of the box.

## Features

### Recent Commands
- Track recently used commands (stored in localStorage under `delightstack:command-palette:recent`)
- Shown when input is empty, sorted by recency
- Maximum count controlled by `recentLimit`
- Frecency-based sorting (frequency + recency) for ranking

### Categories
- Commands grouped by their `category` field
- Subtle section headers between groups
- Tab key jumps between category groups

### Nested Commands
- A command can define `children: CommandOption[]` for a subcommand flow
- Selecting a parent command drills into its children
- Breadcrumb trail shown below the input
- Backspace on empty input goes back to parent level
- Escape at any depth closes the palette entirely

### Promise-Aware Execution
- When `onselect` returns a Promise, a spinner appears next to the selected item
- On success, the palette closes
- On failure, an inline error message is shown briefly

## Delightful Details

### Instant Feel
- Opens immediately with smooth fade via Modal
- Search is instant (Orama queries are sub-millisecond for local data)
- Selection highlight follows keyboard input immediately

### Smart Defaults
- Most likely command pre-selected based on frecency
- Recent commands weighted higher in search results

### Keyboard Shortcut Display
- Shortcuts shown right-aligned in result items using `<kbd>` elements
- Teaches users faster paths to common actions

### Transition Effects
- Content cross-fades as results change
- Smooth height animation for result count changes
- Selected item highlight animates position

### Match Highlighting
- Matching characters highlighted in result titles
- Uses Orama's built-in highlight positions

## Accessibility

- ARIA combobox pattern (`role="combobox"` on input, `role="listbox"` on results)
- `aria-activedescendant` tracks the highlighted result
- Screen reader announces result count changes
- Focus management: input always focused while palette is open

## Code Example

```svelte
<script>
  import { CommandPalette } from '@delightstack/components';
  import { goto } from '$app/navigation';
  import PlusIcon from '~icons/mdi/plus';
  import SettingsIcon from '~icons/mdi/cog';
  import ThemeIcon from '~icons/mdi/brightness-6';

  let paletteOpen = $state(false);

  const commands = [
    {
      id: 'new-project',
      title: 'New Project',
      description: 'Create a new project',
      category: 'Projects',
      icon: PlusIcon,
      shortcut: ['Ctrl', 'N'],
      onselect: () => goto('/projects/new')
    },
    {
      id: 'settings',
      title: 'Settings',
      description: 'Open application settings',
      category: 'Navigation',
      icon: SettingsIcon,
      shortcut: ['Ctrl', ','],
      onselect: () => goto('/settings')
    },
    {
      id: 'theme-toggle',
      title: 'Toggle Theme',
      description: 'Switch between light and dark mode',
      category: 'Preferences',
      icon: ThemeIcon,
      onselect: () => toggleTheme()
    }
  ];
</script>

<svelte:window onkeydown={(e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    paletteOpen = !paletteOpen;
  }
}} />

<CommandPalette
  bind:open={paletteOpen}
  {commands}
/>
```

## CSS Approach

```css
.command-palette {
  width: min(600px, 90vw);
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  border: 1px solid var(--border-elevated-3);
  box-shadow: var(--shadow-xl);
}

.command-palette-input {
  width: 100%;
  padding: 1rem 1rem 1rem 3rem;
  font-size: var(--text-lg);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  outline: none;
}

.command-palette-results {
  max-height: 400px;
  overflow-y: auto;
}

.command-palette-category-header {
  padding: 0.5rem 1rem;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.command-palette-highlight {
  color: var(--color-action);
  font-weight: var(--font-weight-semibold);
}

.command-palette-shortcut kbd {
  display: inline-block;
  padding: 0.125rem 0.375rem;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
```
