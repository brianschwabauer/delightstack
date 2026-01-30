# QR

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/QR.svelte`

## Description

A QR code generator component that creates scannable codes for URLs, text, or other data. Renders as SVG for crisp display at any size with customizable styling options.

## Visual Design

### Default Appearance
- Black modules on white background
- Comfortable quiet zone (padding)
- Sharp, crisp edges
- Scales perfectly (SVG)

### Customization
- Custom foreground/background colors
- Optional logo/image in center
- Rounded module corners
- Gradient fills (advanced)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Data to encode |
| `size` | `number` | `200` | Size in pixels |
| `level` | `'L' \| 'M' \| 'Q' \| 'H'` | `'M'` | Error correction |
| `foreground` | `string` | `'#000'` | Module color |
| `background` | `string` | `'#fff'` | Background color |
| `margin` | `number` | `4` | Quiet zone (modules) |
| `logo` | `string` | - | Center logo URL |
| `logoSize` | `number` | `0.25` | Logo size (0-1 ratio) |
| `rounded` | `boolean` | `false` | Round module corners |

## Error Correction Levels

| Level | Recovery | Use Case |
|-------|----------|----------|
| `L` | ~7% | Clean environments |
| `M` | ~15% | General use (default) |
| `Q` | ~25% | Moderate damage expected |
| `H` | ~30% | Logos, harsh environments |

## Delightful Details

### Smooth Generation
- No flicker on value change
- Crossfade to new code
- Instant generation

### Logo Integration
- Centered over QR code
- Uses higher error correction
- Background behind logo
- Maintains scannability

### Download Option
```svelte
<QR value={url} downloadable filename="my-qr" />
```
- Download as PNG or SVG
- Configurable filename
- Optional download button

### Responsive
- Scales to container
- Maintains square aspect
- Crisp at any resolution

## Code Example

```svelte
<script>
  import { QR } from '@delightstack/components';

  const shareUrl = 'https://example.com/share/abc123';
</script>

<!-- Basic QR code -->
<QR value={shareUrl} />

<!-- Styled QR code -->
<QR
  value={shareUrl}
  size={250}
  foreground="var(--color-action)"
  rounded
/>

<!-- With logo -->
<QR
  value={shareUrl}
  logo="/logo.png"
  level="H"
/>

<!-- Downloadable -->
<QR
  value={shareUrl}
  downloadable
  filename="share-code"
/>
```

## Accessibility

- Include descriptive text nearby
- Don't rely solely on QR for content access
- Provide alternative link

## Implementation Notes

- Implement QR generation algorithm or use small library
- Output as SVG for scalability
- Calculate logo safe area for error correction
- Handle very long data gracefully
- Consider canvas fallback for PNG export
