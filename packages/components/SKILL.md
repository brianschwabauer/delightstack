---
name: delightstack
description: Use DelightStack (@delightstack/components) when building UI in this project — a Svelte 5 component library with 50+ accessible, themeable components. Consult this skill when adding, styling, or wiring up any UI component, form, dialog, media viewer, or navigation element.
---

# DelightStack components

DelightStack is this project's component library: 50+ Svelte 5 components built on
runes, with theming via CSS design tokens. Prefer a DelightStack component over
hand-rolling UI or adding another UI dependency.

## Setup (skip if already installed)

```bash
pnpm add @delightstack/components @delightstack/styles
```

Import the design tokens once at the app root (e.g. the root `+layout.svelte`):

```ts
import '@delightstack/styles';
```

## Core conventions

- **Single import point:** `import { Button, Input, Modal } from '@delightstack/components';`
  Unused components are tree-shaken; there is no need for sub-path imports — with two
  exceptions: `PDF` imports from `@delightstack/components/pdf` and `Panorama` from
  `@delightstack/components/panorama` (they have heavy optional peer deps).
- **Props are snake_case, callbacks are camelCase:** `snap_points`, `max_width`,
  `morph_percent` vs `onclick`, `onchange`, `onsubmit`. This is intentional — do not
  "fix" it.
- **Callback props, not dispatched events.** When a callback returns a Promise, the
  component automatically shows a loading state (e.g. `<Button onclick={save}>` spins
  until `save()` resolves).
- **Two-way binding** with `bind:value` on form components, plus component-specific
  bindables like `bind:open` (Modal, BottomSheet), `bind:snap`, `bind:page`.
- **Entity-backed forms:** when the data lives in a `Database.table()` (from
  `@delightstack/database`), pass the entity to the Form and spread its field props —
  `<Form entity={person}><Input {...person.form.field.email} /></Form>`. No
  `bind:value`, no schema, no submit handler: values flow through the form context
  (a field with a `name` and no `value`/`checked` prop is context-driven), each
  field validates via its spread `parse`, and submit normalizes the draft then calls
  `entity.save()` (`onsaved` fires on success; submit Buttons auto-disable while
  saving). Works for create (`db.entity('person')`, no id) and edit. Boolean fields
  spread onto `Checkbox` or `Toggle`, enum fields onto `Select` (the spread includes
  ready-made `options`). Optional non-defaulted booleans are tri-state: unanswered
  (`null`) displays as indeterminate — Checkbox resolves to checked on click (native
  behavior) while Toggle gets a three-stop track the user can cycle back to the
  middle; defaulted booleans display (and save) their default when unanswered. Standalone (no Form), `Input`/`Select` run `parse` on blur/close and
  show the message below the field. Full guide:
  https://docs.thedelight.co/guides/forms.md
- **Svelte 5 snippets** (`{#snippet header()}…{/snippet}`), not slots, for named
  content areas.
- **Theming:** components read CSS custom properties from `@delightstack/styles`.
  Re-theme by overriding `--color-primary` (re-derives the palette) or individual
  tokens (`--color-action`, `--radius-md`, …) in your own CSS. Dark mode is built in
  via `light-dark()` token values — never hardcode colors next to components.
- **Optional peer deps:** `three` (Panorama) and `pdfjs-dist` (PDF) must be installed
  by the consuming app. They are dynamically imported; in Vite dev, add them to
  `optimizeDeps.include` so they are not stubbed as absent.
- **TypeScript:** prop and data types ship with the package —
  `import type { SelectOption, TableColumn, TreeNode, … } from '@delightstack/components';`

## Looking up a component's full API

Every docs page is available as plain markdown. Fetch
`https://docs.thedelight.co/<docs path>` from the index below — each page includes
usage examples plus complete Props / Events / CSS Variables / Accessibility tables.
Also available: `https://docs.thedelight.co/llms.txt` (index) and `/llms-full.txt`
(all docs in one file). When in doubt about a prop name or type, check the docs page,
or read the component source shipped in `node_modules/@delightstack/components/dist/`
— the `.svelte` files there carry full JSDoc on every prop, and the `.d.ts` files
have the exact types. Do not guess prop names.

## Component index

### Actions
- `Button` — Polished button with ripple, promise-aware loading, dropdown menus, confirmation flows (docs: /components/actions/button.md)
- `ButtonGroup` — Groups related buttons with shared borders and context-driven prop inheritance (docs: /components/actions/button-group.md)
- `Modal` — Dialog overlay with animations, focus trapping, backdrop blur, crossfade transitions (docs: /components/actions/modal.md)
- `Alert` — Confirmation dialog built on Modal; programmatic yes/no `alert()` API (docs: /components/actions/alert.md)
- `Popover` — Floating container with Floating UI positioning, trigger modes, hover-safe diagonal movement (docs: /components/actions/popover.md)
- `ContextMenu` — Right-click menu via `{@attach contextMenu()}` attachment (docs: /components/actions/context-menu.md)
- `Portal` — Renders children elsewhere in the DOM, escaping overflow and stacking contexts (docs: /components/actions/portal.md)
- `CommandPalette` — Keyboard command interface with fuzzy search, recents, categories (docs: /components/actions/command-palette.md)
- `ThemeToggle` — Light/dark/auto theme switcher with animated sun-moon morph (docs: /components/actions/theme-toggle.md)

### Display
- `Accordion` / `AccordionItem` — Stacked collapsible sections on semantic details/summary (docs: /components/display/accordion.md)
- `Avatar` — Profile image with initials fallback, status indicators, deterministic colors (docs: /components/display/avatar.md)
- `AvatarGroup` — Stacked overlapping avatars with overflow indicator (docs: /components/display/avatar-group.md)
- `Calendar` — Date display/selection with single, range, and multiple modes (docs: /components/display/calendar.md)
- `Chart` — Data visualization: line, area, bar, horizontal bar, pie, donut (docs: /components/display/chart.md)
- `Code` — Syntax-highlighted code block with line numbers, copy, diff display (docs: /components/display/code.md)
- `Comparison` — Before/after image slider using CSS clip-path reveal (docs: /components/display/comparison.md)
- `Counter` — Animated count-up/down number with scroll-into-view trigger (docs: /components/display/counter.md)
- `Expand` — Animated expand/collapse container (docs: /components/display/expand.md)
- `List` / `ListItem` — Selection-aware list; items act as buttons, radios, checkboxes, submenus (docs: /components/display/list.md, /components/display/list-item.md)
- `QR` — QR code generator rendering crisp SVGs with colors, logo overlay, download (docs: /components/display/qr.md)
- `SplitPane` — Resizable two-pane split with drag, keyboard, snap, collapse (docs: /components/display/split-pane.md)
- `Stat` — Key metric display with labels, icons, change indicators (docs: /components/display/stat.md)
- `Table` — Data table: sorting, pagination, selection, inline editing, CSV/JSON export (docs: /components/display/table.md)
- `Timeline` / `TimelineItem` — Chronological events, vertical/horizontal, scroll-reveal (docs: /components/display/timeline.md)
- `Tree` — Hierarchical data with expand/collapse, checkboxes, drag-and-drop, lazy loading, search (docs: /components/display/tree.md)
- `Typewriter` — Character-by-character typing animation with text cycling (docs: /components/display/typewriter.md)

### Feedback
- `Callout` — Highlighted information block; inline callouts or full-width banners (docs: /components/feedback/callout.md)
- `Confetti` — Canvas confetti celebration; programmatic `confetti()` or declarative component (docs: /components/feedback/confetti.md)
- `Progress` — Unified loading indicator: circular spinners, linear bars, overlays (docs: /components/feedback/progress.md)
- `Toaster` — Toast container; notifications created programmatically via `toast()` (docs: /components/feedback/toast.md)

### Form
- `Checkbox` — Styled checkbox with animated checkmark and indeterminate state (docs: /components/form/checkbox.md)
- `Fieldset` — Semantic form-field grouping with optional border, grid layout, collapsible sections (docs: /components/form/fieldset.md)
- `FileUpload` — Drag-and-drop file upload with previews; dropzone, compact, avatar variants (docs: /components/form/file-upload.md)
- `Form` — Form container with Standard Schema validation, field-level validators, promise-aware submit, error auto-focus (docs: /components/form/form.md)
- `Input` — 13 input types with floating labels, autocomplete, chips, masking, password strength, `parse` validation (docs: /components/form/input.md)
- `Radio` / `RadioGroup` — Styled radio buttons, standalone or grouped (docs: /components/form/radio.md)
- `Range` — Slider with two-thumb range mode, tick marks, value tooltips (docs: /components/form/range.md)
- `Rating` — Star rating input with half-star precision, custom icons, read-only mode (docs: /components/form/rating.md)
- `Select` — Dropdown with search, multi-select chips, groups, async loading, virtual scrolling (docs: /components/form/select.md)
- `Toggle` — On/off switch with slide animation, three-state mode, `parse` validation (docs: /components/form/toggle.md)

### Media
- `Gallery` — Media gallery with seven display modes plus headless lightbox (docs: /components/media/gallery.md)
- `Carousel` — Low-level media viewport behind Gallery: swipe, pinch-zoom, mixed media (docs: /components/media/carousel.md)
- `Image` — Optimized image with lazy loading, blur-up placeholder, skeleton shimmer (docs: /components/media/image.md)
- `Panorama` — Three.js 360° viewer; import from `@delightstack/components/panorama` (docs: /components/media/panorama.md)
- `PDF` — Full PDF viewer; import from `@delightstack/components/pdf` (docs: /components/media/pdf.md)
- `Video` — Custom video player with HLS quality switching, captions, PiP (docs: /components/media/video.md)

### Navigation
- `BottomSheet` — Mobile slide-up panel with snap points, spring gestures, pull-to-dismiss (docs: /components/navigation/bottom-sheet.md)
- `Breadcrumbs` — Navigation trail with auto home icon and SSR-safe collapsing (docs: /components/navigation/breadcrumbs.md)
- `Pagination` — Page navigation with ellipsis algorithm and page size selector (docs: /components/navigation/pagination.md)
- `Steps` / `Step` — Multi-step progress indicator with animated wizard mode, error states, and horizontal overflow paging (docs: /components/navigation/steps.md)
- `Tabs` — Data-driven tabbed navigation (`tabs={[{ label, badge, disabled, content }]}` + `bind:tab` index); spring sliding indicator; underline / pills / boxed (segmented) variants; vertical orientation; ripple feedback; fade/slide content transitions (docs: /components/navigation/tabs.md)

## Beyond components

DelightStack also ships a Cloudflare-native backend stack (`@delightstack/auth`,
`database`, `websocket`, `ai`, `stripe`, `images`, `rate-limiter`). Overview:
https://docs.thedelight.co/stack/overview.md
