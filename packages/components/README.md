# @delightstack/components

A polished, opinionated [Svelte 5](https://svelte.dev) component library focused on delightful
user experiences — 50+ accessible, themeable components built on runes, with motion and
micro-interactions designed in from the start.

**Docs:** [docs.thedelight.co](https://docs.thedelight.co) ·
**Live demo:** [docs.thedelight.co/demo](https://docs.thedelight.co/demo/)

## Installation

```bash
pnpm add @delightstack/components @delightstack/styles
```

Import the design tokens once at the root of your app (e.g. `src/routes/+layout.svelte`):

```ts
import '@delightstack/styles';
```

Requires Svelte `^5.36.0`. Works with SvelteKit and standalone Vite + Svelte projects.

## Usage

All components are available from a single import — unused ones are tree-shaken:

```svelte
<script>
	import { Button, Input, BottomSheet } from '@delightstack/components';

	let name = $state('');
	let open = $state(false);

	async function save() {
		await fetch('/api/user', { method: 'POST', body: JSON.stringify({ name }) });
	}
</script>

<Input label="Name" bind:value={name} />
<!-- Promise-returning callbacks show a loading state automatically -->
<Button onclick={save}>Save</Button>
<Button outline onclick={() => (open = true)}>Filters</Button>

<BottomSheet bind:open snap_points={[0.5, 0.92]}>
	<p>Slide me around.</p>
</BottomSheet>
```

### Conventions

- **Props are snake_case, callbacks are camelCase** — `snap_points`, `full_width` vs `onclick`,
  `onchange`. The visual distinction between data and behavior is intentional.
- **Callback props, not dispatched events.** Callbacks that return a Promise put the component
  into a loading state until they settle.
- **Two-way binding** with `bind:value`, plus component-specific bindables like `bind:open`,
  `bind:snap`, and `bind:page`.
- **Svelte 5 snippets** for named content areas (`{#snippet header()}…{/snippet}`).

## Components

| Category       | Components                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions**    | Button, ButtonGroup, Modal, Alert, Popover, ContextMenu, Portal, CommandPalette, ThemeToggle                                                                              |
| **Display**    | Accordion, Avatar, AvatarGroup, Calendar, Chart, Code, Comparison, Counter, Expand, List, ListItem, QR, SplitPane, Stat, Table, Timeline, Tree, Typewriter                |
| **Feedback**   | Callout, Confetti, Progress, Toaster (`toast()`)                                                                                                                          |
| **Form**       | Checkbox, Fieldset, FileUpload, Form, Input, Radio, RadioGroup, Range, Rating, Select, Toggle                                                                             |
| **Media**      | Carousel, Gallery, Image, Panorama, PDF, Video                                                                                                                            |
| **Navigation** | BottomSheet, Breadcrumbs, Pagination, Steps, Tabs                                                                                                                         |

Every component has a docs page with live examples and full Props / Events / CSS Variables /
Accessibility tables: [docs.thedelight.co/components/overview](https://docs.thedelight.co/components/overview/).

## Theming

Components read every color, size, and motion value from CSS custom properties shipped by
[`@delightstack/styles`](https://www.npmjs.com/package/@delightstack/styles), with light and dark
values built in. Re-theme by overriding the brand seed or any individual token:

```css
:root {
	/* Re-derives the whole palette from one brand color */
	--color-primary: #2563eb;

	/* …or override individual semantic tokens outright */
	--color-action: light-dark(#2563eb, #3b82f6);
	--radius-md: 0.5rem;
}
```

See the [Theming](https://docs.thedelight.co/guides/theming/) and
[Design Tokens](https://docs.thedelight.co/guides/design-tokens/) guides.

## Optional peer dependencies

A few media components dynamically import heavier libraries — install them only if you use the
component, and import these two from their dedicated subpaths:

| Component  | Peer dependency | Import from                          |
| ---------- | --------------- | ------------------------------------ |
| `Panorama` | `three`         | `@delightstack/components/panorama`  |
| `PDF`      | `pdfjs-dist`    | `@delightstack/components/pdf`       |
| `Video`    | `hls.js` (only for HLS sources) | `@delightstack/components` |

In Vite dev, add the ones you use to `optimizeDeps.include` so they are not stubbed as absent
optional dependencies.

## TypeScript

Types are included — no `@types/*` packages needed. Data-structure types ship from the main
entry point:

```ts
import type { SelectOption, TableColumn, TreeNode, CalendarEvent } from '@delightstack/components';
```

The package also ships its full `.svelte` sources in `dist/`, so editors (and AI agents) get
JSDoc descriptions for every prop.

## AI coding agents

Set up Claude Code, Cursor, Codex, and friends to use this library correctly in one command from
your project root:

```bash
pnpm exec delightstack-agents
```

This installs a ready-made skill (`.claude/skills/delightstack/SKILL.md`) and points your
`AGENTS.md` at it. Docs are also published as plain markdown — append `.md` to any docs page URL,
or start from [docs.thedelight.co/llms.txt](https://docs.thedelight.co/llms.txt). See the
[AI Agents guide](https://docs.thedelight.co/guides/ai-agents/).

## License

MIT
