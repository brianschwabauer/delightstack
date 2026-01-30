# PDF

**Status**: 🔲 Placeholder
**Category**: Media
**File**: `packages/components/src/media/PDF.svelte`

## Description

A PDF document viewer for displaying PDF files within the application. Provides page navigation, zoom controls, and optional download functionality.

## Visual Design

### Container
- Document centered in viewport
- Page shadows for definition
- Scrollable for multi-page
- Responsive width

### Controls
- Page navigation (prev/next, input)
- Zoom controls
- Fullscreen option
- Download button

### Toolbar
- Top or bottom positioned
- Compact on mobile
- Page indicator (1 of 10)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | PDF URL or data |
| `page` | `number` | `1` | Current page (bindable) |
| `zoom` | `number` | `1` | Zoom level (bindable) |
| `rotation` | `number` | `0` | Page rotation |
| `showToolbar` | `boolean` | `true` | Show controls |
| `showDownload` | `boolean` | `true` | Show download button |
| `fit` | `'width' \| 'height' \| 'page'` | `'width'` | Fit mode |
| `height` | `string` | `'600px'` | Viewer height |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onpagechange` | `{ page, total }` | Page changed |
| `onload` | `{ totalPages }` | PDF loaded |
| `onerror` | `{ error }` | Load failed |
| `ondownload` | - | Download clicked |

## Features

### Page Navigation
- Previous/Next buttons
- Page number input
- Keyboard shortcuts (arrows)
- Page thumbnails (optional)

### Zoom
- Zoom in/out buttons
- Fit to width/height/page
- Scroll to zoom
- Pinch to zoom (touch)

### Search (Advanced)
```svelte
<PDF src={document} searchable />
```
- Text search within PDF
- Highlight matches
- Navigate between results

### Text Selection
- Select and copy text
- If PDF has text layer

### Annotations (Advanced)
- Highlight text
- Add comments
- Draw on pages

## Delightful Details

### Page Transitions
- Smooth scroll between pages
- Or: fade transition
- Page change animation

### Loading States
- Page-by-page loading
- Skeleton for pages
- Progress indicator

### Thumbnail Strip
- Small page previews
- Click to navigate
- Scrollable strip

### Keyboard Shortcuts
- Arrow keys: next/prev page
- +/-: zoom
- Home/End: first/last page
- Ctrl+F: search

### Print Support
- Print button
- Proper print styling

## Accessibility

- Keyboard navigation
- Screen reader support for text
- Page announcements
- Focus management

## Code Example

```svelte
<script>
  import { PDF } from '@delightstack/components';

  let currentPage = $state(1);
</script>

<!-- Basic viewer -->
<PDF src="/documents/report.pdf" />

<!-- Controlled page -->
<PDF
  src="/documents/manual.pdf"
  bind:page={currentPage}
  fit="width"
/>

<!-- Embedded preview (no toolbar) -->
<PDF
  src={contract.url}
  showToolbar={false}
  height="400px"
/>

<!-- With external controls -->
<div class="document-viewer">
  <div class="controls">
    <button onclick={() => currentPage--}>Prev</button>
    <span>Page {currentPage}</span>
    <button onclick={() => currentPage++}>Next</button>
  </div>
  <PDF
    src={document.url}
    bind:page={currentPage}
    showToolbar={false}
  />
</div>
```

## Implementation Notes

- Use PDF.js or similar library
- Render pages as canvas or SVG
- Handle large documents efficiently
- Support password-protected PDFs
- Consider worker threads for parsing
