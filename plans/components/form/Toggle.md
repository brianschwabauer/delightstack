# Toggle

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Toggle.svelte`

## Description

An on/off switch component for binary choices. More visually prominent than a checkbox, typically used for settings and preferences where the action is immediate.

## Visual Design

### Appearance
- Pill-shaped track
- Circular thumb that slides
- Clear on/off visual states
- Label to the side

### States
- **Off**: Neutral/gray track, thumb left
- **On**: Accent track, thumb right
- **Focused**: Focus ring around track
- **Disabled**: Reduced opacity

### Sizes

| Size | Track Size | Thumb Size |
|------|------------|------------|
| `sm` | 32x18px | 14px |
| `md` | 44x24px | 20px |
| `lg` | 56x30px | 26px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | `false` | Toggle state (bindable) |
| `disabled` | `boolean` | `false` | Disable toggle |
| `size` | `Size` | `'md'` | Toggle size |
| `label` | `string` | - | Label text |
| `labelPosition` | `'left' \| 'right'` | `'right'` | Label placement |
| `onLabel` | `string` | - | Label when on |
| `offLabel` | `string` | - | Label when off |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ checked }` | State changed |

## Variants

### Basic
```svelte
<Toggle bind:checked={darkMode} label="Dark Mode" />
```

### With On/Off Labels
```svelte
<Toggle
  bind:checked={notifications}
  onLabel="Enabled"
  offLabel="Disabled"
/>
```

### Icon Inside
```svelte
<Toggle bind:checked={sound}>
  {#snippet thumbIcon()}
    {#if sound}
      <VolumeIcon />
    {:else}
      <MuteIcon />
    {/if}
  {/snippet}
</Toggle>
```

### Without Label (Icon Only)
```svelte
<Toggle
  bind:checked={muted}
  aria-label="Toggle mute"
/>
```

## Delightful Details

### Slide Animation
- Thumb slides smoothly
- Track color transitions
- Eased timing (300ms)

### Bounce Effect
- Slight overshoot on slide
- Elastic settle
- Satisfying feel

### Focus Ring
- Clear focus indicator
- Matches system style
- Keyboard accessible

### Press State
- Thumb compresses slightly
- Indicates active press
- Releases with animation

### Track Color Transition
- Smooth fill transition
- Color sweeps with thumb
- Or: fade between colors

### Haptic Feedback
- On supported devices
- Brief vibration on toggle
- Adds tactility

## iOS-Style Option

```svelte
<Toggle variant="ios" bind:checked={setting} />
```
- Green track when on
- White thumb always
- iOS-familiar design

## Accessibility

- Native checkbox semantics
- Full keyboard support (Space/Enter)
- ARIA states
- Focus visible

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
  />
  <Toggle
    bind:checked={settings.autoSave}
    label="Auto-save"
  />
  <Toggle
    bind:checked={settings.sounds}
    label="Sound Effects"
  />
</div>

<!-- Large toggle for emphasis -->
<Toggle
  bind:checked={premium}
  size="lg"
  label="Enable Premium Features"
/>
```

## Implementation Notes

- Use hidden checkbox for accessibility
- CSS transforms for thumb animation
- Handle touch and drag gestures
- Support form submission
- Proper disabled styling
