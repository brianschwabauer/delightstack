# Expand

**Status**: ✅ Complete
**Category**: Display
**File**: `packages/components/src/display/Expand.svelte`

## Description

A smooth animated container that expands and collapses content. Uses CSS Grid for height animation (the only reliable way to animate to/from `auto` height) and provides a polished reveal effect.

## Visual Design

### Expanded State
- Content fully visible
- No visual container (content determines appearance)
- Natural content flow

### Collapsed State
- Height: 0
- Content hidden with `visibility: hidden`
- Uses `inert` attribute to prevent interaction

### Transition
- Smooth height animation (300ms)
- Eased timing function
- No content clipping during animation

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `show` | `boolean` | `false` | Controls expanded state (bindable) |
| `duration` | `number` | `300` | Animation duration in ms |
| `style` | `string` | - | Additional inline styles |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## How It Works

The component uses the CSS Grid trick for animating height:

```css
.expand {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms ease;
}

.expand.open {
  grid-template-rows: 1fr;
}

.expand > .content {
  overflow: hidden;
}
```

This allows smooth animation to/from auto height without JavaScript measurement.

## Delightful Details

### Accessibility
- Uses `inert` attribute when collapsed
- Prevents focus trap in hidden content
- Screen readers skip collapsed content

### No Layout Shift
- Collapsed state takes no space
- Smooth transition prevents jarring shifts
- Content opacity can fade with height

### Overflow Handling
- Content overflow hidden during transition
- Revealed fully when expanded
- No content clipping at rest

## Current Implementation

The current implementation is **complete** with:
- Grid-based height animation
- `inert` attribute for accessibility
- Bindable show state
- Custom duration support

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

### In Accordion
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

## Integration Notes

This component is used internally by the Accordion component for its expand/collapse behavior.
