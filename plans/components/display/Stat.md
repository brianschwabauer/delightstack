# Stat

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Stat.svelte`

## Description

A component for displaying key metrics or statistics with optional labels, icons, and change indicators (up/down arrow with percentage). Uses the Counter component internally for animated number display. Ideal for dashboards, summary cards, and data-focused interfaces.

## Dependencies

- **Components**: `Counter` (for animated number display)
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Layout
- Value as large, prominent text
- Label as smaller text above or below
- Optional icon on left or top
- Change indicator showing trend direction and percentage

### Hierarchy
1. **Value** (largest, boldest)
2. **Label** (smaller, muted color)
3. **Change** (smallest, colored by trend direction)

### Sizes

| Size | Value Font | Label Font | Use Case |
|------|-----------|-----------|----------|
| `'0'` | 20px | 11px | Dense dashboards |
| `'1'` (default) | 28px | 13px | Cards, summaries |
| `'2'` | 40px | 15px | Hero stats |
| `'3'` | 56px | 17px | Landing pages |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number` | required | Main statistic to display |
| `label` | `string` | - | Descriptive label |
| `icon` | `Component` | - | Leading icon component |
| `change` | `number` | - | Percentage change from previous period |
| `changeLabel` | `string` | - | Description for the change (e.g., "vs last month") |
| `trend` | `'up' \| 'down' \| 'neutral'` | auto | Override trend direction |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Component size |
| `horizontal` | `boolean` | `false` | Horizontal layout instead of vertical |
| `animated` | `boolean` | `true` | Animate value via Counter component |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Change Indicator

### Automatic Trend Detection
When `change` is provided and `trend` is not explicitly set:
- Positive change: green arrow up icon, "+X%" text
- Negative change: red arrow down icon, "-X%" text
- Zero change: gray neutral indicator

### Trend Override
```svelte
<Stat value="85%" change={-5} trend="up" />
```
Override the automatic trend when a decrease is positive (e.g., bug count going down is good). The `trend` prop controls the color (green/red) independently of the change direction.

### Change Display
```svelte
<Stat
  value="$12,450"
  change={12.5}
  changeLabel="vs last month"
/>
```
Renders as: **$12,450** with a green "+12.5% vs last month" below.

## Counter Integration

When `animated` is true and `value` is a number, the Stat component renders the value using the Counter component internally:
- Smooth count-up animation on first render
- Transitions smoothly when value changes
- Respects `prefers-reduced-motion`
- When `value` is a string (e.g., "$12,450"), it is displayed as static text

## Skeleton State

When `skeleton` is true, render placeholder shimmer bars for:
- The value (wide bar)
- The label (narrower bar)
- The change indicator (short bar)
- Maintains the component layout and sizing

## Accessibility

- Stat value and label use appropriate heading/description hierarchy
- Trend direction communicated via text, not just color (e.g., "increased by 12.5%")
- `aria-label` on the change indicator includes direction and value
- Screen readers get a complete reading: "Total Users: 1,234, increased by 15% this week"

## CSS Approach

```css
.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat.horizontal {
  flex-direction: row;
  align-items: center;
  gap: 1rem;
}

.stat .value {
  font-weight: 700;
  line-height: 1.1;
  color: var(--color-text);
}

.stat .label {
  color: var(--color-text-muted);
  font-weight: 400;
}

.stat .change {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--text-sm);
}

.stat .change.positive {
  color: var(--color-success);
}

.stat .change.negative {
  color: var(--color-error);
}

.stat .change.neutral {
  color: var(--color-text-muted);
}

.stat .icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-action);
}
```

## Code Example

```svelte
<script>
  import { Stat } from '@delightstack/components';
  import UsersIcon from '~icons/mdi/account-group';
  import RevenueIcon from '~icons/mdi/currency-usd';
  import GrowthIcon from '~icons/mdi/trending-up';
</script>

<div class="stats-grid">
  <Stat
    value={userCount}
    label="Total Users"
    icon={UsersIcon}
    change={newUsersPercent}
    changeLabel="this week"
  />

  <Stat
    value={revenue}
    label="Monthly Revenue"
    icon={RevenueIcon}
    change={revenueChange}
    size="2"
  />

  <Stat
    value={conversionRate}
    label="Conversion Rate"
    icon={GrowthIcon}
    change={conversionChange}
    size="2"
  />
</div>

<!-- Horizontal layout -->
<Stat
  horizontal
  value="99.9%"
  label="Uptime"
/>

<!-- Override trend (decrease is good) -->
<Stat
  value={bugCount}
  label="Open Bugs"
  change={-15}
  trend="up"
  changeLabel="fewer than last week"
/>

<!-- Skeleton loading -->
<Stat skeleton size="2" />

<!-- Static string value -->
<Stat value="$12,450" label="Revenue" change={12.5} changeLabel="vs last month" />
```

## Implementation Notes

- Uses Counter component internally for animated numeric values
- Change indicator arrow is a small SVG icon (up-right or down-right arrow)
- Trend color is determined by `trend` prop or auto-detected from `change` sign
- Size variants use CSS custom properties for consistent scaling
- Layout adapts between vertical (default) and horizontal modes
