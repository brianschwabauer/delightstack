# SplitPane

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/SplitPane.svelte`

## Description

A resizable split view container that divides space between two panes. Users can drag the divider to resize. Common in IDE-style interfaces, comparison views, or master-detail layouts.

## Visual Design

### Container
- Full available space
- Two adjacent panes
- Visible or subtle divider

### Divider
- Thin line between panes (2-4px)
- Grab handle for interaction
- Hover: slightly thicker or highlighted
- Active: accent color

### Resize Behavior
- Smooth real-time resizing
- Respects min/max constraints
- Cursor changes on hover

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Split direction |
| `size` | `number` | `50` | Initial size (%, bindable) |
| `min` | `number` | `10` | Minimum pane size (%) |
| `max` | `number` | `90` | Maximum pane size (%) |
| `snap` | `number[]` | `[]` | Snap points (%) |
| `collapsible` | `boolean` | `false` | Allow collapsing panes |
| `collapsed` | `'first' \| 'second' \| null` | `null` | Collapsed state |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onresize` | `{ size }` | Size changed |
| `oncollapse` | `{ pane }` | Pane collapsed |

## Content

```svelte
<SplitPane>
  {#snippet first()}
    <Sidebar />
  {/snippet}

  {#snippet second()}
    <MainContent />
  {/snippet}
</SplitPane>
```

## Features

### Snap Points
```svelte
<SplitPane snap={[25, 50, 75]}>
```
- Divider snaps to specified positions
- Helps users find common layouts
- Small resistance at snap points

### Collapsible
```svelte
<SplitPane collapsible bind:collapsed>
```
- Double-click divider to collapse
- Click again to restore
- Smooth collapse animation

### Nested Splits
```svelte
<SplitPane direction="horizontal">
  {#snippet first()}
    <SplitPane direction="vertical">
      <!-- ... -->
    </SplitPane>
  {/snippet}
  <!-- ... -->
</SplitPane>
```

## Delightful Details

### Smooth Resizing
- CSS transitions for smooth feel
- No janky reflows
- Content overflow handled

### Snap Feedback
- Subtle haptic-like visual feedback
- Divider "settles" at snap points
- Magnetic feel

### Keyboard Support
- Focus divider with Tab
- Arrow keys for fine adjustment
- Home/End for min/max

### Collapse Animation
- Smooth width/height transition
- Content fades as it collapses
- Expand button appears

### Touch Support
- Large enough touch target
- Gesture-friendly dragging
- Works on tablets

## Accessibility

- Divider is focusable
- Keyboard resize controls
- ARIA splitter role
- Size announced to screen readers

## Code Example

```svelte
<script>
  import { SplitPane } from '@delightstack/components';

  let sidebarSize = $state(25);
</script>

<!-- Horizontal split (sidebar + main) -->
<SplitPane
  bind:size={sidebarSize}
  min={15}
  max={40}
  snap={[25, 33]}
  collapsible
>
  {#snippet first()}
    <nav class="sidebar">
      <!-- Sidebar content -->
    </nav>
  {/snippet}

  {#snippet second()}
    <main class="content">
      <!-- Main content -->
    </main>
  {/snippet}
</SplitPane>

<!-- Vertical split -->
<SplitPane direction="vertical" size={70}>
  {#snippet first()}
    <CodeEditor />
  {/snippet}

  {#snippet second()}
    <Terminal />
  {/snippet}
</SplitPane>
```

## Implementation Notes

- Use CSS flexbox or grid for layout
- Track mouse/touch position for resize
- Debounce resize events for performance
- Persist size preference (localStorage)
- Handle window resize gracefully
