# PDF

**Category**: Media
**File**: `packages/components/src/media/PDF.svelte`

## Description

A PDF document viewer built on [PDF.js](https://mozilla.github.io/pdf.js/) for displaying PDF files within the application. Provides page navigation, zoom controls, text search, annotation support (highlight and note), and mobile pinch-zoom. PDF.js is lazy-loaded to avoid bundling the full library upfront.

## Dependencies

- **PDF.js** (`pdfjs-dist`) -- Mozilla's PDF rendering library; lazy-loaded via dynamic `import()` on component mount. The PDF.js worker (`pdf.worker.js`) must also be loaded asynchronously (configured via `pdfjsLib.GlobalWorkerOptions.workerSrc`). Do not include in the main application bundle.
- **`@delightstack/utilities`**:
  - `lazyLoad` -- handles the dynamic import of PDF.js with loading state management

## Visual Design

### Container
- Document pages centered vertically, scrollable
- Page shadows for visual separation (`--shadow-sm`)
- Responsive width (fits container, never exceeds page width)
- Configurable height with internal scroll

### Toolbar
- Positioned at top
- Page navigation: previous/next buttons, page number input, total page count
- Zoom controls: zoom in, zoom out, fit-to-width / fit-to-page dropdown
- Search button (opens search bar)
- Download button (optional)
- Annotation mode toggle
- Compact layout on mobile

### Search Bar
- Slides in below toolbar when activated
- Text input with match count ("3 of 17")
- Previous/Next match buttons
- Close button
- Highlight all matches in the document

### Pages
- Rendered as `<canvas>` elements with a text layer overlay for selection
- Page number labels between pages
- Smooth scroll between pages

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string \| ArrayBuffer \| Uint8Array` | required | PDF source: URL, ArrayBuffer, or typed array |
| `page` | `number` | `1` | Current page number (`$bindable()`) |
| `zoom` | `number` | `1` | Zoom level where `1` is 100% (`$bindable()`) |
| `rotation` | `number` | `0` | Page rotation in degrees (0, 90, 180, 270) |
| `fit` | `'width' \| 'height' \| 'page'` | `'width'` | Fit mode for initial zoom |
| `showToolbar` | `boolean` | `true` | Show the toolbar |
| `showDownload` | `boolean` | `true` | Show download button in toolbar |
| `searchable` | `boolean` | `true` | Enable text search |
| `annotatable` | `boolean` | `false` | Enable annotation tools (highlight, note) |
| `height` | `string` | `'600px'` | Viewer container height |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `element` | `HTMLElement` | - | Bind to the container DOM element (`$bindable()`) |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onpagechange` | `{ page: number, totalPages: number }` | Current page changed |
| `onload` | `{ totalPages: number }` | PDF loaded and first page rendered |
| `onerror` | `{ error: Error }` | Failed to load or render PDF |
| `ondownload` | - | Download button clicked |
| `onannotation` | `{ type: 'highlight' \| 'note', page: number, data: any }` | Annotation created or updated |

## Features

### Lazy-Loaded PDF.js
PDF.js is loaded via dynamic `import()` when the component mounts. The worker is configured to load from a CDN or local path:

```js
const pdfjsLib = await import('pdfjs-dist');
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
```

While loading, the component shows:
- Skeleton shimmer when `skeleton` is true
- Spinner overlay otherwise
- Toolbar is disabled until PDF.js is ready

### Page Navigation
- Previous/Next buttons in toolbar
- Direct page number input (type a number, press Enter)
- Keyboard shortcuts: Left/Right arrows, Page Up/Page Down
- Scroll-based navigation: scrolling through the document updates the current page
- `page` is bindable for external control

```svelte
<script>
  let currentPage = $state(1);
</script>
<PDF src="/report.pdf" bind:page={currentPage} />
<p>Viewing page {currentPage}</p>
```

### Zoom Controls
- Zoom in (+) and Zoom out (-) buttons
- Fit mode selector: fit to width, fit to height, fit whole page
- Keyboard shortcuts: Ctrl/Cmd + Plus/Minus
- Zoom range: 25% to 400%
- `zoom` is bindable for external control

### Mobile Pinch-Zoom
- Touch pinch gesture adjusts zoom level
- Zooms centered on pinch midpoint
- Smooth animation during gesture
- Respects zoom limits (25% to 400%)
- Pan with one finger when zoomed in

### Search Within PDF
```svelte
<PDF src="/manual.pdf" searchable />
```
- Activated via toolbar search button or Ctrl/Cmd+F
- Uses PDF.js text layer to find matches
- All matches highlighted in the document with a translucent overlay
- Current match highlighted distinctly
- Previous/Next navigation between matches
- Match count displayed ("3 of 17 matches")
- Case-insensitive by default

### Text Selection
- PDF.js renders an invisible text layer over the canvas
- Users can select and copy text naturally
- Selection styling matches the design system

### Annotations
```svelte
<PDF src="/contract.pdf" annotatable onannotation={handleAnnotation} />
```
When `annotatable` is true, the toolbar shows annotation tools:

**Highlight**:
- Select text, then click "Highlight" or use the highlight tool
- Highlight color uses `--color-action` at 30% opacity
- Persisted highlights re-rendered on page render

**Note**:
- Click a position on the page to place a note marker
- A small icon appears at the position
- Click the icon to open a text input popover
- Notes include page number, position, and text content

Annotations are emitted via `onannotation` for the consumer to persist. The component accepts annotations back to re-render them but does not handle storage.

### Download
- Download button in toolbar (when `showDownload` is true)
- Triggers native browser download of the PDF
- Fires `ondownload` event

## Delightful Details

### Page Rendering
- Pages rendered progressively as user scrolls
- Only visible pages and one page above/below are rendered (virtualized)
- Off-screen pages are destroyed to save memory
- Re-rendered when scrolled back into view

### Loading States
- Skeleton shimmer before PDF.js loads
- Per-page skeleton while individual pages render
- Toolbar shows spinner during initial load

### Smooth Scroll Navigation
- Clicking Previous/Next scrolls smoothly to the target page
- `scroll-behavior: smooth` on the page container
- Page snapping optional

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Left / Page Up | Previous page |
| Right / Page Down | Next page |
| Home | First page |
| End | Last page |
| Ctrl/Cmd + Plus | Zoom in |
| Ctrl/Cmd + Minus | Zoom out |
| Ctrl/Cmd + 0 | Reset zoom |
| Ctrl/Cmd + F | Open search |
| Escape | Close search |

### Print Support
- Ctrl/Cmd + P triggers browser print with proper PDF rendering
- Hidden print stylesheet ensures clean output

### Toolbar Responsiveness
- On narrow viewports, toolbar collapses non-essential buttons into an overflow menu
- Page input and zoom remain visible
- Download and annotation tools move to overflow

## Accessibility

- Keyboard navigation for all toolbar controls and pages
- `role="document"` on the page container
- `aria-label` on toolbar buttons ("Go to previous page", "Zoom in", etc.)
- Page changes announced via `aria-live="polite"` ("Page 3 of 12")
- Search results announced ("3 of 17 matches found")
- Focus management: search bar receives focus when opened, returns to toolbar on close
- Text layer enables screen reader access to PDF content

## Code Example

```svelte
<script>
  import { PDF } from '@delightstack/components';

  let { documentUrl } = $props();
  let currentPage = $state(1);
  let currentZoom = $state(1);
</script>

<!-- Basic viewer -->
<PDF src="/documents/report.pdf" />

<!-- Controlled page and zoom -->
<PDF
  src="/documents/manual.pdf"
  bind:page={currentPage}
  bind:zoom={currentZoom}
  fit="width"
/>

<!-- With search and annotations -->
<PDF
  src="/documents/contract.pdf"
  searchable
  annotatable
  onannotation={saveAnnotation}
/>

<!-- Embedded preview (no toolbar) -->
<PDF
  src={documentUrl}
  showToolbar={false}
  height="400px"
/>

<!-- External controls -->
<div class="viewer">
  <div class="controls">
    <button onclick={() => currentPage--}>Previous</button>
    <span>Page {currentPage}</span>
    <button onclick={() => currentPage++}>Next</button>
  </div>
  <PDF src={documentUrl} bind:page={currentPage} showToolbar={false} />
</div>

<!-- Skeleton state -->
<PDF skeleton height="600px" />
```

## CSS Approach

```css
.pdf-container {
  position: relative;
  width: 100%;
  height: var(--pdf-height, 600px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: light-dark(var(--color-surface-sunken), var(--color-surface-sunken));
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: light-dark(var(--color-surface), var(--color-surface));
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.pdf-toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.pdf-toolbar-separator {
  width: 1px;
  height: 1.5rem;
  background: var(--color-border);
  margin-inline: 0.25rem;
}

.pdf-page-input {
  width: 3rem;
  text-align: center;
  padding: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  background: light-dark(var(--color-surface), var(--color-surface));
  color: var(--color-text);
}

.pdf-pages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.pdf-page {
  position: relative;
  box-shadow: var(--shadow-sm);
  background: white;
}

.pdf-page canvas {
  display: block;
}

.pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 0.25;
  line-height: 1;
}

.pdf-search-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: light-dark(var(--color-surface-raised), var(--color-surface-raised));
  border-bottom: 1px solid var(--color-border);
}

.pdf-search-input {
  flex: 1;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  background: light-dark(var(--color-surface), var(--color-surface));
  color: var(--color-text);
}

.pdf-search-count {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.pdf-highlight {
  background: color-mix(in oklch, var(--color-action) 30%, transparent);
  position: absolute;
  pointer-events: none;
}

.pdf-annotation-note {
  position: absolute;
  width: 24px;
  height: 24px;
  background: var(--color-warning);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
}
```
