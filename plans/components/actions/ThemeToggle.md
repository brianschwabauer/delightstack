# ThemeToggle

**Category**: Actions
**File**: `packages/components/src/actions/ThemeToggle.svelte`

## Description

A delightful theme switcher component that cycles between light, dark, and system-auto modes. Features a smooth sun-to-moon icon morph animation and handles all the plumbing: `color-scheme` on `<html>`, class toggling, `localStorage` persistence, system preference detection, and an anti-flash script for SSR/static pages.

## Dependencies

- **`@delightstack/utilities`**:
  - `tooltip` -- hover tooltip showing current state (`{@attach tooltip(label)}`)

## Visual Design

### Icon Morph (Default Appearance)
The component renders as a circular icon button. The sun and moon icons morph smoothly into each other:

1. **Sun to Moon**: Sun rays retract while the circle rotates slightly. The circle clips into a crescent shape as a "shadow" element slides in. Total: `~400ms`.
2. **Moon to Sun**: Crescent fills back to full circle, rays extend outward with a subtle stagger. Total: `~400ms`.
3. **Auto state**: A combined icon (half sun / half moon, or a monitor icon) indicates system preference is active.

The morph is done with CSS transforms, `clip-path`, and `opacity` transitions on SVG paths -- no sprite swaps.

### Hover State
- Subtle background circle appears
- Icon rotates slightly on hover

### Touch Target
- Minimum `40px` touch target
- Circular hit area

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Current theme preference (`$bindable()`) |
| `isDark` | `boolean` | - | Computed resolved dark state (`$bindable()`, read-only). True when the effective appearance is dark, whether due to explicit `'dark'` or `'auto'` matching a dark system preference. |
| `size` | `'0' \| '1' \| '2'` | `'1'` | Component size (`'0'` = `32px`, `'1'` = `40px`, `'2'` = `48px`) |
| `disableAuto` | `boolean` | `false` | Hide the auto/system option (two-state toggle: light and dark only) |
| `tooltip` | `string` | - | Override the default tooltip text. By default shows `"Switch to dark mode"` / `"Switch to light mode"` / `"Using system theme"`. |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `onchange` | `(detail: { theme: 'light' \| 'dark' \| 'auto', isDark: boolean }) => void` | - | Called when the theme changes |

## Three States

| State | Icon | `color-scheme` | Class on `<html>` |
|-------|------|---------------|--------------------|
| `'light'` | Sun | `light` | `light` |
| `'dark'` | Moon | `dark` | `dark` |
| `'auto'` | System/half icon | `light dark` | _(none -- removed, browser follows system)_ |

Clicking cycles: `auto` -> `light` -> `dark` -> `auto` (or `light` -> `dark` -> `light` when `disableAuto` is true).

## Theme Application

When the theme changes, the component:

1. Sets `document.documentElement.style.colorScheme` to the resolved value (`'light'` or `'dark'`, or `'light dark'` for auto).
2. Sets a class on `<html>` (`light` or `dark`) for CSS selectors that need explicit mode targeting. Removes the class entirely for `auto`.
3. Saves the preference to `localStorage` under the key `'delightstack:theme'`.

### System Preference Detection

```typescript
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Reactive: re-evaluate isDark when system preference changes
mediaQuery.addEventListener('change', (e) => {
  if (theme === 'auto') {
    isDark = e.matches;
    applyTheme();
  }
});
```

### localStorage Persistence

```typescript
// Save
localStorage.setItem('delightstack:theme', theme);

// Restore on mount
const saved = localStorage.getItem('delightstack:theme');
if (saved === 'light' || saved === 'dark' || saved === 'auto') {
  theme = saved;
}
```

## Anti-Flash Script

Ship a documented export that users add to their HTML `<head>` to prevent a flash of wrong theme on page load. This script runs synchronously before the body renders.

### Exported Helper

```typescript
// packages/components/src/actions/themeScript.ts
export const themeScript = `
(function() {
  try {
    var saved = localStorage.getItem('delightstack:theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (saved === 'light' || saved === 'dark' || saved === 'auto') ? saved : 'auto';
    var isDark = theme === 'dark' || (theme === 'auto' && prefersDark);
    var html = document.documentElement;
    html.style.colorScheme = theme === 'auto' ? 'light dark' : (isDark ? 'dark' : 'light');
    if (theme !== 'auto') {
      html.classList.add(isDark ? 'dark' : 'light');
      html.classList.remove(isDark ? 'light' : 'dark');
    }
  } catch(e) {}
})();
`;
```

### Usage in SvelteKit

```svelte
<!-- src/app.html -->
<head>
  <script>
    // Inline the anti-flash script (or import and inject at build time)
    (function() {
      try {
        var saved = localStorage.getItem('delightstack:theme');
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        var theme = (saved === 'light' || saved === 'dark' || saved === 'auto') ? saved : 'auto';
        var isDark = theme === 'dark' || (theme === 'auto' && prefersDark);
        var html = document.documentElement;
        html.style.colorScheme = theme === 'auto' ? 'light dark' : (isDark ? 'dark' : 'light');
        if (theme !== 'auto') {
          html.classList.add(isDark ? 'dark' : 'light');
          html.classList.remove(isDark ? 'light' : 'dark');
        }
      } catch(e) {}
    })();
  </script>
</head>
```

Or programmatically in a `+layout.server.ts` / hook:

```typescript
import { themeScript } from '@delightstack/components';

// Inject into <head> during SSR
```

## Delightful Details

### Icon Morph Animation
- Sun rays animate individually with staggered timing
- Circle-to-crescent transition uses `clip-path` for a clean mask
- Respects `prefers-reduced-motion` (cross-fades instead of morphing)

### Smooth Color Transitions
When the theme changes, a global CSS transition provides a smooth crossfade:

```css
html.theme-transitioning,
html.theme-transitioning * {
  transition:
    background-color var(--duration-normal) var(--ease-default),
    color var(--duration-normal) var(--ease-default),
    border-color var(--duration-normal) var(--ease-default) !important;
}
```

The `theme-transitioning` class is added briefly during the switch and removed after the transition completes.

### Tooltip
- Default tooltip text reflects the next action: `"Switch to dark mode"`, `"Switch to light mode"`, or `"Using system theme"`
- Applied via `{@attach tooltip(label)}` from `@delightstack/utilities`

## Accessibility

- `<button>` element with clear `aria-label` describing current state and action
- Keyboard toggle via Space / Enter
- Focus ring using `--color-focus-ring`
- `prefers-reduced-motion` respected: morph becomes a simple crossfade
- Screen reader announces the new state on change

## Code Example

### Basic Usage

```svelte
<script>
  import { ThemeToggle } from '@delightstack/components';

  let theme = $state<'light' | 'dark' | 'auto'>('auto');
</script>

<ThemeToggle bind:theme />
```

### Two-State Toggle (No Auto)

```svelte
<ThemeToggle bind:theme disableAuto />
```

### In a Header / Navbar

```svelte
<script>
  import { ThemeToggle } from '@delightstack/components';
</script>

<header class="app-header">
  <Logo />
  <nav>...</nav>
  <ThemeToggle size="0" />
</header>
```

### Reacting to Changes

```svelte
<script>
  import { ThemeToggle } from '@delightstack/components';

  let theme = $state<'light' | 'dark' | 'auto'>('auto');
  let isDark = $state(false);
</script>

<ThemeToggle
  bind:theme
  bind:isDark
  onchange={({ theme, isDark }) => {
    console.log(`Theme: ${theme}, Dark: ${isDark}`);
  }}
/>

{#if isDark}
  <p>Dark mode is active</p>
{/if}
```

## CSS Approach

```css
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  color: var(--color-text);
  transition: background var(--duration-fast) var(--ease-default);

  &:hover {
    background: var(--color-overlay-hover);
  }

  &:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
}

.theme-toggle-icon {
  position: relative;
  width: 1.25rem;
  height: 1.25rem;
}

/* Sun icon */
.theme-toggle-sun {
  position: absolute;
  inset: 0;
  transition:
    transform var(--duration-slow) var(--ease-spring),
    opacity var(--duration-normal) var(--ease-default);
}

/* Moon icon */
.theme-toggle-moon {
  position: absolute;
  inset: 0;
  transition:
    transform var(--duration-slow) var(--ease-spring),
    opacity var(--duration-normal) var(--ease-default);
}

/* Active states */
.theme-toggle[data-theme='light'] .theme-toggle-sun {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.theme-toggle[data-theme='light'] .theme-toggle-moon {
  opacity: 0;
  transform: rotate(-90deg) scale(0.5);
}

.theme-toggle[data-theme='dark'] .theme-toggle-sun {
  opacity: 0;
  transform: rotate(90deg) scale(0.5);
}

.theme-toggle[data-theme='dark'] .theme-toggle-moon {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .theme-toggle-sun,
  .theme-toggle-moon {
    transition: opacity var(--duration-fast) var(--ease-default);
    transform: none !important;
  }
}
```
