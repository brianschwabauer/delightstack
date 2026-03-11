# DelightStack Component Library

A polished, opinionated Svelte 5 component library focused on **delightful user experiences**. Every component is crafted with attention to detail, thoughtful micro-animations, and a cohesive visual language.

## Design Philosophy

- **Details Matter**: Every pixel, every transition, every interaction is intentional
- **Delight Users**: Subtle animations, smooth transitions, and unexpected moments of joy
- **Opinionated by Default**: Components look great out of the box with sensible defaults
- **Self-Contained**: Each component is readable and maintainable in a single file
- **Modern CSS**: Plain CSS with custom properties, `light-dark()`, `color-mix()`, and container queries

---

## Design System

### Color Tokens

Colors use semantic naming with the `--color-` prefix. Dark mode is handled via the CSS `light-dark()` function, which automatically switches based on the `color-scheme` property.

#### Base Colors

```css
:root {
	color-scheme: light dark;

	/* Background colors */
	--color-bg: light-dark(#ffffff, #0a0a0a);
	--color-bg-subtle: light-dark(#f5f5f5, #141414);
	--color-bg-muted: light-dark(#e5e5e5, #262626);
	--color-bg-disabled: light-dark(#f5f5f5, #1a1a1a);

	/* Text colors */
	--color-text: light-dark(#171717, #fafafa);
	--color-text-muted: light-dark(#525252, #a3a3a3);
	--color-text-disabled: light-dark(#a3a3a3, #525252);

	/* Borders */
	--color-border: light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.1));
	--color-border-strong: light-dark(rgb(0 0 0 / 0.2), rgb(255 255 255 / 0.2));
	--color-border-disabled: light-dark(rgb(0 0 0 / 0.05), rgb(255 255 255 / 0.05));

	/* Surfaces - elevated layers get lighter in dark mode */
	--color-surface-1: light-dark(#ffffff, #0a0a0a);
	--color-surface-2: light-dark(#fafafa, #141414);
	--color-surface-3: light-dark(#f5f5f5, #1f1f1f);
	--color-surface-4: light-dark(#e5e5e5, #292929);
}
```

#### Interactive Colors

Define only the base color - all states derive automatically via relative color syntax:

```css
:root {
	/* Action color - only define the base */
	--color-action: light-dark(#2563eb, #3b82f6);

	/* Auto-derived hover/active states (darker) */
	--color-action-hover: oklch(from var(--color-action) calc(l - 0.05) c h);
	--color-action-active: oklch(from var(--color-action) calc(l - 0.1) c h);

	/* Auto-derived text: tinted off-white (same hue, low chroma, high lightness) */
	--color-action-text: oklch(from var(--color-action) 0.92 calc(c * 0.15) h);
	--color-action-text-hover: white;

	/* Accent color - same pattern */
	--color-accent: light-dark(#7c3aed, #a78bfa);
	--color-accent-hover: oklch(from var(--color-accent) calc(l - 0.05) c h);
	--color-accent-active: oklch(from var(--color-accent) calc(l - 0.1) c h);
	--color-accent-text: oklch(from var(--color-accent) 0.92 calc(c * 0.15) h);
	--color-accent-text-hover: white;
}
```

The text color formula `oklch(from var(...) 0.92 calc(c * 0.15) h)` creates a barely-tinted off-white that subtly matches the button color. On hover, it becomes pure white - a "revelation" effect that makes the interaction feel intentional.

#### Semantic Feedback Colors

```css
:root {
	/* Base feedback colors */
	--color-success: light-dark(#16a34a, #22c55e);
	--color-warning: light-dark(#ca8a04, #facc15);
	--color-error: light-dark(#dc2626, #ef4444);
	--color-info: light-dark(#0891b2, #06b6d4);

	/* Soft backgrounds for callouts/alerts */
	--color-success-bg: light-dark(#f0fdf4, #052e16);
	--color-warning-bg: light-dark(#fefce8, #422006);
	--color-error-bg: light-dark(#fef2f2, #450a0a);
	--color-info-bg: light-dark(#ecfeff, #083344);
}
```

#### Selection & Focus

```css
:root {
	/* Selection highlight (list items, text selection) */
	--color-selection: color-mix(in oklch, var(--color-action) 15%, transparent);
	--color-selection-strong: color-mix(in oklch, var(--color-action) 25%, transparent);

	/* Focus ring */
	--color-focus-ring: var(--color-action);
	--focus-ring-width: 2px;
	--focus-ring-offset: 2px;
}
```

#### Backdrop & Overlay

```css
:root {
	/* Modal backdrop - darker in dark mode for contrast */
	--color-backdrop: light-dark(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.7));
	--backdrop-blur: 8px;

	/* Light overlay for hover states on cards, etc. */
	--color-overlay-hover: light-dark(rgb(0 0 0 / 0.03), rgb(255 255 255 / 0.03));
}
```

Use `backdrop-filter: blur(var(--backdrop-blur))` strategically for modals to focus user attention. Don't blur for small popovers or menus.

### Border Radius

```css
:root {
	--radius-none: 0;
	--radius-sm: 0.25rem; /* 4px - subtle rounding */
	--radius-md: 0.5rem; /* 8px - default for most elements */
	--radius-lg: 0.75rem; /* 12px - cards, modals */
	--radius-xl: 1rem; /* 16px - large containers */
	--radius-2xl: 1.5rem; /* 24px - prominent elements */
	--radius-full: 9999px; /* pill shape */
}
```

### Elevation (Shadows & Borders)

Shadows work well in light mode but look muddy in dark mode. Instead, dark mode uses stronger borders and subtle inset highlights to indicate elevation.

```css
:root {
	/*
	 * Light mode: traditional shadows
	 * Dark mode: subtle inset top highlight (frosted glass edge effect)
	 */
	--shadow-sm: light-dark(
		0 1px 2px 0 rgb(0 0 0 / 0.05),
		inset 0 1px 0 0 rgb(255 255 255 / 0.04)
	);
	--shadow-md: light-dark(
		0 4px 6px -1px rgb(0 0 0 / 0.1),
		inset 0 1px 0 0 rgb(255 255 255 / 0.06)
	);
	--shadow-lg: light-dark(
		0 10px 15px -3px rgb(0 0 0 / 0.1),
		inset 0 1px 0 0 rgb(255 255 255 / 0.08)
	);
	--shadow-xl: light-dark(
		0 20px 25px -5px rgb(0 0 0 / 0.1),
		inset 0 1px 0 0 rgb(255 255 255 / 0.1)
	);

	/*
	 * Border strength increases with elevation in dark mode
	 * Components should use: border: 1px solid var(--border-elevated-N)
	 */
	--border-elevated-1: light-dark(var(--color-border), var(--color-border));
	--border-elevated-2: light-dark(var(--color-border), var(--color-border-strong));
	--border-elevated-3: light-dark(var(--color-border), rgb(255 255 255 / 0.15));
	--border-elevated-4: light-dark(var(--color-border), rgb(255 255 255 / 0.18));
}
```

**Pattern for elevated components:**
```css
.card {
	background: var(--color-surface-2);
	border: 1px solid var(--border-elevated-2);
	box-shadow: var(--shadow-md);
}

.modal {
	background: var(--color-surface-3);
	border: 1px solid var(--border-elevated-3);
	box-shadow: var(--shadow-xl);
}
```

### Z-Index Layers

```css
:root {
	--layer-base: 0;
	--layer-dropdown: 100;
	--layer-sticky: 200;
	--layer-drawer: 300;
	--layer-modal: 400;
	--layer-popover: 500;
	--layer-toast: 600;
	--layer-tooltip: 700;
}
```

### Typography

```css
:root {
	--font-sans:
		ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
	--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;

	/* Type scale (major second - 1.125) */
	--text-xs: 0.75rem; /* 12px */
	--text-sm: 0.875rem; /* 14px */
	--text-base: 1rem; /* 16px */
	--text-lg: 1.125rem; /* 18px */
	--text-xl: 1.25rem; /* 20px */
	--text-2xl: 1.5rem; /* 24px */
	--text-3xl: 1.875rem; /* 30px */
	--text-4xl: 2.25rem; /* 36px */

	--font-weight-normal: 400;
	--font-weight-medium: 500;
	--font-weight-semibold: 600;
	--font-weight-bold: 700;

	--leading-tight: 1.25;
	--leading-normal: 1.5;
	--leading-relaxed: 1.75;
}
```

### Transitions

```css
:root {
	--duration-fast: 100ms;
	--duration-normal: 200ms;
	--duration-slow: 300ms;
	--duration-slower: 500ms;

	--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
	--ease-in: cubic-bezier(0.4, 0, 1, 1);
	--ease-out: cubic-bezier(0, 0, 0.2, 1);
	--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
	--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
```

---

## Responsive Strategy

### Container Queries for Components

Components should use **container queries** for internal responsiveness rather than viewport media queries. This makes components truly portable—they adapt to their available space, not the screen size.

```css
/* Make a component a container */
.card {
	container-type: inline-size;
	container-name: card;
}

/* Respond to container size */
@container card (width < 300px) {
	.card-content {
		flex-direction: column;
	}
}

/* Use container query units */
.card-title {
	font-size: clamp(1rem, 3cqi, 1.5rem);
}
```

### When to Use Container Queries

- **Internal layout changes** within a component (card layouts, list items)
- **Font size adjustments** based on available space
- **Showing/hiding elements** based on container width
- **Grid column adjustments** within a component

### When to Use Media Queries

- **Page-level layout changes** (sidebar collapse, navigation mode)
- **Global typography changes**
- **Full-width components** that truly depend on viewport

### Breakpoint Tokens (for media queries when needed)

```css
/* Use these sparingly - prefer container queries */
--breakpoint-sm: 640px;
--breakpoint-md: 768px;
--breakpoint-lg: 1024px;
--breakpoint-xl: 1280px;
```

---

## Components

### Actions

Interactive elements that trigger behaviors.

| Component                                     | Status         | Description                                                        |
| --------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| [Button](./actions/Button.md)                 | ✅ Complete    | Versatile button with ripple effects, loading states, and variants |
| [ButtonGroup](./actions/ButtonGroup.md)       | ✅ Complete    | Connected button container with shared borders                     |
| [Modal](./actions/Modal.md)                   | ✅ Complete    | Dialog overlay with transitions and focus management               |
| [Alert](./actions/Alert.md)                   | ✅ Complete    | Confirmation dialog built on Modal                                 |
| [Popover](./actions/Popover.md)               | ✅ Complete    | Floating content with smart positioning                            |
| [ContextMenu](./actions/ContextMenu.md)       | ✅ Complete    | Right-click menu system                                            |
| [Portal](./actions/Portal.md)                 | ✅ Complete    | Render children in different DOM locations                         |
| [CommandPalette](./actions/CommandPalette.md) | 📋 Planned | Keyboard-driven command interface                                  |
| [ThemeToggle](./actions/ThemeToggle.md)       | ✅ Complete    | Light/dark/auto theme switcher                                     |

### Display

Components for presenting information.

| Component                                | Status         | Description                                    |
| ---------------------------------------- | -------------- | ---------------------------------------------- |
| [Expand](./display/Expand.md)            | ✅ Complete    | Animated show/hide container                   |
| [List](./display/List.md)                | ✅ Complete    | Flexible list container with selection modes   |
| [ListItem](./display/ListItem.md)        | ✅ Complete    | Rich list item with multiple interaction types |
| [Accordion](./display/Accordion.md)      | 📋 Planned | Collapsible content sections                   |
| [Avatar](./display/Avatar.md)            | ✅ Complete    | User/entity profile image                      |
| [AvatarGroup](./display/AvatarGroup.md)  | 📋 Planned | Stacked overlapping avatars                    |
| [Calendar](./display/Calendar.md)        | 📋 Planned | Date display and selection                     |
| [Chart](./display/Chart.md)              | 📋 Planned | Data visualization                             |
| [Code](./display/Code.md)                | 📋 Planned | Syntax-highlighted code block                  |
| [Comparison](./display/Comparison.md)    | ✅ Complete    | Before/after image slider                      |
| [Counter](./display/Counter.md)          | ✅ Complete    | Animated number display                        |
| [QR](./display/QR.md)                    | ✅ Complete    | QR code generator                              |
| [SplitPane](./display/SplitPane.md)      | 📋 Planned | Resizable split view                           |
| [Stat](./display/Stat.md)                | 📋 Planned | Key metric display                             |
| [Table](./display/Table.md)              | 📋 Planned | Data table with sorting/filtering              |
| [Timeline](./display/Timeline.md)        | 📋 Planned | Chronological event display                    |
| [Tree](./display/Tree.md)                | 📋 Planned | Hierarchical data display                      |
| [Typewriter](./display/Typewriter.md)    | ✅ Complete    | Animated text typing effect                    |

### Feedback

Components that communicate state and progress.

| Component                          | Status         | Description                                          |
| ---------------------------------- | -------------- | ---------------------------------------------------- |
| [Callout](./feedback/Callout.md)   | 📋 Planned | Highlighted information block (inline + banner mode) |
| [Confetti](./feedback/Confetti.md) | ✅ Complete    | Celebration animation                                |
| [Progress](./feedback/Progress.md) | ✅ Complete    | Progress bar, spinner, and loading indicator          |
| [Toast](./feedback/Toast.md)       | 📋 Planned | Temporary notification messages                      |

### Form

Input components for user data entry.

| Component                          | Status         | Description                         |
| ---------------------------------- | -------------- | ----------------------------------- |
| [Input](./form/Input.md)          | ✅ Complete    | Comprehensive text/data input field |
| [Checkbox](./form/Checkbox.md)    | ✅ Complete    | Boolean toggle with check mark      |
| [Fieldset](./form/Fieldset.md)    | ✅ Complete    | Form section grouping               |
| [FileUpload](./form/FileUpload.md)| 📋 Planned | Drag-and-drop file input            |
| [Form](./form/Form.md)            | 📋 Planned | Form container with validation      |
| [Radio](./form/Radio.md)          | ✅ Complete    | Single-select option                |
| [Range](./form/Range.md)          | ✅ Complete    | Slider input                        |
| [Rating](./form/Rating.md)        | ✅ Complete    | Star/score input                    |
| [Select](./form/Select.md)        | 📋 Planned | Dropdown selection                  |
| [Toggle](./form/Toggle.md)        | ✅ Complete    | On/off switch                       |

### Media

Components for rich media content.

| Component                       | Status         | Description                         |
| ------------------------------- | -------------- | ----------------------------------- |
| [Carousel](./media/Carousel.md) | 📋 Planned | Swipeable image/content slider      |
| [Gallery](./media/Gallery.md)   | 📋 Planned | Image grid with lightbox            |
| [Image](./media/Image.md)       | ✅ Complete    | Optimized image with loading states |
| [Map](./media/Map.md)           | 📋 Planned | Interactive map display             |
| [Panorama](./media/Panorama.md) | 📋 Planned | 360° image viewer                   |
| [PDF](./media/PDF.md)           | 📋 Planned | PDF document viewer                 |
| [Video](./media/Video.md)       | 📋 Planned | Video player with controls          |

### Navigation

Components for moving through the application.

| Component                                  | Status         | Description                   |
| ------------------------------------------ | -------------- | ----------------------------- |
| [BottomSheet](./navigation/BottomSheet.md) | 📋 Planned | Mobile-style slide-up panel   |
| [Breadcrumbs](./navigation/Breadcrumbs.md) | 📋 Planned | Hierarchical navigation trail |
| [Drawer](./navigation/Drawer.md)           | 📋 Planned | Slide-out side panel          |
| [Menu](./navigation/Menu.md)               | 📋 Planned | Dropdown menu                 |
| [Pagination](./navigation/Pagination.md)   | 📋 Planned | Page navigation controls      |
| [Steps](./navigation/Steps.md)             | 📋 Planned | Multi-step progress indicator |
| [Tabs](./navigation/Tabs.md)               | 📋 Planned | Tabbed content switcher       |

---

## Components in Other Packages

Some components live outside the core `@delightstack/components` package:

| Component | Package | Description |
| --------- | ------- | ----------- |
| Chat | `@delightstack/chat` | Conversation display with message grouping, typing indicators |
| ChatBubble | `@delightstack/chat` | Individual message bubble with reactions, content types |
| IconSelector | `@delightstack/recipes` | Searchable icon picker popover |
| MediaSelector | `@delightstack/recipes` | Media library browser modal |

Additionally, the **Format** utility (date, number, currency, relative time formatting) lives in `@delightstack/utilities` as the `formatToString()` function.

---

## Implementation Progress

| Category       | Complete | Placeholder | Total  |
| -------------- | -------- | ----------- | ------ |
| Actions        | 8        | 1           | 9      |
| Display        | 8        | 10          | 18     |
| Feedback       | 2        | 2           | 4      |
| Form           | 7        | 3           | 10     |
| Media          | 1        | 6           | 7      |
| Navigation     | 0        | 7           | 7      |
| **Total**      | **26**   | **29**      | **55** |

---

## Dependency Graph

Components depend on each other. This graph shows internal dependencies (arrows point from dependency → dependent):

```
Portal ← Modal ← Alert
                ← CommandPalette
                ← Gallery (lightbox)

Popover ← ContextMenu
        ← Menu
        ← Select (dropdown)
        ← Input (autocomplete popover)
        ← Breadcrumbs (overflow menu)

Expand ← Accordion

List + ListItem ← Menu (items)
                ← Select (options)
                ← CommandPalette (results)
                ← Tree (nodes)

Progress ← Button (loading state)
         ← FileUpload (upload progress)

Avatar ← AvatarGroup

Counter ← Stat

Pagination ← Table

Button ← ButtonGroup
       ← Alert (actions)
       ← Modal (footer actions)
```

---

## Implementation Order

Build components in dependency order. Each phase depends on the previous.

### Phase 1 — Foundations

No component dependencies. Build these first.

Portal, Expand, Progress, Avatar, Counter, QR, Typewriter, Confetti, Comparison, Image

### Phase 2 — Core Interactive

Minimal dependencies (mostly standalone).

Button, ButtonGroup, Input, Checkbox, Radio, Toggle, Range, Rating, Fieldset, ThemeToggle

### Phase 3 — Overlays & Lists

Depend on Portal and/or Popover.

Modal, Popover, Alert, List, ListItem, Callout, Toast

### Phase 4 — Composed Components

Depend on Phase 3 components.

Menu, ContextMenu, Select, Accordion, Tabs, Breadcrumbs, Pagination, Steps, Drawer, BottomSheet, FileUpload, Form

### Phase 5 — Data & Complex Display

Depend on Phase 4 components.

Table, Tree, Calendar, Code, Timeline, Stat, AvatarGroup, SplitPane, CommandPalette, Chart

### Phase 6 — Media

Mostly independent but lower priority.

Video, Gallery, Carousel, Map, Panorama, PDF

---

## Usage

```svelte
<script>
	import { Button, Modal, Input } from '@delightstack/components';
</script>

<Button onclick={() => console.log('clicked!')}>Click Me</Button>
```

## Conventions

### Props

- Use `$props()` with TypeScript interfaces
- Use `$bindable()` for two-way binding props
- Provide sensible defaults for all optional props
- Spread `...rest` for forwarding unknown attributes

### Size System

Components use a numeric size scale where `'1'` is the default/normal size:

```typescript
size?: '0000' | '000' | '00' | '0' | '1' | '2' | '3' | '4' | '5' | '6'
```

Not every component uses the full scale — each defines the relevant subset. The size maps to `font-size: var(--font-size-{size})` internally, which cascades to scale the entire component via `em` units.

```svelte
<Button size="0">Small</Button>
<Button>Normal (size="1" default)</Button>
<Button size="3">Large</Button>
```

### Variant Props

Components use **boolean props** for visual variants rather than a single `variant` string. This allows combinations:

```svelte
<!-- Single variant -->
<Button outline>Outlined</Button>
<Button transparent>Ghost</Button>

<!-- Combined variants -->
<Button transparent success>Green text, no background</Button>
<Button outline accent>Accent-colored border</Button>
```

Available variant booleans vary by component. Common ones: `outline`, `transparent`, `translucent`, `accent`, `error`, `success`.

### Density Props

Components manage their own internal spacing. Where appropriate, components support `dense` and `comfortable` boolean props:

```svelte
<List dense>        <!-- Tighter spacing for data-heavy UIs -->
<List>              <!-- Default balanced spacing -->
<List comfortable>  <!-- More breathing room -->
```

### Cross-Cutting Props

Several props appear across many components as a convention:

| Prop | Type | Description |
|------|------|-------------|
| `skeleton` | `boolean` | Shows a loading skeleton/shimmer in the component's shape. Added to components that display dynamically loaded content (tables, lists, avatars, etc.). |
| `tooltip` | `string` | Hover tooltip text. Implemented via `{@attach tooltip()}` from `@delightstack/utilities`. Added to interactive components. |
| `badge` | `number \| boolean` | Notification badge. `true` shows a dot, a number shows the count (truncated to 99+). Added to Button, Avatar, Tabs, ListItem, Menu items. |

### Events

- Use callback props (`onclick`, `onchange`) instead of dispatching events
- Support Promise returns for async operations — the component auto-manages loading state

```svelte
<!-- Button automatically shows spinner while the Promise resolves -->
<Button onclick={async () => {
	await saveData();
}}>
	Save
</Button>
```

### Utilities Integration

Components use actions from `@delightstack/utilities` via the `{@attach}` directive:

```svelte
<button {@attach ripple()} {@attach tooltip('Click me')}>
	Action
</button>
```

Available utilities: `ripple`, `tooltip`, `focusTrap`, `autoAnimate`, `intersectionObserver`, `resizeObserver`, `fitText`, `truncateText`, `onDragDropFile`, `selectable`, `sortable`, `onFocusWithin`.

### Styling

- Use CSS custom properties for theming
- Keep styles scoped within the component
- Use `light-dark()` for dark mode colors
- Use relative color syntax (`oklch(from var(...))`) for derived colors
- Use container queries for component-level responsiveness
- Prefer `transform` and `opacity` for animations (GPU-accelerated)

### Dark Mode

Components automatically support dark mode via `light-dark()`. Key differences in dark mode:

**Elevation**: Use borders + surface colors instead of shadows
```css
.card {
	background: var(--color-surface-2);
	border: 1px solid var(--border-elevated-2);
	box-shadow: var(--shadow-md);  /* shadow in light, inset highlight in dark */
}
```

**Text on colored backgrounds**: Tinted off-white that becomes pure white on hover
```css
.button {
	background: var(--color-action);
	color: var(--color-action-text);        /* tinted off-white */
}
.button:hover {
	background: var(--color-action-hover);
	color: var(--color-action-text-hover);  /* pure white */
}
```

### Backdrop Blur

Use `backdrop-filter: blur()` strategically for focus:

```css
/* YES: Modal backdrops - blur focuses attention on the modal */
.modal-backdrop {
	background: var(--color-backdrop);
	backdrop-filter: blur(var(--backdrop-blur));
}

/* NO: Small popovers/menus - blur would be distracting */
.popover-backdrop {
	/* No blur, just click-away detection */
}
```

### Accessibility

- Include proper ARIA attributes
- Support keyboard navigation
- Maintain focus management
- Use semantic HTML elements
- Respect `prefers-reduced-motion` for animations

---

## Sources & References

- [CSS Custom Properties Naming Conventions](https://jwdallas.com/posts/namingcssvariables/)
- [Nord Design System Naming](https://nordhealth.design/naming/)
- [CSS light-dark() Function](https://css-tricks.com/almanac/functions/l/light-dark/)
- [Container Queries Unleashed](https://www.joshwcomeau.com/css/container-queries-unleashed/)
- [Modern Dark Mode Implementation](https://medium.com/design-bootcamp/the-ultimate-guide-to-implementing-dark-mode-in-2025-bbf2938d2526)
- [Standard Schema](https://github.com/standard-schema/standard-schema) — for form validation
