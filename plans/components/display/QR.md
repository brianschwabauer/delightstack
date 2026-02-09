# QR

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/QR.svelte`

## Description

A QR code generator component that creates scannable codes from URLs, text, or other data. Uses a QR encoding library for generation and renders as SVG for crisp display at any size. Supports customizable colors, error correction levels, logo overlay, rounded modules, and download functionality.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: `qr-code-generator` (or similar lightweight QR encoding library)

## Visual Design

### Default Appearance
- Black modules on white background
- Comfortable quiet zone (4 module padding)
- Sharp, crisp edges via SVG rendering
- Scales perfectly at any size

### Customization
- Custom foreground/background colors
- Optional logo/image in center
- Rounded module corners
- Theme-aware defaults using `--color-*` tokens

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Data to encode |
| `size` | `number` | `200` | Size in pixels (width and height) |
| `level` | `'L' \| 'M' \| 'Q' \| 'H'` | `'M'` | Error correction level |
| `foreground` | `string` | `'#000000'` | Module (dark) color |
| `background` | `string` | `'#ffffff'` | Background (light) color |
| `margin` | `number` | `4` | Quiet zone in modules |
| `logo` | `string` | - | Center logo image URL |
| `logoSize` | `number` | `0.25` | Logo size as ratio of QR size (0-1) |
| `rounded` | `boolean` | `false` | Round module corners |
| `downloadable` | `boolean` | `false` | Show download button |
| `downloadFilename` | `string` | `'qr-code'` | Filename for download |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Error Correction Levels

| Level | Recovery | Use Case |
|-------|----------|----------|
| `L` | ~7% | Clean environments, maximum data capacity |
| `M` | ~15% | General use (default) |
| `Q` | ~25% | Moderate damage expected |
| `H` | ~30% | Required when using logo overlay, harsh environments |

When `logo` is provided, the error correction level is automatically upgraded to `'H'` if a lower level was specified, since the logo covers part of the code.

## Logo Integration

- Logo is centered over the QR code
- A white (or `background` color) rectangle is drawn behind the logo to clear modules
- Higher error correction ensures scannability despite covered modules
- `logoSize` controls the logo dimensions as a fraction of the total QR size
- Logo image is loaded and rendered into the SVG

## Download

When `downloadable` is true:
- A small download button appears below or beside the QR code
- Click downloads the QR as a PNG (rendered via canvas from SVG)
- `downloadFilename` controls the file name

Programmatic download:
```svelte
<QR value={url} bind:this={qrRef} />
<button onclick={() => qrRef.download('my-code')}>Download</button>
```

## Skeleton State

When `skeleton` is true, render a square shimmering placeholder matching the specified `size`. A subtle grid pattern hints at QR code structure.

## Accessibility

- `role="img"` on the SVG element
- `aria-label` describing the encoded content (e.g., "QR code for https://example.com")
- Always provide alternative access to the encoded URL/text nearby (QR codes are not accessible to screen readers)

## CSS Approach

```css
.qr-container {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.qr-container svg {
  display: block;
}

.qr-container .download-button {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  text-decoration: underline;
}
```

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

<!-- With logo (auto-upgrades to H error correction) -->
<QR
  value={shareUrl}
  logo="/logo.png"
  level="H"
/>

<!-- High error correction -->
<QR value={shareUrl} level="H" />

<!-- Downloadable -->
<QR
  value={shareUrl}
  downloadable
  downloadFilename="share-code"
/>

<!-- Custom colors -->
<QR
  value={shareUrl}
  foreground="oklch(0.3 0.1 250)"
  background="oklch(0.95 0.02 250)"
/>
```

## Implementation Notes

- Use a lightweight QR encoding library (e.g., `qr-code-generator`) for the matrix generation
- Output as SVG for scalability and crisp rendering
- Each module is an SVG `<rect>` (or rounded `<rect>` with `rx`/`ry` when `rounded` is true)
- Logo: render as an `<image>` element within the SVG, with a backing `<rect>` in the background color
- Download: create an off-screen `<canvas>`, draw the SVG into it, then use `canvas.toBlob()` to generate a PNG
- Handle very long data strings gracefully (show error if data exceeds QR capacity)
- Crossfade animation when `value` changes
