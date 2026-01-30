# IconSelector

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/IconSelector.svelte`

## Description

A searchable icon picker component for selecting icons from a predefined set. Useful for category selection, custom labels, or anywhere users need to choose an icon.

## Visual Design

### Trigger
- Shows selected icon
- Placeholder if none selected
- Click opens picker popover

### Picker Popover
- Search input at top
- Grid of available icons
- Category tabs (optional)
- Clear selection button

### Icons
- Consistent size grid
- Hover highlights
- Selected state indicator
- Icon name tooltip

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Selected icon name (bindable) |
| `icons` | `IconDefinition[]` | - | Available icons |
| `searchable` | `boolean` | `true` | Enable search |
| `categories` | `boolean` | `true` | Show category tabs |
| `placeholder` | `string` | `'Select icon'` | Placeholder text |
| `clearable` | `boolean` | `true` | Allow clearing |
| `disabled` | `boolean` | `false` | Disable selector |

### IconDefinition
```typescript
interface IconDefinition {
  name: string;
  component: Component;
  category?: string;
  keywords?: string[];
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ icon }` | Icon selected |
| `onclear` | - | Selection cleared |

## Features

### Search
- Filter icons by name
- Search keywords
- Highlight matches

### Categories
- Tab navigation
- Common categories: Actions, Objects, Communication, etc.
- "All" tab option

### Recent Icons
- Track recently selected
- Show at top or as separate section
- Persisted (optional)

### Custom Icons
- Support user-uploaded icons
- SVG upload integration
- Alongside built-in icons

## Delightful Details

### Instant Search
- No debounce needed (client-side)
- Results update immediately
- Clear feedback for no results

### Selection Animation
- Selected icon pops slightly
- Checkmark overlay
- Smooth close

### Keyboard Navigation
- Arrow keys to navigate grid
- Enter to select
- Escape to close
- Type to search

### Preview
- Larger preview of hovered icon
- Shows icon name
- Helps distinguish similar icons

## Built-in Icon Sets

Consider bundling subsets of popular icon libraries:
- Material Design Icons (subset)
- Heroicons (subset)
- Custom app icons

Or: Allow configuration of icon source.

## Accessibility

- Keyboard fully navigable
- Screen reader announces selections
- Icon names available as labels
- Focus management

## Code Example

```svelte
<script>
  import { IconSelector } from '@delightstack/components';
  import * as icons from '@delightstack/icons';

  let selectedIcon = $state('');

  // Convert icons to definitions
  const iconList = Object.entries(icons).map(([name, component]) => ({
    name,
    component,
    category: categorizeIcon(name)
  }));
</script>

<label>
  Category Icon
  <IconSelector
    bind:value={selectedIcon}
    icons={iconList}
  />
</label>

<!-- Compact usage -->
<IconSelector
  bind:value={category.icon}
  icons={iconList}
  searchable={false}
  categories={false}
/>

<!-- In a form -->
<Form>
  <Input label="Category Name" bind:value={name} />
  <IconSelector
    label="Icon"
    bind:value={icon}
    icons={iconList}
  />
  <Input type="color" label="Color" bind:value={color} />
</Form>
```

## Implementation Notes

- Virtualize icon grid for performance
- Lazy load icon components
- Cache search results
- Consider icon sprite sheet
- Handle missing icons gracefully
