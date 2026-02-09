# Select

**Category**: Form
**File**: `packages/components/src/form/Select.svelte`

## Dependencies

- `Popover` (dropdown positioning)
- `List` / `ListItem` (option rendering)
- `Chip` (multi-select display)
- `Spinner` (loading state)

## Description

A dropdown selection component for choosing from a list of options. Supports single and multi-select, search/filter input, option groups, async options loading, creatable mode (user can type new values), and virtual scrolling for large option lists. Uses Popover internally for the dropdown and List/ListItem for option rendering.

## Visual Design

### Trigger
- Looks like an input field with `--color-border` border
- Displays selected value text (single) or chips (multi)
- Chevron indicator on right
- Click or keyboard opens dropdown

### Dropdown
- Positioned via Popover (below trigger, or above if no space)
- Optional search input at top
- Scrollable option list using List/ListItem
- Group headers for grouped options
- Virtual scrolling for 100+ options

### Options
- Hover highlight using `--color-surface-hover`
- Checkmark icon for selected option(s)
- Support for icons, descriptions, and disabled state per option
- Grouped options with visual section headers

### States
- **Default**: Trigger with placeholder or selected value
- **Open**: Dropdown visible, trigger has focus ring
- **Loading**: Spinner in dropdown, skeleton options
- **Error**: Trigger border `--color-error`, error message below
- **Disabled**: Reduced opacity (0.5), no interaction
- **Skeleton**: Pulsing placeholder block on trigger

### Sizes

| Size | Trigger Height | Font Size |
|------|----------------|-----------|
| `'0'` | 28px | 13px |
| `'1'` (default) | 36px | 15px |
| `'2'` | 44px | 17px |
| `'3'` | 52px | 19px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Selected value (`$bindable()`). Single value or array for multi-select |
| `options` | `Option[]` | `[]` | Available options |
| `multiple` | `boolean` | `false` | Allow multi-select |
| `searchable` | `boolean` | `false` | Enable search/filter input in dropdown |
| `clearable` | `boolean` | `false` | Show clear button on trigger |
| `creatable` | `boolean` | `false` | Allow creating new options by typing |
| `loading` | `boolean` | `false` | Show loading state in dropdown |
| `disabled` | `boolean` | `false` | Disable select |
| `placeholder` | `string` | `'Select...'` | Placeholder text |
| `label` | `string` | - | Field label |
| `error` | `string` | - | Error message |
| `required` | `boolean` | `false` | Mark as required |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Trigger and option size |
| `skeleton` | `boolean` | `false` | Show skeleton loading state |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `dense` | `boolean` | `false` | Compact option spacing |
| `comfortable` | `boolean` | `false` | Relaxed option spacing |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

### Option Interface

```typescript
interface Option {
  value: any;
  label: string;
  disabled?: boolean;
  icon?: Component;
  description?: string;
  group?: string;
}
```

## Snippets

| Snippet | Parameter | Description |
|---------|-----------|-------------|
| `renderValue` | `selected: Option \| Option[]` | Custom rendering of the selected value in the trigger |
| `option` | `opt: Option` | Custom rendering of each option in the dropdown |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Selection changed |
| `onsearch` | `{ query: string }` | Search query changed (for async loading) |
| `oncreate` | `{ value: string }` | New value created in creatable mode. Return `false` to reject |
| `onopen` | - | Dropdown opened |
| `onclose` | - | Dropdown closed |

## Features

### Search/Filter
```svelte
<Select searchable options={countries} bind:value={country} />
```
- Type to filter options by label
- Highlights matching text in option labels
- "No results" empty state
- Search input auto-focused when dropdown opens

### Multi-Select with Chips
```svelte
<Select multiple bind:value={selectedTags} options={tags} />
```
- Checkboxes on each option in dropdown
- Selected values shown as Chip components in trigger
- Each chip has an `x` button to remove
- "+N more" overflow text when chips exceed trigger width
- Clicking a selected option deselects it

### Option Groups
```svelte
const options = [
  { value: 'apple', label: 'Apple', group: 'Fruits' },
  { value: 'banana', label: 'Banana', group: 'Fruits' },
  { value: 'carrot', label: 'Carrot', group: 'Vegetables' },
  { value: 'broccoli', label: 'Broccoli', group: 'Vegetables' },
];
```
- Visual group headers rendered as non-interactive List section dividers
- Options grouped by their `group` property
- Groups maintain order based on first appearance

### Async Options Loading
```svelte
<Select
  searchable
  loading={isLoading}
  onsearch={async ({ query }) => {
    isLoading = true;
    options = await searchAPI(query);
    isLoading = false;
  }}
  bind:value={selected}
  options={dynamicOptions}
/>
```
- Triggered on search input change
- Spinner shown during loading
- Debounced internally (300ms)
- Skeleton option placeholders while loading

### Creatable Mode
```svelte
<Select
  creatable
  searchable
  oncreate={({ value }) => {
    if (value.length < 2) return false;
    options = [...options, { value, label: value }];
  }}
  bind:value={selected}
  options={tags}
/>
```
- When search query matches no options, shows "Create {query}" option
- `oncreate` callback for validating and adding new values
- Return `false` from `oncreate` to reject the value
- New option added to the list and auto-selected

### Virtual Scrolling
- Activated automatically for option lists of 100+ items
- Only renders visible options in the DOM
- Smooth scroll behavior maintained
- Keyboard navigation works seamlessly with virtual list

### Custom Value Rendering
```svelte
<Select options={users} bind:value={selectedUser}>
  {#snippet renderValue(selected)}
    <Avatar src={selected.avatar} size="0" />
    <span>{selected.label}</span>
  {/snippet}
</Select>
```

### Custom Option Rendering
```svelte
<Select options={users} bind:value={selectedUser}>
  {#snippet option(opt)}
    <div class="user-option">
      <Avatar src={opt.avatar} size="0" />
      <div>
        <span>{opt.label}</span>
        <span class="email">{opt.description}</span>
      </div>
    </div>
  {/snippet}
</Select>
```

## Styling

All colors use `--color-*` tokens:
- Trigger border: `--color-border`, focused: `--color-action`
- Trigger background: `light-dark(var(--color-surface), var(--color-surface))`
- Dropdown background: `--color-surface`
- Dropdown shadow: `--shadow-lg`
- Option hover: `--color-surface-hover`
- Selected option: `--color-action` checkmark
- Group header: `--color-text-muted`, uppercase, smaller font
- Error: `--color-error`
- Focus ring: `--color-focus-ring`

## Delightful Details

### Smooth Dropdown
- Fade + slide animation via Popover (150ms)
- Scales from 0.95 to 1.0
- Stays in viewport with auto-flip

### Keyboard Navigation
- Arrow keys navigate options (skips disabled)
- Enter selects highlighted option
- Escape closes dropdown
- Type-ahead: typing characters jumps to matching option
- Home/End jump to first/last option

### Multi-Select Chips
- Chips animate in when added (scale from 0)
- Chips animate out when removed
- "+N more" appears when space runs out
- Clear all button when `clearable` is set

### Loading State
- Spinner centered in dropdown
- Skeleton option shapes (3 items)
- Maintains dropdown height to prevent flicker

### Search Highlight
- Matching portion of option label shown in bold
- Case-insensitive matching
- Matches anywhere in label string

## Accessibility

- Trigger: `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`
- Dropdown: `role="listbox"` (via List)
- Options: `role="option"`, `aria-selected`
- Search input: `aria-label="Search options"`
- Keyboard fully functional (Tab, Arrow, Enter, Escape, Home, End)
- Screen reader announces: selected value, option count, navigation position
- Focus management: focus moves to search/first option on open, returns to trigger on close
- Multi-select: `aria-multiselectable="true"` on listbox

## Code Example

```svelte
<script>
  import { Select } from '@delightstack/components';

  let selectedCountry = $state('');
  let selectedTags = $state<string[]>([]);

  const countries = [
    { value: 'us', label: 'United States', group: 'North America' },
    { value: 'ca', label: 'Canada', group: 'North America' },
    { value: 'uk', label: 'United Kingdom', group: 'Europe' },
    { value: 'de', label: 'Germany', group: 'Europe' },
  ];

  const tags = [
    { value: 'featured', label: 'Featured' },
    { value: 'new', label: 'New' },
    { value: 'sale', label: 'On Sale' },
  ];
</script>

<!-- Basic select -->
<Select
  bind:value={selectedCountry}
  options={countries}
  label="Country"
  placeholder="Select a country"
/>

<!-- Searchable select -->
<Select
  bind:value={selectedCountry}
  options={countries}
  searchable
  label="Country"
/>

<!-- Multi-select with chips -->
<Select
  multiple
  bind:value={selectedTags}
  options={tags}
  label="Tags"
  clearable
/>

<!-- Creatable select -->
<Select
  creatable
  searchable
  bind:value={selectedTags}
  options={tags}
  multiple
  label="Tags"
  oncreate={({ value }) => {
    tags = [...tags, { value, label: value }];
  }}
/>

<!-- With skeleton -->
<Select
  skeleton={loading}
  bind:value={category}
  options={categories}
  label="Category"
/>

<!-- With tooltip -->
<Select
  bind:value={priority}
  options={priorities}
  label="Priority"
  tooltip="Set the task priority level"
/>

<!-- With error -->
<Select
  bind:value={category}
  options={categories}
  label="Category"
  error={!category ? 'Please select a category' : ''}
  required
/>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `value`
- Uses `$state()` for internal reactive state (open, search query, highlighted index)
- Popover for dropdown positioning with flip and shift middleware
- List/ListItem for option rendering within dropdown
- Chip components for multi-select display in trigger
- Hidden `<input>` (or multiple hidden inputs for multi) for native form submission
- Virtual scrolling implemented when `options.length >= 100`
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- `{@render option?.()}` and `{@render renderValue?.()}` for custom snippets
- `{@attach tooltip()}` for tooltip when `tooltip` prop is set
