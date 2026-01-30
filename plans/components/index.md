# DelightStack Component Library

A polished, opinionated Svelte 5 component library focused on **delightful user experiences**. Every component is crafted with attention to detail, thoughtful micro-animations, and a cohesive visual language.

## Design Philosophy

- **Details Matter**: Every pixel, every transition, every interaction is intentional
- **Delight Users**: Subtle animations, smooth transitions, and unexpected moments of joy
- **Opinionated by Default**: Components look great out of the box with sensible defaults
- **Self-Contained**: Each component is readable and maintainable in a single file
- **Modern CSS**: Plain CSS with CSS custom properties for theming

## Design System

### Colors

- `--c-bg` / `--c-text`: Base background and text colors
- `--c-action`: Primary interactive color
- `--c-accent`: Secondary highlight color
- `--c-error` / `--c-success`: Semantic feedback colors
- `--layer-1` through `--layer-5`: Elevation layers

### Spacing & Radius

- `--radius-1` through `--radius-5`: Border radius scale
- `--radius-round`: Fully rounded (pill shape)
- Consistent 4px/8px spacing rhythm

### Typography

- `--font-size-0000` through `--font-size-6`: Type scale
- System font stack for performance

### Shadows

- `--shadow-1` through `--shadow-3`: Elevation shadows

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

### Events

- Use callback props (`onclick`, `onchange`) instead of dispatching events
- Support Promise returns for async operations with loading states

### Styling

- Use CSS custom properties for theming
- Keep styles scoped within the component
- Use CSS Grid and Flexbox for layout
- Prefer `transform` and `opacity` for animations (GPU-accelerated)

### Accessibility

- Include proper ARIA attributes
- Support keyboard navigation
- Maintain focus management
- Use semantic HTML elements
