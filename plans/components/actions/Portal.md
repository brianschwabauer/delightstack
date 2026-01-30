# Portal

**Status**: ✅ Complete
**Category**: Actions
**File**: `packages/components/src/actions/Portal.svelte`

## Description

A utility component that renders its children in a different location in the DOM tree. Essential for modals, tooltips, and other overlay content that needs to escape parent stacking contexts or overflow constraints.

## Visual Design

N/A - Portal is a structural utility with no visual output.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `target` | `string \| HTMLElement` | `'.portals'` | Destination element or selector |

## How It Works

1. Children are rendered normally in the component tree
2. On mount, DOM nodes are moved to the target element
3. Svelte reactivity continues to work across the portal
4. On unmount, nodes are cleaned up from target

### Default Target

If no target is specified, Portal creates/uses a `.portals` container at the end of `<body>`:

```html
<body>
  <!-- Your app content -->

  <div class="portals">
    <!-- Portal content rendered here -->
  </div>
</body>
```

## Use Cases

### Escaping Overflow
```svelte
<div style="overflow: hidden;">
  <Dropdown>
    <Portal>
      <!-- Menu renders outside the overflow container -->
      <Menu items={items} />
    </Portal>
  </Dropdown>
</div>
```

### Z-Index Management
```svelte
<!-- Content at proper DOM level for z-index stacking -->
<Portal>
  <Modal>...</Modal>
</Portal>
```

### Full-Screen Overlays
```svelte
<Portal target="body">
  <div class="fullscreen-overlay">
    <Gallery images={images} />
  </div>
</Portal>
```

## Svelte Action API

Also available as a Svelte action for more control:

```svelte
<script>
  import { portal } from '@delightstack/components';
</script>

<div use:portal={'#my-target'}>
  Content will be moved to #my-target
</div>
```

## Current Implementation

The current implementation is **complete** with:
- Component and action APIs
- CSS selector or HTMLElement targets
- Auto-creation of `.portals` container
- Proper cleanup on destroy

## Code Example

```svelte
<script>
  import { Portal, Modal } from '@delightstack/components';

  let showModal = $state(false);
</script>

<!-- Button stays in place -->
<button onclick={() => showModal = true}>
  Open Modal
</button>

<!-- Modal content portals to body level -->
<Portal>
  {#if showModal}
    <Modal bind:open={showModal}>
      Modal content here
    </Modal>
  {/if}
</Portal>
```

### Custom Target
```svelte
<!-- Render into a specific element -->
<Portal target="#notification-area">
  <Toast message="Saved successfully" />
</Portal>
```

## Integration Notes

Most overlay components (Modal, Popover, Toast) handle portaling internally. Direct Portal usage is typically only needed for custom overlay patterns.

## Accessibility

- Maintains proper focus management across portal boundary
- DOM order should match visual order when possible
- Use with focus trap for modal content
