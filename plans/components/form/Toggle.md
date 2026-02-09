# Toggle

**Category**: Form
**File**: `packages/components/src/form/Toggle.svelte`

## Dependencies

- None (standalone component)

## Description

An on/off switch component for binary choices. More visually prominent than a checkbox, typically used for settings and preferences where the action is immediate. Features a slide animation with subtle bounce on the thumb and optional icon inside the thumb.

## Visual Design

### Appearance
- Pill-shaped track
- Circular thumb that slides left/right
- Clear on/off visual states using `--color-*` tokens
- Label to the side

### States
- **Off**: Neutral track (`--color-surface-alt`), thumb left
- **On**: Accent track (`--color-action`), thumb right
- **Focused**: Focus ring (`--color-focus-ring`) around track
- **Disabled**: Reduced opacity (0.5), `cursor: not-allowed`

### Sizes

| Size | Track Size | Thumb Size |
|------|------------|------------|
| `'0'` | 32x18px | 14px |
| `'1'` (default) | 44x24px | 20px |
| `'2'` | 56x30px | 26px |
| `'3'` | 68x36px | 32px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | `false` | Toggle state (`$bindable()`) |
| `disabled` | `boolean` | `false` | Disable toggle |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Toggle size |
| `label` | `string` | - | Label text |
| `labelPosition` | `'left' \| 'right'` | `'right'` | Label placement |
| `onLabel` | `string` | - | Label text when on |
| `offLabel` | `string` | - | Label text when off |
| `name` | `string` | - | Form field name for submission |
| `value` | `string` | - | Form value when checked (submitted with `name`) |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Tighter label spacing |
| `comfortable` | `boolean` | `false` | More label spacing |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Snippets

| Snippet | Parameter | Description |
|---------|-----------|-------------|
| `thumbIcon` | `{ checked: boolean }` | Custom icon rendered inside the thumb |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ checked }` | State changed |

## Usage Patterns

### Basic
```svelte
<Toggle bind:checked={darkMode} label="Dark Mode" />
```

### With On/Off Labels
```svelte
<Toggle
  bind:checked={notifications}
  onLabel="Notifications On"
  offLabel="Notifications Off"
/>
```

### Icon Inside Thumb
```svelte
<Toggle bind:checked={sound}>
  {#snippet thumbIcon({ checked })}
    {#if checked}
      <VolumeIcon />
    {:else}
      <MuteIcon />
    {/if}
  {/snippet}
</Toggle>
```

### Form Integration
```svelte
<Toggle
  bind:checked={premium}
  name="premium"
  value="true"
  label="Enable premium features"
/>
```
- When checked, submits `name=value` pair
- Hidden `<input type="checkbox">` for native form submission

### Without Label (Icon Only)
```svelte
<Toggle
  bind:checked={muted}
  aria-label="Toggle mute"
/>
```

## Styling

All colors use `--color-*` tokens:
- Off track: `--color-surface-alt`
- On track: `--color-action`
- Thumb: white (`--color-on-action`)
- Focus ring: `--color-focus-ring`
- Label: `--color-text`
- Disabled: opacity 0.5

Dark mode handled via `light-dark()`:
- Off track adapts to dark surface color
- Thumb shadow adjusts for dark backgrounds

## Delightful Details

### Slide Animation with Bounce
- Thumb slides from one side to the other
- Uses CSS `transition` with a custom cubic bezier for subtle overshoot
- `transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)`
- Thumb slightly overshoots then settles into position

### Track Color Transition
- Smooth color transition on the track (200ms)
- Color sweeps in direction of thumb travel

### Press State
- Thumb compresses slightly wider on press (squish effect)
- `border-radius` maintains pill shape
- Releases with spring back animation

### Focus Ring
- 2px ring using `--color-focus-ring`
- Surrounds entire track
- Only on `:focus-visible` (keyboard)

### Icon Transition
- If `thumbIcon` snippet is provided, icon crossfades on state change
- Icon sized proportionally to thumb

### Haptic Feedback
- On supported devices, triggers brief vibration via `navigator.vibrate(10)`
- Adds tactile feel on mobile

## Accessibility

- Hidden native `<input type="checkbox">` for semantics
- `role="switch"` on the custom element
- `aria-checked` reflects state
- Full keyboard support: Space and Enter to toggle
- Focus visible indicator
- Label associated via `<label>`

## Code Example

```svelte
<script>
  import { Toggle } from '@delightstack/components';

  let settings = $state({
    notifications: true,
    darkMode: false,
    autoSave: true,
    sounds: true
  });
</script>

<!-- Simple toggle -->
<Toggle
  bind:checked={settings.darkMode}
  label="Dark Mode"
  tooltip="Switch between light and dark theme"
/>

<!-- With dynamic label -->
<Toggle
  bind:checked={settings.notifications}
  onLabel="Notifications On"
  offLabel="Notifications Off"
/>

<!-- Settings list -->
<div class="settings-list">
  <Toggle
    bind:checked={settings.notifications}
    label="Push Notifications"
    name="notifications"
    value="enabled"
  />
  <Toggle
    bind:checked={settings.autoSave}
    label="Auto-save"
    name="autosave"
    value="enabled"
  />
  <Toggle
    bind:checked={settings.sounds}
    label="Sound Effects"
    name="sounds"
    value="enabled"
  />
</div>

<!-- Large toggle for emphasis -->
<Toggle
  bind:checked={premium}
  size="2"
  label="Enable Premium Features"
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `checked`
- Uses `$state()` for internal reactive state
- Hidden `<input type="checkbox">` for form submission and accessibility
- CSS `transform: translateX()` for thumb position
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- `{@render thumbIcon?.({ checked })}` for optional icon inside thumb
- `{@attach tooltip()}` for tooltip when `tooltip` prop is set
