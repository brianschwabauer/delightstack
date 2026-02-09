# Typewriter

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Typewriter.svelte`

## Description

An animated text component that simulates typing, character by character. Screen readers see the full text immediately via `aria-label`, while the visual typing animation uses `aria-hidden="true"`. Features natural typing variation (randomized per-character timing), smart punctuation pauses, and support for cycling through multiple texts with a backspace/retype loop.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Text Display
- Configurable font (monospace or inherit from parent)
- Blinking cursor at the end of typed text
- Clean, readable text at any size

### Cursor Styles
- **line** (default): Thin vertical bar
- **block**: Filled rectangle behind the current character
- **underscore**: Horizontal line below the current character
- **false**: No cursor

### Animation
- Character-by-character reveal
- Variable speed per character for natural feel
- Pause between phrases (when cycling)
- Backspace/delete effect with faster speed

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string \| string[]` | required | Text to type (single or multiple for cycling) |
| `speed` | `number` | `50` | Base typing speed in milliseconds per character |
| `delay` | `number` | `1000` | Delay before typing starts (ms) |
| `loop` | `boolean` | `false` | Loop through texts continuously |
| `pauseBetween` | `number` | `2000` | Pause between texts when cycling (ms) |
| `cursor` | `'block' \| 'line' \| 'underscore' \| false` | `'line'` | Cursor style |
| `cursorBlink` | `boolean` | `true` | Blink cursor when idle |
| `deleteSpeed` | `number` | `30` | Backspace speed in milliseconds per character |
| `paused` | `boolean` | `false` | Programmatically pause the animation |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onstart` | - | Typing started |
| `oncomplete` | - | All text typed (or full cycle completed) |
| `onloop` | `{ index: number }` | Loop iteration started |

## Accessibility

Screen readers must see the full text immediately, not the typing animation.

Implementation approach:
- The component renders two elements:
  1. A `<span aria-label="{fullText}">` wrapper containing the visual element
  2. Inside: `<span aria-hidden="true">{typedText}<span class="cursor" /></span>`
- The `aria-label` on the outer element contains the complete text
- The inner visual element is `aria-hidden="true"` so screen readers skip the animation
- For multiple texts, `aria-label` contains all texts joined (or the current target text)

```svelte
<span aria-label={typeof text === 'string' ? text : text.join(', ')}>
  <span aria-hidden="true">{displayedText}<span class="cursor"></span></span>
</span>
```

## Natural Typing Variation

Each character's delay is randomized around the base `speed`:
- Normal characters: `speed * (0.8 + Math.random() * 0.4)` (80-120% of base)
- Occasional longer pause (5% chance): `speed * 2` to simulate "thinking"
- Faster for repeated characters (e.g., "oooo")
- This produces a human-like rhythm rather than a mechanical constant speed

## Smart Punctuation Pauses

Certain characters trigger longer delays after being typed:
- Period (`.`): 3x base speed
- Comma (`,`): 1.8x base speed
- Semicolon (`;`): 2x base speed
- Colon (`:`): 2x base speed
- Question mark (`?`): 3x base speed
- Exclamation mark (`!`): 3x base speed
- Newline: 2x base speed

This makes the typing feel thoughtful and natural, with breathing room at natural sentence boundaries.

## Modes

### Single Text
```svelte
<Typewriter text="Welcome to our platform." />
```
- Types once, cursor remains blinking
- `oncomplete` fires when done

### Multiple Texts (Cycling)
```svelte
<Typewriter
  text={["Hello", "Bonjour", "Hola"]}
  loop
/>
```
1. Types first text
2. Pauses for `pauseBetween` ms
3. Backspaces the text (at `deleteSpeed` per character)
4. Types next text
5. Repeats

### Common Prefix Preservation
When cycling between texts with a common prefix:
```
"I love coding"
"I love designing"
```
Only backspaces "coding" and types "designing", preserving "I love ".

### Controlled
```svelte
<Typewriter text={message} paused={!showTyping} />
```
- `paused` prop programmatically pauses/resumes the animation

## Reduced Motion

When `prefers-reduced-motion` is active:
- Full text is displayed immediately (no character-by-character animation)
- Cursor is still visible (not animated)
- For cycling mode, text changes instantly with a crossfade

## CSS Approach

```css
.typewriter {
  display: inline;
}

.typewriter .cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: currentColor;
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
}

.typewriter .cursor.block {
  width: 0.6em;
  opacity: 0.7;
}

.typewriter .cursor.underscore {
  width: 0.6em;
  height: 2px;
  vertical-align: baseline;
}

.typewriter .cursor.typing {
  animation: none;
  opacity: 1;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .typewriter .cursor {
    animation: none;
  }
}
```

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

<!-- Block cursor style -->
<Typewriter
  text="$ npm install @delightstack/components"
  cursor="block"
  speed={40}
/>

<!-- Controlled animation -->
<Typewriter text={currentMessage} paused={!isVisible} />
```

## Implementation Notes

- Use `setTimeout` (not `setInterval`) for per-character timing with variation
- Track component lifecycle: cancel all timeouts on destroy
- Handle `text` prop changes mid-animation: stop current animation, start new one
- Common prefix detection: compare character-by-character between current and next text
- Cursor blink: CSS animation (`step-end`) for smooth on/off
- Cursor pauses blinking during typing (class toggle)
- Performance: for very long text, consider chunking updates to avoid excessive DOM writes
- SSR: render the full text immediately (no animation on server)
