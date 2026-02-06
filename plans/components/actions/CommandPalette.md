# CommandPalette

**Status**: 🔲 Placeholder
**Category**: Actions
**File**: `packages/components/src/actions/CommandPalette.svelte`

## Description

A keyboard-driven command interface inspired by VS Code, Raycast, and Linear. Allows users to quickly search and execute commands, navigate to pages, or perform actions without touching the mouse. A power-user feature that significantly improves productivity.

## Visual Design

### Container
- Centered modal overlay, positioned in upper third of screen
- Background uses `light-dark()` for automatic theming
- Generous width (600px max) for comfortable reading
- Rounded corners (`--radius-lg`)

### Search Input
- Large, prominent input at top
- No visible border (focus is implicit)
- Placeholder: "Type a command or search..."
- Clear button when text is present
- Subtle search icon

### Results List
- Scrollable list below input
- Maximum 8-10 visible items
- Keyboard-highlighted current selection
- Grouped by category with subtle headers

### Result Item
- Icon on left
- Title as primary text
- Description/path as secondary text (muted)
- Keyboard shortcut on right (if applicable)
- Subtle background on hover/select

### Empty States
- "No results" message when search has no matches
- Recent commands shown when input is empty

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility (bindable) |
| `commands` | `CommandOption[]` | `[]` | Available commands |
| `placeholder` | `string` | `'Type a command...'` | Input placeholder |
| `recentLimit` | `number` | `5` | Number of recent items to show |
| `groupBy` | `'category' \| 'none'` | `'category'` | How to group results |
| `dense` | `boolean` | `false` | Compact result item spacing |
| `comfortable` | `boolean` | `false` | Relaxed result item spacing |
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
  shortcut?: string[];  // e.g., ['Ctrl', 'S']
  keywords?: string[];  // Additional search terms
  onselect: () => void | Promise<void>;
}
```

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + K` | Toggle open (global) |
| `↑` / `↓` | Navigate results |
| `Enter` | Execute selected command |
| `Escape` | Close palette |
| `Tab` | Move to next group |

## Features to Implement

### Fuzzy Search
- Match against title, description, and keywords
- Highlight matching characters in results
- Smart ranking (exact matches first)

### Recent Commands
- Track recently used commands
- Show when input is empty
- Persist across sessions (localStorage)

### Categories
- Group commands logically
- Collapsible category headers
- Jump to category with Tab

### Nested Commands
- Support command → subcommand flow
- Breadcrumb navigation
- Back button/Escape to go up

### Loading States
- Support async command execution
- Show spinner while executing
- Success/error feedback

## Delightful Details

### Instant Feel
- Opens immediately with smooth fade
- Search is instant (no debounce for local data)
- Selection highlight follows keyboard instantly

### Smart Defaults
- Most likely command pre-selected
- Recent commands weighted higher
- Frecency-based sorting (frequency + recency)

### Keyboard Shortcut Display
- Show shortcuts in results
- Teach users faster paths
- Consistent shortcut formatting

### Transition Effects
- Content fades/slides as results change
- Smooth height animation for result count changes
- Selected item highlight animates

### Sound Feedback (Optional)
- Subtle tick on selection change
- Satisfying pop on command execution
- Configurable/disable-able

## Accessibility

- Full keyboard navigation
- ARIA combobox pattern
- Screen reader announces results
- Focus management

## Current Implementation

Currently a **placeholder** with only the TypeScript interface defined. Needs full implementation.

## Code Example

```svelte
<script>
  import { CommandPalette } from '@delightstack/components';
  import { goto } from '$app/navigation';

  let paletteOpen = $state(false);

  // Global keyboard shortcut
  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
    }
  }

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

<svelte:window onkeydown={handleKeydown} />

<CommandPalette
  bind:open={paletteOpen}
  {commands}
/>
```

## Implementation Priority

**High priority** - This is a signature feature that power users love and significantly improves app usability.
