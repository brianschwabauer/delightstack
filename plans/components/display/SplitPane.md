# SplitPane

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/SplitPane.svelte`

## Description

A resizable split view container that divides space between two panes. Users drag a divider to resize panes, with support for keyboard accessibility, snap points, minimum/maximum sizes, and collapsible panes. Common in IDE-style interfaces, comparison views, and master-detail layouts.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Container
- Fills available space
- Two adjacent panes separated by a divider
- Visible or subtle divider between panes

### Divider
- Thin line between panes (2-4px)
- Grab handle visible on hover
- Hover: slightly thicker or highlighted with accent color
- Active (dragging): accent color, cursor changes

### Resize Behavior
- Smooth real-time resizing during drag
- Respects `minSize` and `maxSize` constraints
- Cursor changes to `col-resize` (horizontal) or `row-resize` (vertical)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `vertical` | `boolean` | `false` | Vertical split (panes stacked top/bottom) instead of horizontal |
| `size` | `number` | `50` | Initial first-pane size as percentage, bindable |
| `minSize` | `number` | `10` | Minimum first-pane size (%) |
| `maxSize` | `number` | `90` | Maximum first-pane size (%) |
| `snap` | `number[]` | `[]` | Snap points as percentages |
| `snapThreshold` | `number` | `3` | Distance in % to trigger snap |
| `collapsible` | `boolean` | `false` | Allow collapsing panes |
| `collapsed` | `'first' \| 'second' \| null` | `null` | Which pane is collapsed, bindable |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `first` | `Snippet` | - | First pane content |
| `second` | `Snippet` | - | Second pane content |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onresize` | `{ size: number }` | Pane size changed |
| `oncollapse` | `{ pane: 'first' \| 'second' \| null }` | Pane collapsed or expanded |

## Keyboard Accessibility

The resize handle is focusable (`tabindex="0"`) with the following keyboard controls:

| Key | Action |
|-----|--------|
| **Arrow Left / Arrow Up** | Decrease first pane size by 1% |
| **Arrow Right / Arrow Down** | Increase first pane size by 1% |
| **Shift+Arrow** | Adjust by 5% |
| **Home** | Set to `minSize` |
| **End** | Set to `maxSize` |
| **Enter** | Toggle collapse of the smaller pane (when `collapsible`) |

## Snap Points

```svelte
<SplitPane snap={[25, 50, 75]}>
```

- Divider snaps to specified percentage positions during drag
- Small magnetic resistance at snap points (within `snapThreshold` %)
- Subtle visual feedback (brief haptic-like resistance) when snapping
- Arrow key navigation skips to the nearest snap point when Shift is held

## Collapsible Panes

When `collapsible` is true:
- Double-click the divider to collapse the smaller pane to 0
- A small expand button appears on the collapsed edge
- Click the expand button or double-click the divider to restore
- Smooth animation for collapse/expand transitions
- Collapse state is bindable via `collapsed` prop

## Nested Splits

```svelte
<SplitPane>
  {#snippet first()}
    <SplitPane vertical>
      {#snippet first()}<CodeEditor />{/snippet}
      {#snippet second()}<Terminal />{/snippet}
    </SplitPane>
  {/snippet}
  {#snippet second()}
    <Preview />
  {/snippet}
</SplitPane>
```

## Accessibility

- Divider has `role="separator"` with `aria-orientation`
- `aria-valuenow`, `aria-valuemin`, `aria-valuemax` reflect current size
- `aria-label="Resize panes"` on the divider
- Full keyboard control (arrows, Home, End)
- Focus indicator visible on the divider

## CSS Approach

```css
.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.split-pane.vertical {
  flex-direction: column;
}

.split-pane .pane {
  overflow: auto;
  flex-shrink: 0;
}

.split-pane .divider {
  flex-shrink: 0;
  width: 4px;
  background: light-dark(var(--color-border), var(--color-border));
  cursor: col-resize;
  position: relative;
  z-index: 1;
  transition: background-color 150ms;
}

.split-pane.vertical .divider {
  width: auto;
  height: 4px;
  cursor: row-resize;
}

.split-pane .divider:hover,
.split-pane .divider:active {
  background: var(--color-action);
}

.split-pane .divider:focus-visible {
  outline: 2px solid var(--color-action);
  outline-offset: -2px;
}

.split-pane .pane.collapsed {
  flex-basis: 0 !important;
  overflow: hidden;
}

.split-pane .expand-button {
  position: absolute;
  z-index: 2;
}
```

## Code Example

```svelte
<script>
  import { SplitPane } from '@delightstack/components';

  let sidebarSize = $state(25);
</script>

<!-- Horizontal split (sidebar + main) -->
<SplitPane
  bind:size={sidebarSize}
  minSize={15}
  maxSize={40}
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
<SplitPane vertical size={70}>
  {#snippet first()}
    <CodeEditor />
  {/snippet}

  {#snippet second()}
    <Terminal />
  {/snippet}
</SplitPane>

<!-- Nested three-pane layout -->
<SplitPane size={20} collapsible>
  {#snippet first()}
    <FileTree />
  {/snippet}

  {#snippet second()}
    <SplitPane vertical size={70}>
      {#snippet first()}
        <Editor />
      {/snippet}
      {#snippet second()}
        <Output />
      {/snippet}
    </SplitPane>
  {/snippet}
</SplitPane>
```

## Implementation Notes

- Use CSS flexbox for layout with `flex-basis` controlled by the `size` prop
- Track pointer events on the document (not just the divider) during drag for smooth operation
- Debounce or throttle the `onresize` event for performance
- Persist size preference via localStorage (optional, consumer responsibility)
- Handle window resize gracefully (maintain percentage-based sizing)
- Touch support: large enough touch target on the divider (expand hit area beyond visual width)
- `touch-action: none` on the divider to prevent scroll interference
