# Select

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Select.svelte`

## Description

A dropdown selection component for choosing from a list of options. Custom-styled alternative to native `<select>` with search, multi-select, and custom option rendering support.

## Visual Design

### Trigger
- Looks like an input field
- Displays selected value(s)
- Chevron indicator on right
- Click opens dropdown

### Dropdown
- Positioned below trigger (or above if no space)
- List of options
- Optional search input
- Clear visual for selected

### Options
- Hover highlight
- Checkmark for selected
- Support for icons/descriptions
- Grouped options support

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Selected value (bindable) |
| `options` | `Option[]` | `[]` | Available options |
| `multiple` | `boolean` | `false` | Allow multi-select |
| `searchable` | `boolean` | `false` | Enable search/filter |
| `clearable` | `boolean` | `false` | Show clear button |
| `creatable` | `boolean` | `false` | Allow creating new options by typing |
| `loading` | `boolean` | `false` | Show loading state |
| `disabled` | `boolean` | `false` | Disable select |
| `placeholder` | `string` | `'Select...'` | Placeholder text |
| `label` | `string` | - | Field label |
| `error` | `string` | - | Error message |
| `dense` | `boolean` | `false` | Compact option spacing |
| `comfortable` | `boolean` | `false` | Relaxed option spacing |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form element name |
| `class` | `string` | - | Additional CSS classes |

### Option Interface (Extended)
```typescript
interface Option {
  value: any;
  label: string;
  disabled?: boolean;
  icon?: Component;
  description?: string;  // Secondary text below label
  group?: string;
}
```

### Custom Value Rendering
```svelte
<Select options={users} bind:value={selectedUser}>
  {#snippet renderValue(selected)}
    <Avatar src={selected.avatar} size="xs" />
    <span>{selected.label}</span>
  {/snippet}
</Select>
```

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

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ value }` | Selection changed |
| `onsearch` | `{ query }` | Search query changed |
| `onopen` | - | Dropdown opened |
| `onclose` | - | Dropdown closed |

## Features

### Search/Filter
```svelte
<Select searchable options={countries} />
```
- Type to filter options
- Highlights matching text
- "No results" state

### Multi-Select
```svelte
<Select multiple bind:value={selectedTags} options={tags} />
```
- Checkboxes on options
- Chips display in trigger
- Count when many selected

### Option Groups
```svelte
const options = [
  { value: 'apple', label: 'Apple', group: 'Fruits' },
  { value: 'carrot', label: 'Carrot', group: 'Vegetables' },
  // ...
];
```
- Visual group headers
- Collapsible groups (optional)

### Async Options
```svelte
<Select
  searchable
  onsearch={async (query) => {
    options = await searchOptions(query);
  }}
/>
```
- Load options on search
- Loading indicator
- Debounced requests

### Custom Option Rendering
```svelte
<Select options={users}>
  {#snippet option(opt)}
    <div class="user-option">
      <Avatar src={opt.avatar} size="sm" />
      <span>{opt.label}</span>
    </div>
  {/snippet}
</Select>
```

## Delightful Details

### Smooth Dropdown
- Fade + slide animation
- Positioned with Floating UI
- Stays in viewport

### Keyboard Navigation
- Arrow keys navigate options
- Enter selects
- Escape closes
- Type-ahead search

### Multi-Select Chips
- Clean chip display
- "X" to remove individual
- "+N more" for overflow

### Loading State
- Spinner in dropdown
- Skeleton options
- Maintains dropdown height

### Virtual Scrolling
For large option lists:
- Only render visible options
- Smooth scrolling
- Performance optimized

## Accessibility

- Proper ARIA listbox/combobox
- Keyboard fully functional
- Screen reader announces selections
- Focus management

## Code Example

```svelte
<script>
  import { Select } from '@delightstack/components';

  let selectedCountry = $state('');
  let selectedTags = $state<string[]>([]);

  const countries = [
    { value: 'us', label: 'United States' },
    { value: 'uk', label: 'United Kingdom' },
    { value: 'ca', label: 'Canada' },
    // ...
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

<!-- Multi-select with tags -->
<Select
  multiple
  bind:value={selectedTags}
  options={tags}
  label="Tags"
  clearable
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

- Use Popover for dropdown positioning
- Virtual scroll for large lists (100+ options)
- Handle keyboard and mouse interactions
- Support native mobile select (optional)
- Form integration with hidden input
