# Timeline

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Timeline.svelte`

## Description

A chronological event display component for vertical or horizontal timelines. Connects events with a visual line and markers indicating status (complete, active, pending). Supports scroll-based entrance animations, horizontal mode with snap-point scrolling, virtual scrolling for long timelines, and on-demand loading.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- `intersectionObserver` (attachment, for scroll-reveal animations)
- **Libraries**: none

## Visual Design

### Vertical Layout (Default)
- Line runs down the left side
- Events branch to the right
- Markers positioned on the line
- Dates/times displayed to the left of markers (optional)
- Optional alternating sides (`alternate` mode)

### Horizontal Layout
- Line runs horizontally with scrollable overflow
- Events positioned above or below the line (alternating)
- Scroll snapping at each event marker
- Navigation arrows for scrolling
- Touch-friendly swipe support

### Markers
- Circular nodes on the line
- Icons or checkmarks inside
- Color indicates status (complete=accent, active=pulse, pending=muted)
- Size consistent across items

### Event Content
- Title text
- Description/body
- Timestamp
- Optional action buttons or custom content

## Props

### Timeline Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `horizontal` | `boolean` | `false` | Horizontal layout instead of vertical |
| `alternate` | `boolean` | `false` | Alternate events left/right (vertical) or top/bottom (horizontal) |
| `pending` | `boolean` | `false` | Show a pending/loading indicator at the end |
| `dense` | `boolean` | `false` | Compact event spacing |
| `comfortable` | `boolean` | `false` | Relaxed event spacing |
| `virtualized` | `boolean` | `false` | Virtual scrolling for long timelines |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `3` | Number of skeleton items |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | TimelineItem children |
| `onloadmore` | `() => void \| Promise<void>` | - | Called when scrolling near the end (for on-demand loading) |

### TimelineItem

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `date` | `Date \| string` | - | Event timestamp |
| `title` | `string` | - | Event title |
| `icon` | `Component` | - | Marker icon |
| `color` | `string` | - | Marker color override |
| `status` | `'complete' \| 'active' \| 'pending'` | - | Event status |
| `children` | `Snippet` | - | Event body content |

## Event States

### Complete
- Solid filled marker with accent color
- Checkmark icon (or custom icon)
- Solid connecting line
- Full opacity content

### Active
- Highlighted marker with pulse animation
- Accent color ring
- Indicates the current/in-progress event
- Full opacity content

### Pending
- Hollow/outline marker
- Dashed connecting line
- Muted text color
- Reduced opacity

## Horizontal Mode

The horizontal timeline is a scrollable container with snap behavior:

```css
.timeline.horizontal {
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
}

.timeline.horizontal .timeline-item {
  scroll-snap-align: center;
  flex-shrink: 0;
}
```

- Events are arranged along a horizontal line
- The container scrolls horizontally with CSS snap points at each event
- Optional navigation arrows (left/right) appear at the container edges
- Touch/swipe scrolling supported natively
- Keyboard: Left/Right arrows scroll between events when focused

## Virtual Scrolling

When `virtualized` is true:
- Only visible timeline items are rendered in the DOM
- Smooth scrolling with overscan
- Handles timelines with thousands of events
- Works in both vertical and horizontal modes

## On-Demand Loading

When `onloadmore` is provided:
- The component detects when the user scrolls near the end of the timeline
- Triggers `onloadmore` to fetch additional events
- Shows a loading indicator during the fetch
- New events are appended to the timeline

## Scroll-Reveal Animation

Each TimelineItem uses `intersectionObserver` from `@delightstack/utilities` to animate in when it scrolls into view:
- Marker pops in with a scale animation
- Content fades in with a slight slide
- Line segment draws progressively
- Staggered timing for smooth cascade effect
- Respects `prefers-reduced-motion`

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder timeline items with:
- Circular shimmer markers on the line
- Shimmering bars for title, date, and description
- Faded line connecting the placeholders

## Accessibility

- Rendered as an ordered list (`<ol>`) for semantic structure
- Dates use `<time>` elements with `datetime` attributes
- Status communicated via `aria-label` on markers (e.g., "Completed: Order Confirmed")
- Keyboard navigable in horizontal mode (arrow keys)
- Focus management for interactive timeline items

## CSS Approach

```css
.timeline {
  position: relative;
  padding-left: 2rem;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 0.75rem;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-border);
}

.timeline-item {
  position: relative;
  padding-bottom: 2rem;
  padding-left: 1.5rem;
}

.timeline-item .marker {
  position: absolute;
  left: -2rem;
  top: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.timeline-item .marker.complete {
  background: var(--color-action);
  color: var(--color-action-text);
}

.timeline-item .marker.active {
  background: var(--color-bg);
  border: 2px solid var(--color-action);
  animation: pulse 2s infinite;
}

.timeline-item .marker.pending {
  background: var(--color-bg);
  border: 2px dashed var(--color-text-muted);
}

.timeline-item .date {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.timeline-item .title {
  font-weight: 500;
  margin-bottom: 0.25rem;
}

/* Horizontal mode */
.timeline.horizontal {
  display: flex;
  padding-left: 0;
  padding-top: 3rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}

.timeline.horizontal::before {
  left: 0;
  right: 0;
  top: 2rem;
  bottom: auto;
  height: 2px;
  width: auto;
}
```

## Code Example

```svelte
<script>
  import { Timeline, TimelineItem } from '@delightstack/components';
  import CheckIcon from '~icons/mdi/check';
  import ShippingIcon from '~icons/mdi/truck';
  import PackageIcon from '~icons/mdi/package';
</script>

<!-- Order tracking (vertical) -->
<Timeline>
  <TimelineItem
    status="complete"
    date="Jan 10"
    title="Order Confirmed"
    icon={CheckIcon}
  >
    Your order has been confirmed.
  </TimelineItem>

  <TimelineItem
    status="complete"
    date="Jan 11"
    title="Shipped"
    icon={ShippingIcon}
  >
    Package picked up by carrier.
  </TimelineItem>

  <TimelineItem
    status="active"
    date="Jan 12"
    title="Out for Delivery"
    icon={ShippingIcon}
  >
    Expected delivery today.
  </TimelineItem>

  <TimelineItem
    status="pending"
    title="Delivered"
    icon={PackageIcon}
  />
</Timeline>

<!-- Horizontal process steps -->
<Timeline horizontal>
  <TimelineItem status="complete" title="Order Placed" />
  <TimelineItem status="complete" title="Processing" />
  <TimelineItem status="active" title="Shipping" />
  <TimelineItem status="pending" title="Delivered" />
</Timeline>

<!-- With on-demand loading -->
<Timeline onloadmore={loadMoreEvents} pending>
  {#each events as event}
    <TimelineItem
      date={event.date}
      title={event.title}
      status={event.status}
    >
      {event.description}
    </TimelineItem>
  {/each}
</Timeline>

<!-- Skeleton loading -->
<Timeline skeleton skeletonCount={4} />

<!-- Alternating sides -->
<Timeline alternate>
  {#each events as event}
    <TimelineItem date={event.date} title={event.title}>
      {event.description}
    </TimelineItem>
  {/each}
</Timeline>
```

## Implementation Notes

- Use CSS `::before` pseudo-element for the connecting line
- Flexbox for horizontal layout, standard flow for vertical
- `IntersectionObserver` via the utility attachment for scroll-reveal animations
- Horizontal scroll snapping via `scroll-snap-type` and `scroll-snap-align`
- Virtual scrolling: calculate total timeline height/width, position visible items
- On-demand loading: use `IntersectionObserver` on a sentinel element near the bottom
- Alternating mode: use `:nth-child(odd/even)` to position items on alternating sides
