# Stat

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Stat.svelte`

## Description

A component for displaying key metrics or statistics with optional labels, icons, and change indicators. Perfect for dashboards, cards, and data-focused interfaces.

## Visual Design

### Layout
- Value as large, prominent text
- Label as smaller text above/below
- Optional icon on left or top
- Change indicator showing trend

### Hierarchy
1. Value (largest, boldest)
2. Label (smaller, muted)
3. Change/description (smallest, colored)

### Sizes
| Size | Value | Label | Use Case |
|------|-------|-------|----------|
| `sm` | 24px | 12px | Dense dashboards |
| `md` | 32px | 14px | Cards, summaries |
| `lg` | 48px | 16px | Hero stats |
| `xl` | 64px | 18px | Landing pages |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number` | required | Main statistic |
| `label` | `string` | - | Descriptive label |
| `icon` | `Component` | - | Leading icon |
| `change` | `number` | - | Change from previous |
| `changeLabel` | `string` | - | Change description |
| `trend` | `'up' \| 'down' \| 'neutral'` | - | Trend direction |
| `size` | `Size` | `'md'` | Component size |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout direction |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Change Indicator

### Automatic
When `change` is provided:
- Positive: green, arrow up
- Negative: red, arrow down
- Zero: gray, neutral

### Override
```svelte
<Stat value="85%" change={-5} trend="up" />
```
Override trend when decrease is positive (e.g., bug count)

### With Label
```svelte
<Stat
  value="$12,450"
  change={12.5}
  changeLabel="vs last month"
/>
<!-- Shows: +12.5% vs last month -->
```

## Delightful Details

### Animated Value
- Uses Counter component internally
- Smooth transition on value change
- Configurable animation

### Change Pulse
- Brief pulse animation on change
- Green flash for positive
- Draws attention to updates

### Icon Treatment
- Icon sized appropriately
- Color can match theme
- Optional background circle

### Loading State
- Skeleton for value
- Maintains layout
- Smooth transition in

## Variants

### Basic
```svelte
<Stat value="1,234" label="Total Users" />
```

### With Icon
```svelte
<Stat
  value="$52,420"
  label="Revenue"
  icon={DollarIcon}
/>
```

### With Change
```svelte
<Stat
  value="3.2k"
  label="Active Users"
  change={15}
  changeLabel="since yesterday"
/>
```

### Horizontal Layout
```svelte
<Stat
  layout="horizontal"
  value="99.9%"
  label="Uptime"
  icon={ServerIcon}
/>
```

## Accessibility

- Proper heading hierarchy
- Screen reader friendly structure
- Trend communicated via text, not just color

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
    value={`$${revenue.toLocaleString()}`}
    label="Monthly Revenue"
    icon={RevenueIcon}
    change={revenueChange}
  />

  <Stat
    value={`${conversionRate}%`}
    label="Conversion Rate"
    icon={GrowthIcon}
    change={conversionChange}
    size="lg"
  />
</div>

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
</style>
```

## Implementation Notes

- Integrate with Counter for animations
- Use Format for number formatting
- Handle very long numbers gracefully
- Consider loading/skeleton state
- Responsive sizing on small screens
