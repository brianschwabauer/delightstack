# Chart

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Chart.svelte`

## Description

A data visualization wrapper component for displaying common chart types. Wraps a lightweight charting library (uPlot for time-series/line/bar charts, or Layercake for Svelte-native rendering) to provide a simple, consistent API. Charts are responsive and resize with their container.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- `resizeObserver` (attachment, for responsive resizing)
- **Libraries**: `uplot` (lightweight, performant charting) or `layercake` (Svelte-native charting)

## Visual Design

### Common Elements
- Clean axes with subtle grid lines
- Readable labels at any size
- Consistent color palette derived from `--color-*` tokens
- Optional legend

### Chart Types

| Type | Description |
|------|-------------|
| `line` | Connected data points, ideal for time series |
| `area` | Line chart with filled area below the line |
| `bar` | Vertical bars for categorical comparisons |
| `horizontal-bar` | Horizontal bars |
| `pie` | Circular proportional segments |
| `donut` | Pie with center cutout |

### Color Palette
Default accessible colors derived from design tokens:
- 8 distinct, visually balanced colors
- Adapt to light and dark themes via `light-dark()`
- Accessible contrast ratios against both backgrounds

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'line' \| 'area' \| 'bar' \| 'horizontal-bar' \| 'pie' \| 'donut'` | `'line'` | Chart type |
| `data` | `ChartData` | required | Data to display |
| `height` | `number` | `300` | Chart height in pixels |
| `colors` | `string[]` | - | Custom color palette (overrides defaults) |
| `showGrid` | `boolean` | `true` | Show grid lines |
| `showLegend` | `boolean` | `true` | Show legend |
| `showTooltip` | `boolean` | `true` | Enable interactive tooltips |
| `animate` | `boolean` | `true` | Animate on initial load and data changes |
| `stacked` | `boolean` | `false` | Stack datasets (bar, area) |
| `curved` | `boolean` | `true` | Smooth curves for line/area charts |
| `showPoints` | `boolean` | `false` | Show data points on line/area charts |
| `innerRadius` | `number` | `0` | Inner radius for pie/donut (0 = pie, >0 = donut) |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### ChartData Interface
```typescript
interface ChartData {
  labels: string[];
  datasets: Dataset[];
}

interface Dataset {
  label: string;
  data: number[];
  color?: string;
}
```

## Responsive Behavior

Charts resize with their container using either a `ResizeObserver` (via the `resizeObserver` attachment from `@delightstack/utilities`) or CSS container queries. The chart re-renders at the new dimensions without jarring redraws.

- Width: always `100%` of the container
- Height: fixed in pixels (via `height` prop) or responsive via CSS
- Font sizes and label density adapt to available width
- Legend repositions below the chart on narrow containers

## Interactivity

### Tooltips
- Appear on hover over data points or segments
- Show exact values and dataset labels
- Follow cursor smoothly
- Multi-series crosshair for line/area charts

### Hover Effects
- Highlight hovered element (bar, line point, pie segment)
- Dim non-hovered elements to 40% opacity
- Smooth transitions between states

### Legend Interaction
- Click legend items to toggle dataset visibility
- Hover legend items to highlight corresponding dataset
- Responsive layout (wraps on small screens)

## Animations

### Load Animation
- Lines draw from left to right using stroke-dasharray
- Bars grow upward from zero height
- Pie segments expand from center
- Staggered timing for multiple datasets

### Update Animation
- Smooth transitions between old and new values
- Morphing shapes on type change
- No jarring redraws

## Skeleton State

When `skeleton` is true, render a placeholder matching the chart dimensions. Show subtle animated bars, a sine wave, or a circle depending on `type` to hint at the chart shape.

## Empty State

When `data.datasets` is empty or all values are zero:
- Display a centered message ("No data available")
- Subtle illustration or icon
- Maintains chart dimensions

## Accessibility

- `role="img"` on the chart container
- `aria-label` describing the chart purpose
- Hidden data table as an alternative representation (accessible to screen readers)
- Keyboard navigation for interactive legend
- Color palette is colorblind-friendly (distinct shapes/patterns option)

## CSS Approach

```css
.chart-container {
  width: 100%;
  position: relative;
  container-type: inline-size;
}

.chart-skeleton {
  background: light-dark(var(--color-surface-1), var(--color-surface-1));
  border-radius: var(--radius-3);
  animation: shimmer 1.5s infinite;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  padding: 0.5rem 0;
}

.chart-legend-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--text-sm);
  cursor: pointer;
  user-select: none;
}

.chart-legend-item.hidden {
  opacity: 0.4;
  text-decoration: line-through;
}
```

## Code Example

```svelte
<script>
  import { Chart } from '@delightstack/components';

  const salesData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: '2025',
        data: [12, 19, 3, 5, 2, 3]
      },
      {
        label: '2024',
        data: [8, 15, 7, 8, 4, 6]
      }
    ]
  };
</script>

<!-- Line chart -->
<Chart type="line" data={salesData} height={250} />

<!-- Stacked bar chart -->
<Chart type="bar" data={salesData} stacked />

<!-- Area chart with data points -->
<Chart type="area" data={salesData} showPoints />

<!-- Donut chart -->
<Chart
  type="donut"
  data={{
    labels: ['Desktop', 'Mobile', 'Tablet'],
    datasets: [{ label: 'Traffic', data: [65, 30, 5] }]
  }}
  innerRadius={60}
/>

<!-- Skeleton loading -->
<Chart type="bar" skeleton height={300} />
```

## Implementation Notes

- Wrap uPlot (or Layercake) rather than building SVG rendering from scratch
- Lazy-load the charting library to keep initial bundle size small
- ResizeObserver for responsive re-rendering
- Use CSS custom properties for theme integration
- Canvas rendering (via uPlot) for large datasets; SVG (via Layercake) for smaller datasets with rich interactivity
- Export the chart as a PNG or SVG via an optional method
