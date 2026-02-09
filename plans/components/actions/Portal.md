# Portal

**Category**: Actions
**File**: `packages/components/src/actions/Portal.svelte`

## Description

A utility component that renders its children in a different location in the DOM tree. Essential for modals, tooltips, popovers, and other overlay content that needs to escape parent stacking contexts or overflow constraints. Also available as a Svelte action for more granular control.

## Dependencies

- **`@delightstack/utilities`**: _(none directly)_

## Visual Design

N/A -- Portal is a structural utility with no visual output of its own.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `target` | `string \| HTMLElement` | `'.portals'` | Destination element or CSS selector |
| `children` | `Snippet` | - | Content to portal |

## How It Works

1. Children are rendered normally in the Svelte component tree (reactivity intact).
2. On mount, the DOM nodes are moved to the target element.
3. Svelte reactivity, event handlers, and bindings continue to work across the portal boundary.
4. On unmount, nodes are removed from the target and cleaned up.

### Default Target

If no target is specified, Portal creates (or reuses) a `.portals` container at the end of `<body>`:

```html
<body>
  <!-- Your app content -->

  <div class="portals">
    <!-- Portal content rendered here -->
  </div>
</body>
```

## Svelte Action API

Also available as a Svelte action via `{@attach portal()}` for direct use on elements:

```svelte
<script>
  import { portal } from '@delightstack/utilities';
</script>

<div {@attach portal('#my-target')}>
  Content will be moved to #my-target
</div>
```

## Use Cases

### Escaping Overflow

```svelte
<div style="overflow: hidden;">
  <Portal>
    <!-- Menu renders outside the overflow container -->
    <DropdownMenu items={items} />
  </Portal>
</div>
```

### Z-Index Management

```svelte
<!-- Content at proper DOM level for z-index stacking -->
<Portal>
  <Modal bind:open={showModal}>
    Modal content here
  </Modal>
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

### Custom Target

```svelte
<Portal target="#notification-area">
  <Toast message="Saved successfully" />
</Portal>
```

## Integration Notes

Most overlay components (Modal, Popover, Toast, CommandPalette) handle portaling internally. Direct Portal usage is typically only needed for custom overlay patterns or when building new overlay components.

## Accessibility

- Maintains proper focus management across the portal boundary
- DOM order should match visual order when possible
- Use with `focusTrap` from `@delightstack/utilities` for modal content
- Screen readers follow DOM order, so portaled content appears at the portal target location

## Code Example

```svelte
<script>
  import { Portal, Modal, Button } from '@delightstack/components';

  let showModal = $state(false);
</script>

<Button onclick={() => showModal = true}>
  Open Modal
</Button>

<!-- Modal content portals to body level -->
<Portal>
  {#if showModal}
    <Modal bind:open={showModal} title="Example">
      <p>This modal is rendered at the body level via Portal.</p>
    </Modal>
  {/if}
</Portal>
```
