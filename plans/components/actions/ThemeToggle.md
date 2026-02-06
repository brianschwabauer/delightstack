# ThemeToggle

**Status**: 🔲 Placeholder
**Category**: Actions
**File**: `packages/components/src/actions/ThemeToggle.svelte`

## Description

A delightful theme switcher component that transitions between light, dark, and system-auto modes. Features smooth animations that make changing themes feel satisfying rather than jarring.

## Visual Design

### Toggle Button (Icon Mode)
- Circular button with sun/moon icon
- Icon morphs smoothly between states
- Subtle background on hover
- Size: 40px touch target

### Toggle Button (Switch Mode)
- Pill-shaped toggle switch
- Sun on left, moon on right
- Sliding indicator shows current mode
- Clear active state

### Three-Way Toggle (With Auto)
- Segmented control with three options
- Icons: Sun | System | Moon
- Clear selection indicator
- Compact design

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Current theme (bindable) |
| `isDark` | `boolean` | - | Computed dark state (bindable, read-only) |
| `disableAuto` | `boolean` | `false` | Hide auto/system option |
| `variant` | `'icon' \| 'switch' \| 'segmented'` | `'icon'` | Visual style |
| `size` | `'sm' \| 'md'` | `'md'` | Component size |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ theme, isDark }` | Theme was changed |

## Animation Concepts

### Icon Morph
The sun and moon icons should smoothly morph between each other:
1. Sun rays retract while rotating
2. Circle morphs (sun shrinks, moon crescent forms)
3. Moon crescent and stars appear
4. Total duration: ~400ms

### Page Transition
When theme changes:
1. Brief crossfade (100ms)
2. Or: Circular reveal from toggle button position
3. Smooth color transitions on all elements

### Micro-interactions
- Icon has subtle float/glow
- Rotation on hover
- Satisfying "click" feel on toggle

## Features to Implement

### System Detection
```typescript
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
prefersDark.addEventListener('change', updateTheme);
```

### Persistence
- Save preference to localStorage
- Key: `theme-preference`
- Apply before page render (prevent flash)

### CSS Implementation
```css
:root {
  color-scheme: light dark;
}

:root[data-theme="light"] { /* light colors */ }
:root[data-theme="dark"] { /* dark colors */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark colors */ }
}
```

## Delightful Details

### No Flash of Wrong Theme
- Theme applied in `<head>` before body renders
- Blocking script reads localStorage
- SSR-compatible approach

### Smooth Color Transitions
```css
:root {
  transition: background-color 200ms, color 200ms;
}
```

### Animated Icon
- Sun rays animate individually
- Moon has subtle crescent animation
- Stars twinkle in dark mode

### Sound (Optional)
- Soft toggle sound
- Different for light vs dark
- Respect system sound preferences

### Tooltip
- Shows current mode on hover
- "Switch to dark mode" / "Switch to light mode"

## Accessibility

- Clear focus indicator
- Keyboard toggle (Space/Enter)
- ARIA label describing current state
- Respects `prefers-reduced-motion`

## Current Implementation

Currently a **placeholder** with props defined but no markup. Needs full implementation.

## Code Example

```svelte
<script>
  import { ThemeToggle } from '@delightstack/components';

  let theme = $state<'light' | 'dark' | 'auto'>('auto');
</script>

<!-- Simple icon toggle -->
<ThemeToggle bind:theme />

<!-- Full three-way control -->
<ThemeToggle
  bind:theme
  variant="segmented"
/>

<!-- Two-way switch (no auto) -->
<ThemeToggle
  bind:theme
  variant="switch"
  disableAuto
/>
```

### In Header/Navbar
```svelte
<header>
  <Logo />
  <nav>...</nav>
  <ThemeToggle size="sm" />
</header>
```

## Theme Application Script

Include in `<head>` to prevent flash:

```html
<script>
  (function() {
    const saved = localStorage.getItem('theme-preference');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || 'auto';
    const isDark = theme === 'dark' || (theme === 'auto' && prefersDark);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  })();
</script>
```

## Implementation Priority

**Medium priority** - Important for user preference but not blocking. Many apps launch with just light mode initially.
