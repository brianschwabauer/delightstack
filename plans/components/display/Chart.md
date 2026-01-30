# Chart

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Chart.svelte`

## Description

A lightweight data visualization component for displaying common chart types. Built with SVG for crisp rendering at any size, with smooth animations and interactive tooltips.

## Visual Design

### Common Elements
- Clean axes with subtle grid lines
- Readable labels at any size
- Consistent color palette
- Optional legend

### Chart Types

| Type | Description |
|------|-------------|
| `line` | Connected data points over time |
| `area` | Line chart with filled area below |
| `bar` | Vertical bars for comparisons |
| `horizontal-bar` | Horizontal bars |
| `pie` | Circular proportional display |
| `donut` | Pie with center cutout |

### Color Palette
Default accessible colors that work together:
- 6-8 distinct, visually balanced colors
- Work in both light and dark themes
- Accessible contrast ratios

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `ChartType` | `'line'` | Chart type |
| `data` | `ChartData` | required | Data to display |
| `width` | `number \| string` | `'100%'` | Chart width |
| `height` | `number` | `300` | Chart height |
| `colors` | `string[]` | - | Custom color palette |
| `showGrid` | `boolean` | `true` | Show grid lines |
| `showLegend` | `boolean` | `true` | Show legend |
| `showTooltip` | `boolean` | `true` | Enable tooltips |
| `animate` | `boolean` | `true` | Animate on load/change |

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

## Chart-Specific Options

### Line/Area
```typescript
{
  curved: boolean;      // Smooth curves vs straight lines
  showPoints: boolean;  // Show data points
  fill: boolean;        // Fill area under line
}
```

### Bar
```typescript
{
  stacked: boolean;     // Stack bars
  horizontal: boolean;  // Horizontal orientation
  barRadius: number;    // Rounded corners
}
```

### Pie/Donut
```typescript
{
  innerRadius: number;  // 0 for pie, >0 for donut
  showLabels: boolean;  // Labels on segments
  startAngle: number;   // Starting angle
}
```

## Interactivity

### Tooltips
- Appear on hover
- Show exact values
- Follow cursor smoothly
- Multi-series support

### Hover Effects
- Highlight hovered element
- Dim non-hovered elements
- Smooth transitions

### Legend Interaction
- Click to toggle series visibility
- Hover to highlight series
- Responsive layout

## Delightful Details

### Load Animation
- Lines draw from left to right
- Bars grow from zero
- Pie segments expand from center
- Staggered timing for multiple series

### Update Animation
- Smooth transitions between values
- Morphing shapes
- No jarring redraws

### Responsive Design
- Adapts to container width
- Font sizes scale appropriately
- Legend repositions on small screens

### Empty State
- Meaningful empty state message
- Not just blank space
- Guides user on what data to add

## Accessibility

- Proper ARIA labels
- Data table alternative available
- Keyboard navigation for interactive elements
- Colorblind-friendly palette option

## Code Example

```svelte
<script>
  import { Chart } from '@delightstack/components';

  const salesData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: '2024',
        data: [12, 19, 3, 5, 2, 3]
      },
      {
        label: '2023',
        data: [8, 15, 7, 8, 4, 6]
      }
    ]
  };
</script>

<!-- Line chart -->
<Chart
  type="line"
  data={salesData}
  height={250}
/>

<!-- Bar chart -->
<Chart
  type="bar"
  data={salesData}
/>

<!-- Donut chart -->
<Chart
  type="donut"
  data={{
    labels: ['Desktop', 'Mobile', 'Tablet'],
    datasets: [{
      data: [65, 30, 5]
    }]
  }}
/>
```

## Implementation Notes

- Use SVG for crisp rendering
- Avoid heavy charting libraries
- Calculate scales manually (simple math)
- Use CSS transitions for animations
- Consider canvas for large datasets
- Keep bundle size minimal
