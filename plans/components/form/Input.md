# Input

**Status**: ✅ Complete
**Category**: Form
**File**: `packages/components/src/form/Input.svelte`

## Dependencies

- `Popover` (autocomplete dropdown positioning)
- `Chip` (multiple/chips mode display)
- `@delightstack/utilities` (`generateId`)

## Description

A comprehensive form input component that handles virtually every text and data input scenario. From simple text fields to complex date pickers, autocomplete, and file uploads. The workhorse of form building.

## Visual Design

### Default Appearance
- Clean, bordered input field
- Floating label that animates up on focus/value
- Subtle focus ring using `--color-focus-ring`
- Helper text and error messaging below

### States
- **Default**: Subtle border (`--color-border`), placeholder visible
- **Focused**: Accent border (`--color-action`), label floated
- **Filled**: Label floated, value visible
- **Error**: Error border (`--color-error`) and message
- **Disabled**: Reduced opacity, no interaction
- **Skeleton**: Pulsing placeholder block, no interactive elements

### Sizes

| Size | Height | Font |
|------|--------|------|
| `'0'` | 28px | 13px |
| `'1'` (default) | 36px | 15px |
| `'2'` | 44px | 17px |
| `'3'` | 52px | 19px |

## Props

### Core Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `InputType` | `'text'` | Input type |
| `value` | `any` | - | Current value (`$bindable()`) |
| `label` | `string` | - | Floating label text |
| `placeholder` | `string` | - | Placeholder text |
| `disabled` | `boolean` | `false` | Disable input |
| `readonly` | `boolean` | `false` | Read-only mode |
| `required` | `boolean` | `false` | Mark as required |
| `name` | `string` | - | Form field name (used for Form context registration) |
| `skeleton` | `boolean` | `false` | Show skeleton loading state |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |

### Validation
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `error` | `string \| boolean` | - | Error message |
| `pattern` | `string` | - | Regex pattern |
| `minlength` | `number` | - | Minimum length |
| `maxlength` | `number` | - | Maximum length |
| `min` | `number` | - | Minimum value |
| `max` | `number` | - | Maximum value |

### Visual Options
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Input size |
| `prefix` | `string` | - | Text before input |
| `suffix` | `string` | - | Text after input |
| `icon` | `Component` | - | Leading icon |
| `clearable` | `boolean` | `false` | Show clear button |
| `showCounter` | `boolean` | `false` | Show character count |
| `helper` | `string` | - | Helper text |
| `dense` | `boolean` | `false` | Tighter internal spacing |
| `comfortable` | `boolean` | `false` | More internal spacing |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Autocomplete Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `Option[]` | - | Suggestion options for autocomplete |
| `onfilter` | `(query: string) => Promise<Option[]>` | - | Async filter callback for loading suggestions |

### Multiple/Chips Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `multiple` | `boolean` | `false` | Enable chips/tags mode |

### Textarea Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rows` | `number` | `3` | Initial rows for textarea |
| `autoResize` | `boolean` | `false` | Auto-grow textarea to fit content |

### Password Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showToggle` | `boolean` | `false` | Show password visibility toggle |
| `strengthIndicator` | `boolean` | `false` | Show password strength meter |

### Mask Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mask` | `string` | - | Input mask pattern (e.g. `'(###) ###-####'`) |

### File Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `accept` | `string` | - | Accepted file types |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `oninput` | `{ value }` | Value changing |
| `onchange` | `{ value }` | Value committed |
| `onfocus` | - | Input focused |
| `onblur` | - | Input blurred |

## Input Types

### Text Inputs
- `text`: Standard text input
- `email`: Email with validation
- `password`: Hidden text with reveal toggle
- `url`: URL validation
- `tel`: Phone number
- `search`: Search with clear button

### Number Input
```svelte
<Input type="number" min={0} max={100} step={5} />
```
- Increment/decrement buttons
- Validation for range

### Textarea
```svelte
<Input type="textarea" rows={4} autoResize />
```
- Multi-line text
- Auto-resize option
- Character counter

### Date/Time
```svelte
<Input type="date" />
<Input type="time" />
<Input type="datetime" />
```
- Native or custom picker
- Format localization
- Min/max date constraints

### Color
```svelte
<Input type="color" />
```
- Color picker popover
- Preview swatch
- Various formats (hex, rgb)

### File
```svelte
<Input type="file" accept="image/*" multiple />
```
- File selection
- Drag and drop
- Preview (images)
- Multiple file support

## Advanced Features

### Autocomplete
```svelte
<Input
  type="text"
  options={suggestions}
  onfilter={async (query) => fetchSuggestions(query)}
/>
```
- Dropdown suggestions via Popover
- Async loading with spinner
- Custom option rendering via `{#snippet option(opt)}`
- Keyboard navigation (arrow keys, Enter, Escape)
- Highlight matching text in options

### Multiple/Chips Mode
```svelte
<Input type="text" multiple bind:value={tags} />
```
- Enter to add chip
- Backspace to remove last chip
- Chip display with `x` removal button
- Overflow wrapping

### Password Features
```svelte
<Input
  type="password"
  showToggle
  strengthIndicator
/>
```
- Toggle visibility icon button
- Strength meter bar (weak/medium/strong/very strong)
- Color coded: `--color-error` to `--color-success`

### Mask Input
```svelte
<Input type="text" mask="(###) ###-####" />
```
- Auto-formatting as you type
- Phone, credit card, date patterns
- `#` = digit, `A` = letter, `*` = any

## Styling

All colors use `--color-*` tokens:
- Border: `--color-border`, focused: `--color-action`
- Error: `--color-error`
- Label text: `--color-text-muted`
- Background: `light-dark(var(--color-surface), var(--color-surface))`
- Focus ring: `--color-focus-ring`

## Delightful Details

### Floating Label
- Label starts as placeholder position
- Animates up on focus/value (200ms ease)
- Uses `--color-action` when focused
- Returns down when empty and blurred

### Focus Ring
- Clean accent color ring
- Animates in smoothly
- Visible for keyboard focus (`:focus-visible`)
- Subtle for mouse focus

### Error Animation
- Gentle shake on error (CSS keyframe)
- Red border transition
- Error icon appears
- Message fades in

### Clear Button
- Appears when value present
- Hover shows emphasis
- Click clears with fade animation
- Keyboard accessible

### Character Counter
- Shows current/max count
- Color changes approaching max (uses `--color-warning` near limit, `--color-error` at limit)
- Smooth number transitions

### Autocomplete Dropdown
- Smooth appearance via Popover
- Highlight matching text in bold
- Keyboard navigation with visual indicator
- Loading spinner state

## Accessibility

- Proper `<label>` association via `for`/`id`
- Error linked with `aria-describedby`
- Required indicator (`aria-required`)
- Keyboard fully functional
- Screen reader announcements for autocomplete results
- `aria-invalid` on error state

## Code Example

```svelte
<script>
  import { Input } from '@delightstack/components';

  let email = $state('');
  let bio = $state('');
  let tags = $state<string[]>([]);
</script>

<!-- Basic text input -->
<Input
  label="Name"
  placeholder="Enter your name"
  bind:value={name}
  required
/>

<!-- Email with validation -->
<Input
  type="email"
  label="Email"
  bind:value={email}
  error={emailError}
/>

<!-- Textarea with counter -->
<Input
  type="textarea"
  label="Bio"
  bind:value={bio}
  maxlength={500}
  showCounter
  rows={4}
/>

<!-- Autocomplete -->
<Input
  label="City"
  options={cities}
  bind:value={selectedCity}
/>

<!-- Tags input -->
<Input
  label="Tags"
  multiple
  bind:value={tags}
  placeholder="Add tags..."
/>

<!-- File upload -->
<Input
  type="file"
  label="Profile Picture"
  accept="image/*"
  bind:value={profileFile}
/>

<!-- Masked phone number -->
<Input
  label="Phone"
  mask="(###) ###-####"
  bind:value={phone}
/>

<!-- With skeleton -->
<Input label="Name" skeleton={loading} bind:value={name} />

<!-- With tooltip -->
<Input
  label="API Key"
  tooltip="Your unique API key from the dashboard"
  bind:value={apiKey}
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `value`
- Uses `$state()` for internal reactive state
- Hidden native `<input>` for form submission and accessibility
- Autocomplete dropdown uses Popover for positioning
- Chips mode renders Chip components for each value
- SVG-based icons for clear, password toggle, increment/decrement
- All animations use CSS transitions and keyframes
- Approximately 2200 lines of comprehensive functionality
