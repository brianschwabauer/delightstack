# Tabs

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Tabs.svelte`

## Description

A tabbed navigation component for switching between different views or content sections. Supports various visual styles and both controlled and uncontrolled modes.

## Visual Design

### Variants

| Variant | Description |
|---------|-------------|
| `default` | Underline indicator |
| `pills` | Pill-shaped buttons |
| `boxed` | Bordered container |
| `segment` | iOS-style segmented control |

### Default (Underline)
- Tabs in a row
- Active tab has underline
- Underline animates between tabs

### Pills
- Each tab is a pill button
- Active is filled
- Others are ghost/outline

### Boxed
- Tabs within bordered container
- Background changes on active
- Cleaner separation

### Segment
- Connected buttons
- Sliding highlight
- iOS/macOS style

## Props

### Tabs Container
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Active tab value (bindable) |
| `variant` | `Variant` | `'default'` | Visual style |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Tab layout direction |
| `fullWidth` | `boolean` | `false` | Stretch to container |
| `disabled` | `boolean` | `false` | Disable all tabs |
| `closable` | `boolean` | `false` | Show close button on tabs |
| `addable` | `boolean` | `false` | Show "+" button to add new tabs |
| `draggable` | `boolean` | `false` | Allow drag to reorder tabs |
| `overflow` | `'scroll' \| 'dropdown'` | `'scroll'` | Handle overflow tabs |
| `dense` | `boolean` | `false` | Compact tab padding |
| `comfortable` | `boolean` | `false` | Relaxed tab padding |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Tab Item
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Tab identifier |
| `label` | `string` | - | Tab label |
| `icon` | `Component` | - | Tab icon |
| `disabled` | `boolean` | `false` | Disable this tab |
| `badge` | `string \| number` | - | Badge indicator |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Tab changed |

## Structure

```svelte
<Tabs bind:value={activeTab}>
  <Tab value="overview" label="Overview" />
  <Tab value="activity" label="Activity" badge={5} />
  <Tab value="settings" label="Settings" icon={SettingsIcon} />
</Tabs>

<TabContent value="overview" current={activeTab}>
  <OverviewPanel />
</TabContent>
<TabContent value="activity" current={activeTab}>
  <ActivityPanel />
</TabContent>
<TabContent value="settings" current={activeTab}>
  <SettingsPanel />
</TabContent>
```

## Features

### Icons
```svelte
<Tab value="home" icon={HomeIcon} label="Home" />
<Tab value="home" icon={HomeIcon} />  <!-- Icon only -->
```

### Badges
```svelte
<Tab value="messages" label="Messages" badge={3} />
```
- Notification count
- New indicator

### Disabled Tabs
```svelte
<Tab value="premium" label="Premium" disabled />
```
- Visual indication
- Not clickable
- Tooltip option

### Scrollable (Many Tabs)
```svelte
<Tabs scrollable>
  <!-- Many tabs -->
</Tabs>
```
- Horizontal scroll
- Arrows for navigation
- Scroll snapping

### Lazy Loading
```svelte
<TabContent value="heavy" lazy current={activeTab}>
  <HeavyComponent />
</TabContent>
```
- Only render when active
- Or: render once, keep in DOM

## Delightful Details

### Indicator Animation
- Underline slides between tabs
- Width matches tab
- Smooth spring animation

### Content Transition
- Fade between panels
- Optional slide direction
- Smooth handoff

### Keyboard Navigation
- Arrow keys move between tabs
- Home/End for first/last
- Enter/Space to select

### Focus Indicator
- Clear focus ring
- Keyboard users see it
- Mouse users don't

### Ripple Effect
- On tab click
- Subtle feedback

## Accessibility

- `role="tablist"` and `role="tab"`
- `aria-selected` state
- `aria-controls` linking
- Keyboard navigation
- Focus management

## Code Example

```svelte
<script>
  import { Tabs, Tab, TabContent } from '@delightstack/components';

  let activeTab = $state('overview');
</script>

<!-- Basic tabs -->
<Tabs bind:value={activeTab}>
  <Tab value="overview">Overview</Tab>
  <Tab value="analytics">Analytics</Tab>
  <Tab value="reports">Reports</Tab>
</Tabs>

{#if activeTab === 'overview'}
  <OverviewContent />
{:else if activeTab === 'analytics'}
  <AnalyticsContent />
{:else}
  <ReportsContent />
{/if}

<!-- Pill variant -->
<Tabs variant="pills" bind:value={view}>
  <Tab value="grid" icon={GridIcon} />
  <Tab value="list" icon={ListIcon} />
</Tabs>

<!-- Segment control -->
<Tabs variant="segment" bind:value={period}>
  <Tab value="day">Day</Tab>
  <Tab value="week">Week</Tab>
  <Tab value="month">Month</Tab>
</Tabs>

<!-- Full width with badges -->
<Tabs fullWidth bind:value={section}>
  <Tab value="inbox" badge={12}>Inbox</Tab>
  <Tab value="sent">Sent</Tab>
  <Tab value="drafts" badge="!">Drafts</Tab>
</Tabs>
```

## Implementation Notes

- Use CSS transforms for indicator
- Handle dynamic tab count
- Support router integration
- Consider tab as link option
- URL sync for bookmarkable tabs
