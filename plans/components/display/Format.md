# Format

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Format.svelte`

## Description

A utility component for formatting and displaying common data types like dates, times, numbers, currencies, and relative times. Ensures consistent formatting throughout the application.

## Visual Design

This is primarily a formatting utility - visual output depends on context. The component renders a `<span>` or `<time>` element with formatted text.

## Variants

### Date
```svelte
<Format type="date" value={date} />
<!-- Jan 15, 2024 -->
```

### Time
```svelte
<Format type="time" value={date} />
<!-- 3:45 PM -->
```

### DateTime
```svelte
<Format type="datetime" value={date} />
<!-- Jan 15, 2024, 3:45 PM -->
```

### Relative Time
```svelte
<Format type="relative" value={date} />
<!-- 5 minutes ago -->
```

### Number
```svelte
<Format type="number" value={1234567} />
<!-- 1,234,567 -->
```

### Currency
```svelte
<Format type="currency" value={99.99} currency="USD" />
<!-- $99.99 -->
```

### Percentage
```svelte
<Format type="percent" value={0.85} />
<!-- 85% -->
```

### File Size
```svelte
<Format type="bytes" value={1536000} />
<!-- 1.5 MB -->
```

### Duration
```svelte
<Format type="duration" value={3665} /> <!-- seconds -->
<!-- 1h 1m 5s -->
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `FormatType` | required | Format type |
| `value` | `any` | required | Value to format |
| `locale` | `string` | `'en-US'` | Locale for formatting |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Type-Specific Props

**Date/Time:**
| Prop | Type | Default |
|------|------|---------|
| `format` | `'short' \| 'medium' \| 'long'` | `'medium'` |
| `weekday` | `boolean` | `false` |
| `year` | `boolean` | `true` |

**Relative:**
| Prop | Type | Default |
|------|------|---------|
| `updateInterval` | `number` | `60000` |
| `threshold` | `number` | - |

**Number:**
| Prop | Type | Default |
|------|------|---------|
| `decimals` | `number` | - |
| `compact` | `boolean` | `false` |

**Currency:**
| Prop | Type | Default |
|------|------|---------|
| `currency` | `string` | `'USD'` |
| `display` | `'symbol' \| 'code' \| 'name'` | `'symbol'` |

## Relative Time Details

### Time Ranges
| Range | Output |
|-------|--------|
| < 1 minute | "just now" |
| 1-59 minutes | "X minutes ago" |
| 1-23 hours | "X hours ago" |
| 1-6 days | "X days ago" |
| 7+ days | Full date |

### Live Updates
- Updates automatically at configured interval
- Cleans up interval on unmount
- Can be disabled

## Delightful Details

### Semantic HTML
- Dates use `<time datetime="...">`
- Proper accessibility attributes
- Machine-readable format included

### Tooltip on Hover
For relative dates, show full date on hover:
```svelte
<Format type="relative" value={date} tooltip />
<!-- "5 minutes ago" with tooltip "January 15, 2024 at 3:45 PM" -->
```

### Compact Numbers
```svelte
<Format type="number" value={1500000} compact />
<!-- 1.5M -->
```

### Locale Awareness
- Respects locale for number formats
- Proper date ordering per locale
- Currency symbol placement

## Code Example

```svelte
<script>
  import { Format } from '@delightstack/components';

  const now = new Date();
  const price = 1299.99;
  const progress = 0.756;
</script>

<!-- Date formatting -->
<p>Created: <Format type="date" value={createdAt} /></p>
<p>Updated: <Format type="relative" value={updatedAt} /></p>

<!-- Numbers and currency -->
<p>Price: <Format type="currency" value={price} currency="USD" /></p>
<p>Visits: <Format type="number" value={visitCount} compact /></p>
<p>Progress: <Format type="percent" value={progress} decimals={1} /></p>

<!-- File info -->
<p>Size: <Format type="bytes" value={file.size} /></p>

<!-- Duration -->
<p>Duration: <Format type="duration" value={videoLength} /></p>
```

## Implementation Notes

- Use `Intl` APIs for locale-aware formatting
- `Intl.DateTimeFormat` for dates
- `Intl.NumberFormat` for numbers/currency
- `Intl.RelativeTimeFormat` for relative times
- Handle timezone considerations
- Consider SSR hydration for dates
