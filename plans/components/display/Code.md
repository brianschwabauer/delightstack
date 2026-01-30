# Code

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Code.svelte`

## Description

A syntax-highlighted code block component for displaying code snippets. Features line numbers, copy functionality, and support for multiple programming languages with a consistent, readable theme.

## Visual Design

### Container
- Monospace font (`--font-mono`)
- Background uses `light-dark()` to stand out in both themes
- Rounded corners (`--radius-md`)
- Horizontal scroll for long lines

### Header (Optional)
- Language label
- Filename if provided
- Copy button

### Code Area
- Line numbers on left (optional)
- Syntax highlighting
- Comfortable line height
- Tab-based indentation preserved

### Colors
Single cohesive theme that works in both light/dark modes:
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
| `filename` | `string` | - | Filename to display |
| `showLineNumbers` | `boolean` | `true` | Show line numbers |
| `showCopy` | `boolean` | `true` | Show copy button |
| `startLine` | `number` | `1` | Starting line number |
| `highlightLines` | `number[]` | `[]` | Lines to highlight |
| `wrap` | `boolean` | `false` | Wrap long lines |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Supported Languages

Core languages to support (minimal highlighting):
- JavaScript/TypeScript
- HTML/CSS/SCSS
- JSON
- Markdown
- Python
- Bash/Shell
- SQL
- Svelte

## Features

### Copy to Clipboard
- Button in header area
- Click copies entire code
- Checkmark feedback on success
- "Copied!" tooltip briefly

### Line Highlighting
```svelte
<Code
  code={snippet}
  language="javascript"
  highlightLines={[3, 4, 5]}
/>
```
- Background highlight on specified lines
- Useful for drawing attention

### Diff Display
```svelte
<Code
  code={diffText}
  language="diff"
/>
```
- Green background for additions
- Red background for removals
- Support standard diff format

## Delightful Details

### Copy Feedback
- Button shows "Copy" → "Copied!" → "Copy"
- Checkmark icon briefly
- Subtle animation

### Hover Line Highlight
- Very subtle background on hovered line
- Helps track position

### Selection
- Custom selection colors
- Selecting copies plain text (no line numbers)

### Loading Code
- Skeleton placeholder
- Smooth transition to highlighted code

### Mobile
- Swipe to scroll horizontally
- Touch-friendly copy button
- Readable on small screens

## Accessibility

- Proper code semantics (`<pre><code>`)
- Copy button keyboard accessible
- Screen readers can access content
- Line numbers decorative (aria-hidden)

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
```

## Implementation Notes

- Implement simple tokenizer or use lightweight library
- Pre-built themes (one light, one dark)
- Keep bundle small - don't include all languages
- Support custom language definitions
- Use CSS Grid for line number alignment
- Consider lazy highlighting for very long code
