# Expand

**Status**: Complete
**Category**: Display
**File**: `packages/components/src/display/Expand.svelte`

## Description

A smooth animated container that expands and collapses content. Uses CSS Grid for height animation (the only reliable way to animate to/from `auto` height) with the `grid-template-rows: 0fr` to `1fr` trick. Provides a polished reveal effect with no JavaScript measurement needed. Used internally by the Accordion component.

## Dependencies

- **Components**: none
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Expanded State
- Content fully visible
- No visual container (content determines appearance)
- Natural content flow

### Collapsed State
- Height: 0
- Content hidden with `visibility: hidden`
- Uses `inert` attribute to prevent interaction with hidden content

### Transition
- Smooth height animation (300ms default)
- Eased timing function
- No content clipping during animation
- Opacity fades with height

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `show` | `boolean` | `false` | Controls expanded state, bindable |
| `duration` | `number` | `300` | Animation duration in milliseconds |
| `style` | `string` | - | Additional inline styles |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Content to expand/collapse |

## How It Works

The component uses the CSS Grid trick for animating height:

```css
.expand {
  display: grid;
  grid-template-rows: min-content 0fr;
  transition: grid-template-rows 300ms ease, opacity 200ms;
  opacity: 0;
}

.expand::before {
  content: '';
}

.expand > * {
  overflow: hidden;
  visibility: hidden;
  transition: visibility 0ms 200ms;
}

.expand.show {
  opacity: 1;
  grid-template-rows: min-content 1fr;
}

.expand.show > * {
  visibility: visible;
  transition: visibility 0ms;
}
```

This allows smooth animation to/from auto height without JavaScript measurement. The `::before` pseudo-element with `min-content` row prevents layout collapse.

## Accessibility

- Uses `inert` attribute when collapsed to prevent focus trapping in hidden content
- Screen readers skip collapsed content entirely
- No ARIA attributes needed (the `inert` attribute handles it)

## No Layout Shift
- Collapsed state takes zero space in the layout
- Smooth transition prevents jarring content shifts
- Content opacity fades alongside height for a polished feel

## Code Example

```svelte
<script>
  import { Expand, Button } from '@delightstack/components';

  let showDetails = $state(false);
</script>

<Button onclick={() => showDetails = !showDetails}>
  {showDetails ? 'Hide' : 'Show'} Details
</Button>

<Expand bind:show={showDetails}>
  <div class="details-content">
    <p>Additional information that can be expanded...</p>
    <p>More content here...</p>
  </div>
</Expand>
```

### Used by Accordion
```svelte
{#each sections as section}
  <div class="accordion-item">
    <button onclick={() => activeSection = section.id}>
      {section.title}
    </button>
    <Expand show={activeSection === section.id}>
      {@html section.content}
    </Expand>
  </div>
{/each}
```

## Implementation Notes

- The current implementation is complete
- Grid-based height animation with `0fr` to `1fr` transition
- `inert` attribute on the wrapper when collapsed
- Bindable `show` state
- Custom duration support via CSS custom property
- Used internally by the Accordion component for expand/collapse behavior
