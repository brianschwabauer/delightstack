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
| [Modal](./actions/Modal.md)                   | ✅ Complete    | Dialog overlay with transitions and focus management               |
| [Alert](./actions/Alert.md)                   | ✅ Complete    | Confirmation dialog built on Modal                                 |
| [Popover](./actions/Popover.md)               | ✅ Complete    | Floating content with smart positioning                            |
| [ContextMenu](./actions/ContextMenu.md)       | ✅ Complete    | Right-click menu system                                            |
| [Portal](./actions/Portal.md)                 | ✅ Complete    | Render children in different DOM locations                         |
| [CommandPalette](./actions/CommandPalette.md) | 🔲 Placeholder | Keyboard-driven command interface                                  |
| [ThemeToggle](./actions/ThemeToggle.md)       | 🔲 Placeholder | Light/dark/auto theme switcher                                     |

### Display

Components for presenting information.

| Component                             | Status         | Description                                    |
| ------------------------------------- | -------------- | ---------------------------------------------- |
| [Expand](./display/Expand.md)         | ✅ Complete    | Animated show/hide container                   |
| [List](./display/List.md)             | ✅ Complete    | Flexible list container with selection modes   |
| [ListItem](./display/ListItem.md)     | ✅ Complete    | Rich list item with multiple interaction types |
| [Accordion](./display/Accordion.md)   | 🔲 Placeholder | Collapsible content sections                   |
| [Avatar](./display/Avatar.md)         | 🔲 Placeholder | User/entity profile image                      |
| [Badge](./display/Badge.md)           | 🔲 Placeholder | Small status indicator                         |
| [Banner](./display/Banner.md)         | 🔲 Placeholder | Full-width announcement bar                    |
| [Calendar](./display/Calendar.md)     | 🔲 Placeholder | Date display and selection                     |
| [Chart](./display/Chart.md)           | 🔲 Placeholder | Data visualization                             |
| [Chat](./display/Chat.md)             | 🔲 Placeholder | Conversation display                           |
| [ChatBubble](./display/ChatBubble.md) | 🔲 Placeholder | Individual message bubble                      |
| [Code](./display/Code.md)             | 🔲 Placeholder | Syntax-highlighted code block                  |
| [Comparison](./display/Comparison.md) | 🔲 Placeholder | Before/after image slider                      |
| [Counter](./display/Counter.md)       | 🔲 Placeholder | Animated number display                        |
| [Format](./display/Format.md)         | 🔲 Placeholder | Text formatting utilities                      |
| [QR](./display/QR.md)                 | 🔲 Placeholder | QR code generator                              |
| [SplitPane](./display/SplitPane.md)   | 🔲 Placeholder | Resizable split view                           |
| [Stat](./display/Stat.md)             | 🔲 Placeholder | Key metric display                             |
| [Table](./display/Table.md)           | 🔲 Placeholder | Data table with sorting/filtering              |
| [Timeline](./display/Timeline.md)     | 🔲 Placeholder | Chronological event display                    |
| [Tree](./display/Tree.md)             | 🔲 Placeholder | Hierarchical data display                      |
| [Typewriter](./display/Typewriter.md) | 🔲 Placeholder | Animated text typing effect                    |

### Feedback

Components that communicate state and progress.

| Component                          | Status         | Description                     |
| ---------------------------------- | -------------- | ------------------------------- |
| [Callout](./feedback/Callout.md)   | 🔲 Placeholder | Highlighted information block   |
| [Loading](./feedback/Loading.md)   | 🔲 Placeholder | Animated loading indicator      |
| [Progress](./feedback/Progress.md) | 🔲 Placeholder | Progress bar                    |
| [Skeleton](./feedback/Skeleton.md) | 🔲 Placeholder | Content loading placeholder     |
| [Spinner](./feedback/Spinner.md)   | 🔲 Placeholder | Spinning loading indicator      |
| [Toast](./feedback/Toast.md)       | 🔲 Placeholder | Temporary notification messages |
| [Tooltip](./feedback/Tooltip.md)   | 🔲 Placeholder | Hover information popup         |

### Form

Input components for user data entry.

| Component                                | Status         | Description                         |
| ---------------------------------------- | -------------- | ----------------------------------- |
| [Input](./form/Input.md)                 | ✅ Complete    | Comprehensive text/data input field |
| [Checkbox](./form/Checkbox.md)           | 🔲 Placeholder | Boolean toggle with check mark      |
| [Fieldset](./form/Fieldset.md)           | 🔲 Placeholder | Form section grouping               |
| [FileUpload](./form/FileUpload.md)       | 🔲 Placeholder | Drag-and-drop file input            |
| [Form](./form/Form.md)                   | 🔲 Placeholder | Form container with validation      |
| [IconSelector](./form/IconSelector.md)   | 🔲 Placeholder | Icon picker interface               |
| [MediaSelector](./form/MediaSelector.md) | 🔲 Placeholder | Image/video selection               |
| [Radio](./form/Radio.md)                 | 🔲 Placeholder | Single-select option                |
| [Range](./form/Range.md)                 | 🔲 Placeholder | Slider input                        |
| [Rating](./form/Rating.md)               | 🔲 Placeholder | Star/score input                    |
| [Select](./form/Select.md)               | 🔲 Placeholder | Dropdown selection                  |
| [Toggle](./form/Toggle.md)               | 🔲 Placeholder | On/off switch                       |

### Layout

Structural components for page organization.

| Component                          | Status         | Description                     |
| ---------------------------------- | -------------- | ------------------------------- |
| [Container](./layout/Container.md) | 🔲 Placeholder | Max-width content wrapper       |
| [Grid](./layout/Grid.md)           | 🔲 Placeholder | CSS Grid layout helper          |
| [Stack](./layout/Stack.md)         | 🔲 Placeholder | Vertical/horizontal flex layout |
| [Divider](./layout/Divider.md)     | 🔲 Placeholder | Visual separator                |

### Media

Components for rich media content.

| Component                       | Status         | Description                         |
| ------------------------------- | -------------- | ----------------------------------- |
| [Carousel](./media/Carousel.md) | 🔲 Placeholder | Swipeable image/content slider      |
| [Gallery](./media/Gallery.md)   | 🔲 Placeholder | Image grid with lightbox            |
| [Image](./media/Image.md)       | 🔲 Placeholder | Optimized image with loading states |
| [Map](./media/Map.md)           | 🔲 Placeholder | Interactive map display             |
| [Panorama](./media/Panorama.md) | 🔲 Placeholder | 360° image viewer                   |
| [PDF](./media/PDF.md)           | 🔲 Placeholder | PDF document viewer                 |
| [Video](./media/Video.md)       | 🔲 Placeholder | Video player with controls          |

### Navigation

Components for moving through the application.

| Component                                  | Status         | Description                   |
| ------------------------------------------ | -------------- | ----------------------------- |
| [BottomSheet](./navigation/BottomSheet.md) | 🔲 Placeholder | Mobile-style slide-up panel   |
| [Breadcrumbs](./navigation/Breadcrumbs.md) | 🔲 Placeholder | Hierarchical navigation trail |
| [Drawer](./navigation/Drawer.md)           | 🔲 Placeholder | Slide-out side panel          |
| [Menu](./navigation/Menu.md)               | 🔲 Placeholder | Dropdown menu                 |
| [Pagination](./navigation/Pagination.md)   | 🔲 Placeholder | Page navigation controls      |
| [Steps](./navigation/Steps.md)             | 🔲 Placeholder | Multi-step progress indicator |
| [Tabs](./navigation/Tabs.md)               | 🔲 Placeholder | Tabbed content switcher       |

---

## Implementation Progress

| Category   | Complete | Placeholder | Total  |
| ---------- | -------- | ----------- | ------ |
| Actions    | 6        | 2           | 8      |
| Display    | 3        | 19          | 22     |
| Feedback   | 0        | 7           | 7      |
| Form       | 1        | 11          | 12     |
| Layout     | 0        | 4           | 4      |
| Media      | 0        | 7           | 7      |
| Navigation | 0        | 7           | 7      |
| **Total**  | **10**   | **57**      | **67** |

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

### Density Props

Instead of a global spacing scale, components manage their own internal spacing. Where appropriate, components support `dense` and `comfortable` boolean props:

```svelte
<List dense>        <!-- Tighter spacing for data-heavy UIs -->
<List>              <!-- Default balanced spacing -->
<List comfortable>  <!-- More breathing room -->
```

Components define their own spacing internally:
```css
.list-item {
	padding: 0.75rem 1rem;           /* default */
}
.list.dense .list-item {
	padding: 0.5rem 0.75rem;         /* dense */
}
.list.comfortable .list-item {
	padding: 1rem 1.25rem;           /* comfortable */
}
```

### Events

- Use callback props (`onclick`, `onchange`) instead of dispatching events
- Support Promise returns for async operations with loading states

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
