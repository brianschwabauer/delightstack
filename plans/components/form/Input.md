# Input

**Status**: ✅ Complete
**Category**: Form
**File**: `packages/components/src/form/Input.svelte`

## Description

A comprehensive form input component that handles virtually every text and data input scenario. From simple text fields to complex date pickers, autocomplete, and file uploads. The workhorse of form building.

## Visual Design

### Default Appearance
- Clean, bordered input field
- Floating label that animates up on focus/value
- Subtle focus ring
- Helper text and error messaging below

### States
- **Default**: Subtle border, placeholder visible
- **Focused**: Accent border, label floated
- **Filled**: Label floated, value visible
- **Error**: Error border and message
- **Disabled**: Reduced opacity, no interaction

### Sizes

| Size | Height | Font |
|------|--------|------|
| `sm` | 32px | 14px |
| `md` | 40px | 16px |
| `lg` | 48px | 18px |

## Props

### Core Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `InputType` | `'text'` | Input type |
| `value` | `any` | - | Current value (bindable) |
| `label` | `string` | - | Floating label text |
| `placeholder` | `string` | - | Placeholder text |
| `disabled` | `boolean` | `false` | Disable input |
| `readonly` | `boolean` | `false` | Read-only mode |
| `required` | `boolean` | `false` | Mark as required |

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
| `size` | `Size` | `'md'` | Input size |
| `prefix` | `string` | - | Text before input |
| `suffix` | `string` | - | Text after input |
| `icon` | `Component` | - | Leading icon |
| `clearable` | `boolean` | `false` | Show clear button |
| `showCounter` | `boolean` | `false` | Show character count |
| `helper` | `string` | - | Helper text |

## Input Types

### Text Inputs
- `text`: Standard text input
- `email`: Email with validation
- `password`: Hidden text with reveal
- `url`: URL validation
- `tel`: Phone number
- `search`: Search with clear

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
- Dropdown suggestions
- Async loading
- Custom option rendering
- Keyboard navigation

### Multiple/Chips Mode
```svelte
<Input type="text" multiple bind:value={tags} />
```
- Enter to add chip
- Backspace to remove
- Chip display with removal

### Password Features
```svelte
<Input
  type="password"
  showToggle
  strengthIndicator
/>
```
- Toggle visibility
- Strength meter
- Requirements list

### Mask Input
```svelte
<Input type="text" mask="(###) ###-####" />
```
- Auto-formatting as you type
- Phone, credit card, etc.

## Delightful Details

### Floating Label
- Label starts as placeholder
- Animates up on focus/value
- Different color when focused
- Smooth transition (200ms)

### Focus Ring
- Clean accent color ring
- Animates in smoothly
- Visible for keyboard focus
- Subtle for mouse focus

### Error Animation
- Gentle shake on error
- Red border transition
- Error icon appears
- Message fades in

### Clear Button
- Appears when value present
- Hover shows clearly
- Click clears with animation
- Keyboard accessible

### Character Counter
- Shows current/max count
- Color changes approaching max
- Smooth number updates

### Autocomplete Dropdown
- Smooth appearance
- Highlight matches in options
- Keyboard navigation
- Loading state

## Accessibility

- Proper label association
- Error linked with aria-describedby
- Required indicator
- Keyboard fully functional
- Screen reader announcements

## Current Implementation

The current implementation is **complete** and extensive with:
- All input types supported
- Autocomplete with Floating UI
- File upload with drag-and-drop
- Date/time/color pickers
- Validation with error display
- Chips/multiple mode
- Full accessibility
- ~2200 lines of comprehensive functionality

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
```
