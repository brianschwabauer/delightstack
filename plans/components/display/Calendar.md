# Calendar

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Calendar.svelte`

## Description

A date display and selection component showing a monthly view. Supports single date selection, date ranges, and marking special dates. Used both standalone and as a dropdown within date input fields.

## Visual Design

### Layout
- Month/year header with navigation
- Day-of-week labels (S M T W T F S)
- 6-week grid of dates
- Compact, scannable design

### Header
- Current month and year centered
- Previous/next month arrows
- Optional year selector dropdown

### Date Cells
- Equal-sized grid cells
- Today highlighted
- Selected dates with accent background
- Other-month dates muted
- Hover state on selectable dates

### Range Selection
- Start/end dates with filled background
- Connecting dates with lighter fill
- Visual continuity across weeks

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Date \| Date[]` | - | Selected date(s) (bindable) |
| `mode` | `'single' \| 'range' \| 'multiple'` | `'single'` | Selection mode |
| `month` | `Date` | `new Date()` | Displayed month |
| `min` | `Date` | - | Minimum selectable date |
| `max` | `Date` | - | Maximum selectable date |
| `disabled` | `Date[]` | `[]` | Disabled dates |
| `marked` | `MarkedDate[]` | `[]` | Dates with markers |
| `weekStartsOn` | `0-6` | `0` | First day of week |

### MarkedDate Interface
```typescript
interface MarkedDate {
  date: Date;
  color?: string;
  label?: string;  // Tooltip
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `Date \| Date[]` | Selection changed |
| `onmonthchange` | `Date` | Navigated to different month |

## Selection Modes

### Single
- Click to select
- Click again to deselect (if allowed)
- One date active at a time

### Range
- First click sets start
- Second click sets end
- Click again to restart

### Multiple
- Click to toggle each date
- Multiple non-contiguous selections
- Array of dates as value

## Delightful Details

### Smooth Navigation
- Month transitions with subtle slide
- Direction based on navigation (left/right)
- Or: Crossfade for cleaner look

### Today Indicator
- Subtle ring around today
- Visible even when selected
- Different from selection highlight

### Hover Preview
In range mode:
- Preview range as you hover
- Light fill shows potential selection
- Updates in real-time

### Keyboard Navigation
- Arrow keys move focus
- Enter/Space selects
- Page Up/Down changes month
- Home/End go to start/end of week

### Dot Markers
- Small dots under dates with events
- Multiple dots for multiple events
- Tooltip shows event details

## Accessibility

- Full keyboard navigation
- ARIA labels for buttons
- Screen reader announces dates
- Focus management

## Code Example

```svelte
<script>
  import { Calendar } from '@delightstack/components';

  let selectedDate = $state<Date | null>(null);
  let dateRange = $state<[Date, Date] | null>(null);
</script>

<!-- Single date selection -->
<Calendar bind:value={selectedDate} />

<!-- Date range selection -->
<Calendar
  mode="range"
  bind:value={dateRange}
/>

<!-- With constraints -->
<Calendar
  value={selectedDate}
  min={new Date()}
  max={addMonths(new Date(), 3)}
/>

<!-- With marked dates -->
<Calendar
  value={selectedDate}
  marked={[
    { date: eventDate, color: 'var(--c-accent)', label: 'Meeting' },
    { date: deadline, color: 'var(--c-error)', label: 'Deadline' }
  ]}
/>
```

## Implementation Notes

- Handle timezone correctly (dates not timestamps)
- Support locale for day names and formats
- Use CSS Grid for cell layout
- Consider lazy loading month data for events
- Integrate with Input component for date picker dropdown
