# Typewriter

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Typewriter.svelte`

## Description

An animated text component that simulates typing, perfect for hero sections, chatbot interfaces, or anywhere you want to draw attention to text content with a dynamic reveal effect.

## Visual Design

### Text Display
- Monospace or regular font (configurable)
- Blinking cursor at end
- Clean, readable text

### Cursor Styles
- Block cursor (filled rectangle)
- Line cursor (vertical bar)
- Underscore cursor
- Custom cursor element

### Animation
- Character-by-character reveal
- Variable typing speed for realism
- Pause between phrases
- Backspace/delete effect

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string \| string[]` | required | Text to type |
| `speed` | `number` | `50` | Base typing speed (ms) |
| `delay` | `number` | `1000` | Delay before starting |
| `loop` | `boolean` | `false` | Repeat animation |
| `pauseBetween` | `number` | `2000` | Pause between texts |
| `cursor` | `'block' \| 'line' \| 'underscore' \| false` | `'line'` | Cursor style |
| `cursorBlink` | `boolean` | `true` | Animate cursor blink |
| `deleteSpeed` | `number` | `30` | Backspace speed (ms) |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onstart` | - | Typing started |
| `oncomplete` | - | All text typed |
| `onloop` | - | Loop iteration |

## Modes

### Single Text
```svelte
<Typewriter text="Welcome to our platform." />
```
- Types once, cursor remains

### Multiple Texts (Loop)
```svelte
<Typewriter
  text={["Hello", "Bonjour", "Hola"]}
  loop
/>
```
- Types first text
- Pauses
- Backspaces
- Types next text
- Repeats

### Controlled
```svelte
<Typewriter text={message} paused={!showTyping} />
```
- Programmatically control animation

## Delightful Details

### Natural Typing
- Random speed variation per character
- Occasional "thinking" pauses
- Faster for repeated characters
- Feels human, not robotic

### Cursor Animation
- Smooth blink (not jarring)
- Pause during typing
- Resume blink when idle

### Text Preservation
When looping, preserve common prefix:
```
"I love coding"
"I love designing"
```
Only backspaces "coding" and types "designing"

### Smart Punctuation
- Longer pause after periods
- Brief pause after commas
- Hesitation before complex words

### Accessibility Mode
- Respects `prefers-reduced-motion`
- Shows full text immediately
- Cursor still visible

## Advanced Features

### HTML/Rich Text
```svelte
<Typewriter html>
  Welcome to <strong>DelightStack</strong>!
</Typewriter>
```
- Types through HTML tags
- Preserves formatting

### Custom Timing
```svelte
<Typewriter
  text="Hello... World!"
  charDelay={(char, index) => {
    if (char === '.') return 300;
    return 50;
  }}
/>
```

## Accessibility

- `aria-live` for screen readers
- Full text available immediately in DOM
- Reduced motion respected

## Code Example

```svelte
<script>
  import { Typewriter } from '@delightstack/components';
</script>

<!-- Hero section -->
<h1>
  <Typewriter
    text="Build something amazing."
    speed={60}
    delay={500}
  />
</h1>

<!-- Rotating taglines -->
<p class="tagline">
  We help you
  <Typewriter
    text={[
      "ship faster",
      "delight users",
      "scale easily"
    ]}
    loop
    pauseBetween={3000}
  />
</p>

<!-- Chat-like interface -->
<div class="message">
  <Typewriter
    text="Hi! How can I help you today?"
    speed={30}
    oncomplete={() => showInput = true}
  />
</div>
```

## Implementation Notes

- Use requestAnimationFrame for smooth animation
- Handle component unmount (cleanup intervals)
- Support interruption/restart
- Handle text prop changes mid-animation
- Consider performance for very long text
