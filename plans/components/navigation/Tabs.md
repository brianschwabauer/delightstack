# Tabs

**Category**: Navigation
**File**: `packages/components/src/navigation/Tabs.svelte`

## Description

A tabbed navigation component for switching between different views or content sections. Features a sliding indicator animation, multiple visual styles via boolean variant props, closable/addable/draggable tabs, optional URL segment integration, and context-based communication between the Tabs container and individual Tab items.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- `focusTrap` for keyboard containment within overflow menus
- **Libraries**: none

## Visual Design

### Default (Underline)
- Tabs in a horizontal row
- Active tab has a colored underline indicator
- Indicator is an absolutely-positioned element that slides between tabs
- Indicator width and position are measured from the active tab's DOM rect and animated with CSS transitions

### Pills (`pills`)
- Each tab is a pill-shaped button
- Active tab has a filled background
- Inactive tabs are transparent with subtle hover highlight

### Boxed (`boxed`)
- Tabs sit within a bordered container with a shared background
- Active tab has a contrasting background fill
- Creates a contained, card-like appearance

### Segment (`segment`)
- Connected buttons with no gaps, similar to iOS/macOS segmented controls
- Sliding highlight element behind the active tab
- Rounded outer container with flat inner edges

### States
- **Default**: Normal text color, no indicator
- **Active**: Accent color, indicator visible
- **Hover**: Subtle background fill
- **Disabled**: Reduced opacity, `cursor: not-allowed`
- **Focus**: Visible focus ring (keyboard only)

## Props

### Tabs Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Active tab value (`$bindable()`) |
| `pills` | `boolean` | `false` | Pill-shaped button style |
| `boxed` | `boolean` | `false` | Bordered container style |
| `segment` | `boolean` | `false` | iOS-style segmented control |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Tab layout direction |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Tab size |
| `fullWidth` | `boolean` | `false` | Stretch tabs to fill container width |
| `disabled` | `boolean` | `false` | Disable all tabs |
| `closable` | `boolean` | `false` | Show close button on each tab |
| `addable` | `boolean` | `false` | Show "+" button at the end of the tab list |
| `draggable` | `boolean` | `false` | Allow drag-to-reorder tabs |
| `overflow` | `'scroll' \| 'dropdown'` | `'scroll'` | How to handle tab overflow |
| `urlSegment` | `string` | - | URL path segment to sync with (e.g. `'tab'` syncs `?tab=value`) |
| `skeleton` | `boolean` | `false` | Show loading skeleton placeholders |
| `skeletonCount` | `number` | `3` | Number of skeleton tabs to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Tab children |
| `onchange` | `(detail: { value: string }) => void` | - | Fires when the active tab changes |
| `onclose` | `(detail: { value: string }) => void` | - | Fires when a tab's close button is clicked |
| `onadd` | `() => void` | - | Fires when the "+" add button is clicked |
| `onreorder` | `(detail: { order: string[] }) => void` | - | Fires when tabs are reordered via drag |

### Tab Item

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Unique tab identifier |
| `label` | `string` | - | Tab label text |
| `icon` | `Component` | - | Icon component displayed in the tab |
| `disabled` | `boolean` | `false` | Disable this individual tab |
| `badge` | `string \| number` | - | Badge indicator (notification count or text) |
| `skeleton` | `boolean` | `false` | Show skeleton for this tab specifically |
| `children` | `Snippet` | - | Custom tab label content |

### TabContent

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Matches the corresponding Tab's `value` |
| `lazy` | `boolean` | `false` | Only mount content when the tab is first activated |
| `keepAlive` | `boolean` | `false` | When `lazy`, keep content in DOM after first render |
| `children` | `Snippet` | - | Panel content |

## Sliding Indicator Animation

The indicator is an absolutely-positioned `<div>` within the tab list. On mount and whenever `value` changes:

1. Query the active tab element via `document.querySelector` using the `value` data attribute.
2. Read `offsetLeft`, `offsetTop`, `offsetWidth`, and `offsetHeight` from the active tab element.
3. Apply `transform: translateX(left)` and `width` (horizontal) or `translateY(top)` and `height` (vertical) to the indicator.
4. CSS `transition` on `transform` and `width`/`height` provides smooth animation between tabs.

For the `segment` variant, the indicator is a filled background element. For the default underline style, it is a thin bar at the bottom (horizontal) or left edge (vertical).

## URL Segment Integration

When `urlSegment` is set, the component syncs its `value` with a URL search parameter:

- On mount, read the parameter from `$page.url.searchParams` and set `value`.
- On tab change, update the URL using `goto()` with `replaceState: true` and `noScroll: true`.
- This makes tabs bookmarkable without full page navigation.

## Context API

Tabs uses `setContext` to provide state to child Tab components:

```typescript
interface TabsContext {
  value: string;
  pills: boolean;
  boxed: boolean;
  segment: boolean;
  size: string;
  disabled: boolean;
  closable: boolean;
  draggable: boolean;
  register: (tabValue: string, element: HTMLElement) => void;
  unregister: (tabValue: string) => void;
  select: (tabValue: string) => void;
  close: (tabValue: string) => void;
}
```

Each Tab calls `getContext` on mount to register itself and receive shared state. This allows the indicator to track tab positions and the container to manage selection.

## Closable, Addable, Draggable Tabs

### Closable
- When `closable` is true, each tab renders a small "X" button at the trailing edge.
- Clicking the close button fires `onclose` with the tab's `value`.
- The close button has `stopPropagation` to prevent selecting the tab.

### Addable
- When `addable` is true, a "+" button appears after the last tab.
- Clicking fires the `onadd` callback.
- Styled to match the current variant at reduced emphasis.

### Draggable
- When `draggable` is true, tabs can be reordered via drag and drop.
- Uses the native HTML Drag and Drop API (`draggable`, `ondragstart`, `ondragover`, `ondrop`).
- A visual indicator shows the drop position during drag.
- On drop, fires `onreorder` with the new order of tab values.

## Overflow Handling

When tabs exceed the container width:
- **`scroll`**: Horizontal scroll with arrow navigation buttons at the edges. Scroll snapping aligns to tab boundaries.
- **`dropdown`**: Overflowing tabs collapse into a dropdown menu accessible via a "more" button.

## Delightful Details

### Indicator Animation
- Underline/highlight slides between tabs using CSS `transition` on `transform` and `width`
- Width dynamically matches the target tab
- Spring-like easing (`cubic-bezier(0.4, 0, 0.2, 1)`)

### Content Transition
- Fade between panels on tab switch
- Optional slide direction based on which tab is selected relative to the previous

### Keyboard Navigation
- Arrow keys move focus between tabs
- Home/End jump to first/last tab
- Enter/Space activates the focused tab
- Delete closes the focused tab when `closable` is true

### Focus Indicator
- Clear focus ring for keyboard users
- Hidden for mouse/pointer users via `:focus-visible`

## Accessibility

- `role="tablist"` on the Tabs container
- `role="tab"` on each Tab with `aria-selected` state
- `role="tabpanel"` on each TabContent
- `aria-controls` linking tabs to panels
- `aria-labelledby` linking panels back to tabs
- `aria-disabled` on disabled tabs
- Full keyboard navigation per WAI-ARIA Tabs pattern

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder tabs as shimmering bars matching the tab dimensions for the current variant and size. No indicator is shown.

## CSS Approach

```css
.tabs {
  display: flex;
  position: relative;
  gap: 0;
  border-bottom: 1px solid light-dark(var(--color-border), var(--color-border));
}

.tabs.vertical {
  flex-direction: column;
  border-bottom: none;
  border-right: 1px solid light-dark(var(--color-border), var(--color-border));
}

.tabs.pills {
  border-bottom: none;
  gap: 0.25rem;
}

.tabs.boxed {
  background: light-dark(var(--color-surface-1), var(--color-surface-1));
  border: 1px solid light-dark(var(--color-border), var(--color-border));
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.tabs.segment {
  background: light-dark(var(--color-surface-2), var(--color-surface-2));
  border-radius: var(--radius-md);
  padding: 0.25rem;
  border-bottom: none;
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--duration-fast) var(--ease-default),
    background var(--duration-fast) var(--ease-default);
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  height: 2px;
  background: var(--color-action);
  transition:
    transform var(--duration-normal) cubic-bezier(0.4, 0, 0.2, 1),
    width var(--duration-normal) cubic-bezier(0.4, 0, 0.2, 1);
}
```

## Code Example

```svelte
<script>
  import { Tabs, Tab, TabContent } from '@delightstack/components';

  let activeTab = $state('overview');
</script>

<!-- Default underline tabs -->
<Tabs bind:value={activeTab}>
  <Tab value="overview">Overview</Tab>
  <Tab value="analytics" badge={5}>Analytics</Tab>
  <Tab value="reports">Reports</Tab>
</Tabs>

<TabContent value="overview">
  <OverviewPanel />
</TabContent>
<TabContent value="analytics">
  <AnalyticsPanel />
</TabContent>
<TabContent value="reports">
  <ReportsPanel />
</TabContent>

<!-- Pill variant for view switching -->
<Tabs pills bind:value={view}>
  <Tab value="grid" icon={GridIcon} />
  <Tab value="list" icon={ListIcon} />
</Tabs>

<!-- Segment control -->
<Tabs segment bind:value={period}>
  <Tab value="day">Day</Tab>
  <Tab value="week">Week</Tab>
  <Tab value="month">Month</Tab>
</Tabs>

<!-- Closable and addable tabs -->
<Tabs
  bind:value={activeDoc}
  closable
  addable
  draggable
  onclose={({ value }) => removeTab(value)}
  onadd={addNewTab}
  onreorder={({ order }) => tabOrder = order}
>
  {#each tabs as tab}
    <Tab value={tab.id}>{tab.name}</Tab>
  {/each}
</Tabs>

<!-- URL-synced tabs -->
<Tabs bind:value={activeTab} urlSegment="tab">
  <Tab value="general">General</Tab>
  <Tab value="security">Security</Tab>
  <Tab value="billing">Billing</Tab>
</Tabs>

<!-- Skeleton loading -->
<Tabs skeleton skeletonCount={4} />
```
