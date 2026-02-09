# Code

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Code.svelte`

## Description

A syntax-highlighted code block component for displaying code snippets. Ships a basic runtime tokenizer as the default highlighter, with optional Shiki integration for rich, accurate syntax highlighting. Features line numbers, copy-to-clipboard, line highlighting, diff display, and a configurable max-height with scroll.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: `shiki` (optional, for rich syntax highlighting)

## Visual Design

### Container
- Monospace font (`--font-mono`)
- Background uses `light-dark()` for appropriate contrast in both themes
- Rounded corners (`--radius-3`)
- Horizontal scroll for long lines (no wrapping by default)
- Optional max-height with vertical scroll

### Header (Optional)
- Language label (top-left)
- Filename if provided (top-left, replaces language label)
- Copy button (top-right)
- Subtle background differentiation from code area

### Code Area
- Line numbers on left (optional, default on)
- Syntax highlighting with theme-aware colors
- Comfortable line height (1.6)
- Tab-based indentation preserved
- Highlighted lines have a subtle accent background

### Syntax Colors
Cohesive theme that works in both light and dark modes via `light-dark()`:
- Keywords: accent color
- Strings: green
- Comments: muted gray
- Functions: blue
- Numbers: orange

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `code` | `string` | required | Code to display |
| `language` | `string` | `'plaintext'` | Language for highlighting |
| `filename` | `string` | - | Filename to display in header |
| `showLineNumbers` | `boolean` | `true` | Show line numbers |
| `showCopy` | `boolean` | `true` | Show copy-to-clipboard button |
| `startLine` | `number` | `1` | Starting line number |
| `highlightLines` | `number[]` | `[]` | Line numbers to highlight |
| `diff` | `boolean` | `false` | Render as diff (green additions, red removals) |
| `wrap` | `boolean` | `false` | Wrap long lines instead of horizontal scroll |
| `maxHeight` | `string` | - | Max height with vertical scroll (e.g., `'400px'`) |
| `shiki` | `boolean` | `false` | Use Shiki for rich syntax highlighting |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Syntax Highlighting

### Default: Basic Runtime Tokenizer
A lightweight regex-based tokenizer ships with the component. It supports basic highlighting for common languages:
- JavaScript / TypeScript
- HTML / CSS / SCSS
- JSON
- Markdown
- Python
- Bash / Shell
- SQL
- Svelte

This tokenizer handles keywords, strings, comments, numbers, and function calls. It is small and runs synchronously.

### Optional: Shiki Integration
When `shiki` is true, the component dynamically imports Shiki for accurate, TextMate grammar-based highlighting. Shiki provides:
- Full language coverage
- Accurate token boundaries
- Theme integration

Shiki is loaded lazily to keep the default bundle small. While loading, the basic tokenizer is used as a fallback.

## Features

### Copy to Clipboard
- Button in the header area (clipboard icon)
- Click copies the entire code string (without line numbers)
- Visual feedback: icon changes to a checkmark for 2 seconds
- Tooltip: "Copy" -> "Copied!"

### Line Highlighting
```svelte
<Code
  code={snippet}
  language="javascript"
  highlightLines={[3, 4, 5]}
/>
```
- Highlighted lines get a subtle accent background
- Line numbers for highlighted lines are also accented
- Useful for drawing attention to specific lines

### Diff Display
```svelte
<Code code={diffText} diff />
```
- Lines starting with `+` get a green background
- Lines starting with `-` get a red background
- Lines starting with `@@` are styled as section headers
- Other lines are neutral

### Max Height with Scroll
```svelte
<Code code={longSnippet} maxHeight="300px" />
```
- Vertical scrollbar appears when content exceeds max height
- Sticky header (filename + copy button) remains visible while scrolling
- Smooth scroll behavior

## Skeleton State

When `skeleton` is true, render a code block placeholder with:
- Shimmering lines of varying widths (60%-90%)
- Line number placeholders
- Maintains the code block layout and styling

## Accessibility

- Semantic `<pre><code>` markup
- Copy button is keyboard accessible
- Screen readers can access the full code content
- Line numbers are decorative (`aria-hidden="true"`)
- Highlighted lines announced via `aria-label` on the line wrapper

## CSS Approach

```css
.code-block {
  background: light-dark(var(--color-surface-1), var(--color-surface-2));
  border-radius: var(--radius-3);
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.6;
}

.code-block .header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: light-dark(var(--color-surface-2), var(--color-surface-3));
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.code-block pre {
  margin: 0;
  padding: 1rem;
  overflow-x: auto;
}

.code-block .line.highlighted {
  background: color-mix(in oklch, var(--color-action), transparent 90%);
  display: block;
  margin: 0 -1rem;
  padding: 0 1rem;
}

.code-block .line-number {
  display: inline-block;
  width: 3ch;
  text-align: right;
  margin-right: 1.5ch;
  color: var(--color-text-muted);
  user-select: none;
}

.code-block .diff-add {
  background: color-mix(in oklch, var(--color-success), transparent 85%);
}

.code-block .diff-remove {
  background: color-mix(in oklch, var(--color-error), transparent 85%);
}
```

## Code Example

```svelte
<script>
  import { Code } from '@delightstack/components';

  const snippet = `function greet(name: string) {
  console.log(\`Hello, \${name}!\`);
}

greet('World');`;
</script>

<Code
  code={snippet}
  language="typescript"
  filename="greeting.ts"
/>

<!-- Highlight specific lines -->
<Code
  code={snippet}
  language="typescript"
  highlightLines={[2]}
/>

<!-- Without line numbers -->
<Code
  code="npm install @delightstack/components"
  language="bash"
  showLineNumbers={false}
/>

<!-- With max height -->
<Code
  code={longCodeBlock}
  language="python"
  maxHeight="400px"
/>

<!-- Diff display -->
<Code code={diffOutput} diff />

<!-- With Shiki for rich highlighting -->
<Code
  code={snippet}
  language="typescript"
  shiki
/>
```

## Implementation Notes

- Default tokenizer: regex-based, synchronous, small bundle
- Shiki: lazy-loaded via dynamic import when `shiki` prop is true
- Use CSS Grid for line number alignment (numbers in one column, code in another)
- Copy button uses `navigator.clipboard.writeText()`
- Line highlighting: wrap each line in a `<span>` and apply the highlight class
- Selection copies plain text (line numbers are excluded via `user-select: none`)
- For very long code blocks, consider lazy rendering visible lines only
