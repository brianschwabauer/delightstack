I. UI Component Libraries
These libraries provide pre-built, styled components to accelerate your development. Many also offer "headless" options for maximum styling flexibility.

Shadcn Svelte: An unofficial Svelte port of the highly popular shadcn/ui from React. It uses a CLI to generate actual component source code into your project, giving you full control over markup, styling, and behavior. Built with Tailwind CSS and Radix UI primitives. Highly recommended for full customization.

Flowbite Svelte: A comprehensive UI component library specifically tailored for Svelte applications, built on top of Tailwind CSS. It offers a wide range of components with built-in dark mode support.

Skeleton: A UI toolkit designed for Svelte and SvelteKit. It leverages Tailwind CSS internally and provides a comprehensive design system, component primitives, and functional components.

Svelte Material UI (SMUI): Based on Google's Material Design Components for Web. It's highly themable through Sass variables.

SvelteUI: Offers a comprehensive set of highly customizable UI elements and is built with TypeScript, ensuring strong type safety.

Melt UI: A modern, headless UI library for Svelte that focuses on providing accessible, customizable components without imposing any specific styling. Great for building custom designs on top of solid primitives.

Bits UI: An actively maintained library of headless component primitives for Svelte 5. It's built with accessibility in mind and allows easy styling via class and style props. (Uses Melt UI under the hood for some components).

Sveltestrap: Provides Bootstrap 4 & 5 components as Svelte components, allowing you to leverage the popular Bootstrap framework within Svelte.

Carbon Components Svelte: The official implementation of IBM's Carbon Design System for Svelte, offering enterprise-grade UI components.

DaisyUI: A lightweight, customizable component library built on top of Tailwind CSS. While not exclusively for Svelte, it integrates seamlessly by providing components via CSS class names.

II. CSS Helpers & Frameworks
These help with styling your application, from utility-first approaches to pre-designed themes.

Tailwind CSS: A utility-first CSS framework that allows you to rapidly build custom designs directly in your HTML. It's extremely popular in the Svelte ecosystem and pairs well with headless UI libraries.

DaisyUI: (Mentioned above in UI Components) While a component library, its approach of using CSS class names for components makes it feel like a CSS helper framework.

UnoCSS: A "Firesprings" engine for on-demand atomic CSS. Similar to Tailwind but offers more flexibility in configuration and a smaller footprint.

Sass (SCSS): A CSS preprocessor that extends CSS with features like variables, nested rules, mixins, and functions, making CSS more maintainable and powerful. Svelte naturally supports preprocessors.

PostCSS: A tool for transforming CSS with JavaScript plugins. It can be used for features like autoprefixing, minification, and even integrating Tailwind JIT.

III. Form Management & Validation
Crucial for handling user input and ensuring data integrity.

Superforms: A SvelteKit form library that simplifies server and client form validation with full type safety. It supports popular validators like Zod, Joi, and JSON Schema.

Felte: A lightweight JavaScript form library for managing form state and validation with clear error reporting. It offers adapters for various validation schemas (Yup, Zod, Superstruct, Vest).

FormSnap: Wraps Superforms with components to simplify usage and ensure forms are accessible by default.

Zod: A TypeScript-first schema declaration and validation library. Often used with form libraries like Superforms and Felte for robust type-safe validation.

Yup: A JavaScript schema builder for value parsing and validation. Another popular choice for defining validation schemas.

IV. Date Pickers & Calendars
Essential for applications requiring date or time selection.

Flowbite Svelte Datepicker: A component from the Flowbite Svelte library that provides an interactive calendar interface for selecting single dates or date ranges.

@svelte-plugins/datepicker: Offers a versatile date picker component with options for single date or range selection, multipane views, presets, and custom theming.

vkurko/calendar (Event Calendar): A full-sized, drag-and-drop event JavaScript calendar with different view modes (month, week, day, list, resources). It's lightweight, has zero dependencies, and can be used as a Svelte component.

Schedule-X: A powerful and flexible calendar library with a Svelte integration. It offers various views (day, week, month, resource, timeline), event management, and extensive customization options.

V. Drag and Drop
For interactive elements that can be reordered or moved.

svelte-dnd-action: A feature-complete implementation of drag and drop for Svelte using a custom action. It supports almost every imaginable drag and drop use case, any input device, and is fully accessible.

rozek/svelte-drag-and-drop-actions: Takes a Svelte-centric approach by assuming drag and drop elements' positions and sizes are part of the application's state. Offers a declarative API and supports various drag dummy options.

VI. WYSIWYG Editors
For rich text editing capabilities in your applications.

Flowbite-Svelte-Plugins/TextEditor: A WYSIWYG text editor component based on the TipTap library. It integrates well with Tailwind CSS and Flowbite Typography, offering comprehensive text editing features.

TinyMCE (with Svelte Integration): A widely trusted and feature-rich JavaScript WYSIWYG editor. It has a dedicated Svelte integration that makes it easy to add advanced editing capabilities, including typography, links, images, tables, and more. The core editor is open source.

Tiptap: A headless editor framework that is highly extensible and framework-agnostic. While Flowbite-Svelte-Plugins/TextEditor provides a pre-built component, you could also use Tiptap directly with Svelte for maximum control over the UI.

VII. Data Visualization & Charts
For presenting data in an understandable visual format.

LayerChart: A collection of visualization components and utilities built on top of Svelte's Layer Cake graphics framework. It provides unopinionated chart components (Bar, Area, Stack, Scatter, Pie, etc.) that serve as building blocks.

Svelte Frappe Charts: Bindings for the Frappe Charts library, offering simple and modern charts.

Chart.js (with Svelte wrapper if needed): A popular open-source JavaScript charting library. While not Svelte-native, there are often simple Svelte wrappers available or it can be integrated directly.

VIII. State Management
While Svelte has its own excellent reactivity system and stores, for more complex global state, these can be helpful.

Svelte Stores (Native): Svelte's built-in mechanism for managing reactive state that can be shared across components. For most Svelte projects, this is sufficient and highly recommended.

Svelte Context API (Native): Allows you to pass data down the component tree without prop drilling. Useful for injecting services or configuration.

Pinia (with Svelte adapter/integration): While primarily for Vue, Pinia is a popular and lightweight state management library that can sometimes be adapted for Svelte projects if you prefer a more centralized store pattern.

TanStack Query (React Query for Svelte): While primarily for data fetching and caching, it also manages global state related to data. If your "state" is largely derived from asynchronous data, this is an excellent choice.

IX. Routing
For managing different views and URLs in your application.

SvelteKit Router (Native for SvelteKit projects): If you're using SvelteKit, its built-in file-system based router is powerful and typically all you need.

svelte-spa-router: A popular and flexible client-side router for single-page applications built with Svelte.

tinro: A small, modern, and zero-dependency router for Svelte applications.

X. Animation Libraries
For adding smooth and engaging transitions and animations.

Svelte Transitions & Animations (Native): Svelte has powerful built-in transition directives and motion utilities (tweened, spring) for handling animations. For many cases, these are sufficient.

GSAP (GreenSock Animation Platform): A robust, high-performance, and feature-rich JavaScript animation library. It's framework-agnostic and can be integrated seamlessly with Svelte for complex animations.

Framer Motion (if a Svelte port exists or vanilla JS option): Primarily a React animation library, but due to its declarative nature, sometimes community ports or vanilla JS implementations can be found or adapted.

XI. Utility Libraries
General-purpose libraries for common tasks.

Lodash / Ramda: Popular JavaScript utility libraries offering a wide range of functions for array, object, string manipulation, etc. While ES6 features reduce the need for them, they still offer highly optimized and convenient utilities.

date-fns / Luxon / Moment.js: Libraries for parsing, validating, manipulating, and formatting dates. date-fns and Luxon are generally preferred for modern JavaScript projects due to their modularity and immutability.

Nano ID: A tiny, secure, URL-friendly, unique string ID generator.

Zod (again, useful here as a general validation utility): Can be used beyond just forms for validating any data structure.

Considerations when choosing libraries:

Bundle Size: Svelte's strength is its small bundle size. Favor libraries that are also lightweight or allow for tree-shaking.

TypeScript Support: Look for libraries with good TypeScript declarations (.d.ts files) for better developer experience and type safety.

Active Maintenance: Choose libraries that are actively maintained and have a healthy community.

Accessibility (A11y): Prioritize libraries that focus on accessibility to ensure your applications are usable by everyone. Headless UI libraries often excel here as they provide the underlying accessible logic.

SvelteKit Compatibility: If you're using SvelteKit, ensure the library is compatible with SvelteKit's SSR (Server-Side Rendering) and hydration process.







I. Navigation & Structure

App Bar / Header:
Fixed Header: Stays at the top of the viewport.
Shrinking/Expanding Header: Changes size on scroll.
Transparent Header: Becomes opaque on scroll.
Sticky Header: Sticks to the top after scrolling past it.
Header with Search Bar: Integrated search functionality.
Header with User Profile/Avatar: Displays user info.
Header with Notifications Icon: Indicates new notifications.
Header with Language Selector: Option for multi-language sites.
Header with Dark Mode Toggle: Theme switching.
Navigation Bar (Nav Bar):
Top Navigation: Horizontal links, common for desktops.
Side Navigation (Sidebar): Vertical links, often collapsible.
Nested Navigation: Dropdowns or expandable sections within nav.
Breadcrumbs: Shows current page location in a hierarchy.
Pagination: Navigates through pages of content (e.g., search results, articles).
Steppers / Progress Indicators: Guides users through multi-step processes.
Tab Bar / Tabbed Interface: Organizes content into distinct sections accessible via tabs.
Segmented Controls: A group of buttons that act like radio buttons, selecting one option.
Footers:
Simple Footer: Copyright, basic links.
Complex Footer: Multiple columns, sitemap, contact info, social links.
Drawer / Off-canvas Menu:
Left/Right Drawer: Slides in from the side (common for mobile navigation).
Full-screen Drawer: Overlays the entire screen.
Back to Top Button: Scrolls the user to the top of the page.
Skip Links: For accessibility, allows users to skip repetitive navigation.

II. User Input & Forms

Text Inputs:
Single-line Text Field: Basic text input.
Password Field: Masks input characters.
Email Field: Specific validation for email format.
Number Field (Spinbutton): Numeric input with increment/decrement arrows.
Search Input: Often with a clear button or search icon.
Textarea: Multi-line text input.
Labeled Input: Input field with an associated label.
Placeholder Text: Example text within the input field.
Helper Text / Hint Text: Provides context or instructions.
Validation States (Error, Success, Warning): Visual feedback for input validity.
Input with Icon: Prefix/suffix icons for visual cues.
Masked Input: Enforces a specific input format (e.g., phone number, credit card).
Selection Components:
Checkboxes: Toggle on/off state, multiple selections possible.
Radio Buttons: Select one option from a group.
Switches / Toggles: Visually distinct on/off controls.
Select Dropdowns (Native & Custom Styled): For single or multiple selections.
Multi-select Dropdowns (Tag Input): Select multiple items, often displaying them as tags.
Autosuggest / Autocomplete: Provides suggestions as user types.
Rating Input (Stars, Thumbs): For user feedback/ratings.
Date & Time Inputs:
Date Picker: Allows selection of a single date.
Date Range Picker: Selects a start and end date.
Time Picker: Selects a specific time.
Date & Time Picker: Combines both.
Calendar View: Displays a full calendar, often for event selection.
File Upload:
Simple File Input: Native browser file selector.
Drag & Drop File Upload Area: Allows dropping files directly.
File Upload with Progress Bar: Shows upload status.
Image Uploader with Preview: Displays a thumbnail of the uploaded image.
Multiple File Uploader: Allows selecting several files.
WYSIWYG Editor (Rich Text Editor):
For creating and formatting rich text content (e.g., blog posts, messages).
Sliders:
Single Slider: Selects a value within a range.
Range Slider: Selects a minimum and maximum value within a range.
Continuous Slider: No discrete steps.
Discrete Slider: Jumps between predefined steps.
Buttons:
Primary / Call to Action (CTA) Button: Most prominent action.
Secondary Button: Less prominent actions.
Tertiary / Outline / Ghost Button: Minimal styling.
Link Button: Looks like a button but acts as a link.
Icon Button: Button with only an icon.
Button Group: Multiple buttons clustered together.
Loading Button: Displays a spinner while an action is in progress.
Disabled Button: Visually indicates it's not interactive.
Fab (Floating Action Button): Prominent, often circular button, usually for a primary action on a screen.

III. Feedback & Messaging

Toasts / Snackbars:
Success Toast: Confirms an action was successful.
Error Toast: Informs of an error.
Warning Toast: Alerts to a potential issue.
Info Toast: General information.
Actionable Toast: Includes a button for an action (e.g., "Undo").
Persistent Toast: Stays until dismissed.
Alerts / Banners:
Dismissible Alert: Can be closed by the user.
Non-dismissible Alert: Stays on screen.
Inline Alert: Appears within content.
Global Alert: Appears at the top of the page.
Modals / Dialogs:
Confirmation Modal: Asks user to confirm an action.
Information Modal: Displays important info.
Form Modal: Contains a form for input.
Image Viewer Modal: Displays an image larger.
Video Player Modal: Embedded video.
Full-screen Modal: Takes over the entire screen.
Popovers:
Information Popover: Displays brief info on hover/click.
Action Popover: Contains actions related to an element.
Popover with Arrow: Points to the element it relates to.
Tooltips:
Simple Text Tooltip: Displays text on hover.
Rich Content Tooltip: Contains formatted text or small components.
Progress Indicators:
Spinners / Loaders: Indicate ongoing process.
Progress Bars (Determinate & Indeterminate): Shows task completion status.
Skeletons / Content Placeholders: Placeholder content while data loads.
Loading Overlay: Covers content while loading.
Empty State / No Results Message:
Informs user when there's no data to display, often with a call to action.

IV. Data Display & Content

Cards:
Basic Card: Contains content, image, text.
Product Card: Displays product info (image, name, price, CTA).
User Profile Card: Displays user avatar, name, bio.
Blog Post Card: Title, excerpt, image, author.
Action Card: Prompts user to perform an action.
Lists:
Simple List: Unordered/ordered text items.
Icon List: List items with leading icons.
Avatar List: List of users with avatars.
Action List: List items with associated actions (e.g., edit, delete).
Virtualized List: For very long lists, renders only visible items.
Tables:
Basic Table: Data in rows and columns.
Sortable Table: Allows sorting columns.
Paginated Table: Breaks large tables into pages.
Filterable Table: Allows filtering data.
Searchable Table: Integrated search.
Editable Table Cells: Allows inline editing.
Responsive Table: Adapts to different screen sizes.
Data Grid: Advanced table features like resizing, reordering columns.
Accordions / Collapsible Panels:
Single-open Accordion: Only one panel open at a time.
Multi-open Accordion: Multiple panels can be open.
Animated Accordion: Smooth open/close transitions.
Carousels / Sliders:
Image Carousel: Slides through images.
Content Carousel: Slides through various types of content.
Testimonial Carousel: Displays user reviews.
Hero Carousel: Large, prominent carousel on a homepage.
Badges / Tags:
Notification Badge: Displays counts (e.g., unread messages).
Status Badge: Indicates status (e.g., "Active," "Pending").
Category Tag: Labels content with keywords.
Avatars:
Image Avatar: User profile picture.
Text Avatar: Initials if no image available.
Group Avatar: Displays multiple avatars for a group.
Timelines / Activity Feeds:
Displays events in chronological order.
Skeleton Screens / Loaders: (Covered above in feedback, but also for content loading)
Code Blocks:
Syntax highlighted code display.
Copy to clipboard functionality.
Callout / Blockquote:
Styled sections to highlight important text or quotes.

V. Interactive & Advanced UX

Drag and Drop:
Sortable Lists / Grids: Reorder items.
File Upload Areas: Drag and drop files.
Kanban Boards: Drag cards between columns.
Drag-and-Drop Builders: For creating layouts/forms.
Off-canvas Panels / Side Sheets:
Similar to drawers but often for contextual content or forms that slide in from the side.
Search Overlays:
Full-screen search interface.
Command Palette:
A searchable modal that allows users to quickly access features and commands.
Walkthroughs / Onboarding Tours:
Highlights features for new users.
Color Pickers:
Allows users to select a color from a palette or gradient.
Rich Charts & Graphs:
Line, Bar, Pie, Scatter, Area, Heatmap, etc. (often require a dedicated charting library).
Interactive charts (zoom, pan, tooltips).
Maps (Interactive):
Integration with mapping services (e.g., Leaflet, Mapbox, Google Maps).
Custom markers, overlays.
Image Galleries / Lightboxes:
Displaying multiple images with a click-to-enlarge functionality.
Video Players:
Custom UI for HTML5 video.
Integrations with YouTube/Vimeo APIs.
PDF Viewers:
Displaying PDF documents within the application.
Scroll Spy / Scroll-triggered Animations:
Highlighting active navigation items based on scroll position.
Triggering animations when elements enter the viewport.
Resizers / Splitter Panes:
Allows users to resize sections of the layout (e.g., code editor panes).
Context Menus (Right-click Menus):
Custom menus that appear on right-click.
