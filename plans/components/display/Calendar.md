# Calendar

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Calendar.svelte`

## Description

A full-featured date display and selection component showing a monthly view. Supports single date selection, date range selection, and multiple date selection. Handles events, marked dates, time slots, locale-aware formatting, and full keyboard navigation. Used both standalone and as a dropdown within date input fields.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none (uses `Intl.DateTimeFormat` for locale formatting)

## Visual Design

### Layout
- Month/year header with navigation arrows
- Day-of-week labels (locale-aware: Mon-Sun or Sun-Sat)
- 6-week grid of date cells
- Compact, scannable design

### Header
- Current month and year centered
- Previous/next month arrow buttons
- Clickable month/year text to switch to month or year picker view

### Date Cells
- Equal-sized grid cells
- Today: subtle ring outline
- Selected date: accent background with contrast text
- Other-month dates: muted text color
- Hover state on selectable dates
- Disabled dates: reduced opacity, no interaction

### Range Selection
- Start date: accent background with rounded left corners
- End date: accent background with rounded right corners
- Dates between: lighter accent fill
- Visual continuity across week rows

### Events and Markers
- Small colored dots beneath dates that have events
- Multiple dots for multiple events (max 3 visible)
- Tooltip on hover showing event details

### Time Slots
- When `showTimeSlots` is true, a scrollable time column appears alongside the calendar
- Time slots at configurable intervals (15, 30, 60 minutes)
- Selectable time slots with visual selection state

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Date \| Date[] \| [Date, Date]` | - | Selected date(s), bindable |
| `mode` | `'single' \| 'range' \| 'multiple'` | `'single'` | Selection mode |
| `month` | `Date` | `new Date()` | Displayed month, bindable |
| `min` | `Date` | - | Minimum selectable date |
| `max` | `Date` | - | Maximum selectable date |
| `disabled` | `Date[] \| ((date: Date) => boolean)` | `[]` | Disabled dates (array or predicate) |
| `marked` | `MarkedDate[]` | `[]` | Dates with colored markers |
| `events` | `CalendarEvent[]` | `[]` | Events to display on dates |
| `weekStartsOn` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6` | locale default | First day of week (0=Sunday, 1=Monday, etc.) |
| `locale` | `string` | `navigator.language` | Locale for date formatting |
| `showTimeSlots` | `boolean` | `false` | Show time slot picker alongside calendar |
| `timeSlotInterval` | `number` | `30` | Time slot interval in minutes |
| `timeSlotMin` | `string` | `'00:00'` | Earliest time slot |
| `timeSlotMax` | `string` | `'23:59'` | Latest time slot |
| `dense` | `boolean` | `false` | Compact cell spacing |
| `comfortable` | `boolean` | `false` | Relaxed cell spacing |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### CalendarEvent Interface
```typescript
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end?: Date;
  color?: string;
  allDay?: boolean;
}
```

### MarkedDate Interface
```typescript
interface MarkedDate {
  date: Date;
  color?: string;
  label?: string; // Tooltip text
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ value: Date \| Date[] \| [Date, Date] }` | Selection changed |
| `onmonthchange` | `{ month: Date }` | Navigated to a different month |
| `ontimeslotselect` | `{ time: string, date: Date }` | Time slot selected |

## Selection Modes

### Single
- Click to select a date
- Click the same date again to deselect
- `value` is a single `Date`

### Range
- First click sets the start date
- Second click sets the end date (must be after start)
- Hovering between clicks shows a preview of the range
- Click again to restart selection
- `value` is a `[Date, Date]` tuple

### Multiple
- Click to toggle each date on/off
- Non-contiguous selections allowed
- `value` is an array of `Date` objects

## Keyboard Navigation

| Key | Action |
|-----|--------|
| **Arrow Left** | Move focus to previous day |
| **Arrow Right** | Move focus to next day |
| **Arrow Up** | Move focus to same day previous week |
| **Arrow Down** | Move focus to same day next week |
| **Page Up** | Move to same date in previous month |
| **Page Down** | Move to same date in next month |
| **Shift+Page Up** | Move to same date in previous year |
| **Shift+Page Down** | Move to same date in next year |
| **Home** | Move focus to start of current week |
| **End** | Move focus to end of current week |
| **Enter / Space** | Select the focused date |

Focus wraps across month boundaries (pressing Right on the last day of a month moves to the first day of the next month and updates the displayed month).

## Locale Awareness

- Day-of-week labels derived from `Intl.DateTimeFormat` using the specified `locale`
- Month/year header formatted with `Intl.DateTimeFormat`
- `weekStartsOn` defaults to the locale's conventional first day of week (Monday for most of Europe, Sunday for the US) unless explicitly overridden

## Skeleton State

When `skeleton` is true, render a grid of shimmering placeholder cells matching the calendar layout. The header shows skeleton bars for month/year text and navigation buttons.

## CSS Approach

```css
.calendar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.calendar-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-2);
  cursor: pointer;
  position: relative;
}

.calendar-cell.today {
  outline: 1px solid var(--color-action);
  outline-offset: -1px;
}

.calendar-cell.selected {
  background-color: var(--color-action);
  color: var(--color-action-text);
}

.calendar-cell.in-range {
  background-color: color-mix(in oklch, var(--color-action), transparent 85%);
}

.calendar-cell.other-month {
  color: var(--color-text-muted);
}
```

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
<Calendar mode="range" bind:value={dateRange} />

<!-- With constraints -->
<Calendar
  bind:value={selectedDate}
  min={new Date()}
  max={new Date(2026, 5, 1)}
/>

<!-- With marked dates -->
<Calendar
  bind:value={selectedDate}
  marked={[
    { date: eventDate, color: 'var(--color-accent)', label: 'Meeting' },
    { date: deadline, color: 'var(--color-error)', label: 'Deadline' }
  ]}
/>

<!-- With events -->
<Calendar
  bind:value={selectedDate}
  events={calendarEvents}
/>

<!-- Monday start, German locale -->
<Calendar
  bind:value={selectedDate}
  locale="de-DE"
  weekStartsOn={1}
/>

<!-- With time slots -->
<Calendar
  bind:value={selectedDate}
  showTimeSlots
  timeSlotInterval={15}
/>

<!-- Multiple selection -->
<Calendar
  mode="multiple"
  bind:value={selectedDates}
/>
```

## Implementation Notes

- Handle timezone correctly: compare dates as date-only (strip time) for selection logic
- Use `Intl.DateTimeFormat` for all locale-dependent formatting
- CSS Grid for the 7-column date cell layout
- Month transitions use a subtle slide animation (direction matches navigation)
- Hover preview in range mode: track the hovered date and render a lighter fill from start to hovered
- Lazy load event data for months as they are navigated to (consumer responsibility via `onmonthchange`)
- Integrates with Input component as a dropdown for date picker functionality
