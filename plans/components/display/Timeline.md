# Timeline

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Timeline.svelte`

## Description

A vertical or horizontal timeline for displaying chronological events, activity history, or step-by-step processes. Connects events with a visual line and markers.

## Visual Design

### Vertical Layout (Default)
- Line runs down left side
- Events branch to the right
- Markers on the line
- Dates/times on left (optional)

### Horizontal Layout
- Line runs horizontally
- Events above and below (alternating)
- Good for process steps

### Markers
- Circular nodes on the line
- Icons or numbers inside
- Color indicates status
- Size indicates importance

### Event Content
- Title
- Description
- Timestamp
- Optional action buttons

## Props

### Timeline Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout direction |
| `alternate` | `boolean` | `false` | Alternate sides |
| `pending` | `boolean` | `false` | Show pending state at end |

### Timeline Item

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `date` | `Date \| string` | - | Event timestamp |
| `title` | `string` | - | Event title |
| `icon` | `Component` | - | Marker icon |
| `color` | `string` | - | Marker color |
| `status` | `'complete' \| 'active' \| 'pending'` | - | Event status |

## Event States

### Complete
- Solid marker
- Checkmark or custom icon
- Full line connection

### Active
- Highlighted marker
- Pulse animation
- Indicates current

### Pending
- Hollow/dashed marker
- Dashed line connection
- Muted styling

## Delightful Details

### Line Animation
- Line "draws" on scroll into view
- Progressive reveal
- Smooth entrance

### Marker Animation
- Pop in as they appear
- Staggered timing
- Smooth scale

### Scroll Reveal
- Events animate in on scroll
- Staggered by position
- Subtle fade + slide

### Hover Effects
- Marker scales slightly
- Card elevates
- More details revealed

### Collapse/Expand
- Long timelines can collapse middle items
- "Show more" reveals hidden
- Smooth height animation

## Variants

### Activity Feed
```svelte
<Timeline>
  <TimelineItem date={now} icon={UserIcon}>
    <strong>Alice</strong> created a new project
  </TimelineItem>
  <TimelineItem date={earlier} icon={EditIcon}>
    <strong>Bob</strong> updated settings
  </TimelineItem>
</Timeline>
```

### Process Steps
```svelte
<Timeline direction="horizontal">
  <TimelineItem status="complete" title="Order Placed" />
  <TimelineItem status="complete" title="Processing" />
  <TimelineItem status="active" title="Shipping" />
  <TimelineItem status="pending" title="Delivered" />
</Timeline>
```

### Changelog
```svelte
<Timeline>
  <TimelineItem date="2024-01-15" title="v2.0.0">
    <Badge>Major</Badge>
    <p>Complete redesign with new features...</p>
  </TimelineItem>
  <!-- ... -->
</Timeline>
```

## Accessibility

- Ordered list semantics
- Dates announced properly
- Status communicated via text
- Keyboard navigable

## Code Example

```svelte
<script>
  import { Timeline, TimelineItem } from '@delightstack/components';
  import CheckIcon from '~icons/mdi/check';
  import ShippingIcon from '~icons/mdi/truck';
  import PackageIcon from '~icons/mdi/package';
</script>

<!-- Order tracking -->
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
```

## Implementation Notes

- Use CSS for line and connectors
- Flexbox for layout
- IntersectionObserver for scroll animations
- Support nested content
- Handle very long timelines with virtualization
