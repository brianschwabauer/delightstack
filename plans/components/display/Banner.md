# Banner

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Banner.svelte`

## Description

A full-width announcement bar for important messages, promotions, or system notifications. Typically positioned at the top of the page, above the main navigation.

## Visual Design

### Layout
- Full viewport width
- Fixed height (auto or explicit)
- Centered content with max-width
- Optional close button

### Structure
```
[Icon?] [Message Text] [Action Button?] [Close?]
```

### Variants

| Variant | Background | Use Case |
|---------|------------|----------|
| `info` | `--color-info` | General announcements |
| `success` | `--color-success` | Positive news |
| `warning` | `--color-warning` | Important notices |
| `error` | `--color-error` | Critical alerts |
| `neutral` | `--color-surface-2` | Subtle announcements |

### Styles
- **Solid**: Full background color
- **Soft**: Light tinted background
- **Gradient**: Subtle gradient background

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `'info'` | Color variant |
| `style` | `'solid' \| 'soft' \| 'gradient'` | `'solid'` | Visual style |
| `dismissible` | `boolean` | `false` | Show close button |
| `icon` | `Component` | - | Leading icon |
| `sticky` | `boolean` | `false` | Stick to top on scroll |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ondismiss` | - | Close button clicked |

## Content Slots

```svelte
<Banner variant="info">
  {#snippet icon()}
    <MegaphoneIcon />
  {/snippet}

  New feature: Dark mode is now available!

  {#snippet action()}
    <Button size="small" variant="ghost">Try it</Button>
  {/snippet}
</Banner>
```

## Behavior

### Dismissible
- Close button on right
- Animates out when dismissed
- Optional persist to localStorage

### Sticky
- Sticks to viewport top
- Subtle shadow when scrolled
- Proper z-index layering

## Delightful Details

### Entrance Animation
- Slide down from top
- Or: Fade in with slight translate
- Duration: 300ms

### Exit Animation
- Collapse height smoothly
- Content fades out
- No layout jump

### Scroll Behavior
When sticky:
- Smooth transition to sticky state
- Shadow appears when elevated
- Doesn't interfere with main nav

## Accessibility

- `role="alert"` for important messages
- Close button has clear label
- Color not sole indicator

## Code Example

```svelte
<script>
  import { Banner } from '@delightstack/components';

  let showBanner = $state(true);
</script>

{#if showBanner}
  <Banner
    variant="info"
    dismissible
    ondismiss={() => showBanner = false}
  >
    We've updated our privacy policy.
    {#snippet action()}
      <a href="/privacy">Learn more</a>
    {/snippet}
  </Banner>
{/if}

<!-- Warning banner -->
<Banner variant="warning" sticky>
  <WarningIcon slot="icon" />
  Scheduled maintenance tonight at 11pm UTC.
</Banner>

<!-- Success banner -->
<Banner variant="success">
  Your changes have been saved successfully!
</Banner>
```

## Implementation Notes

- Use semantic `<aside>` or `<div role="banner">`
- Handle multiple banners stacking
- Consider mobile layout (may need to wrap)
- Persist dismissal state if needed
