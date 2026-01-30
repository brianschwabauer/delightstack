# Accordion

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Accordian.svelte`

## Description

A vertically stacked set of collapsible sections, allowing users to expand one or multiple panels to reveal content. Perfect for FAQs, settings pages, and organizing large amounts of content into digestible sections.

## Visual Design

### Container
- Clean vertical stack
- Subtle dividers between items
- Optional outer border/card styling
- Consistent spacing throughout

### Item Header
- Full-width clickable area
- Clear title text
- Chevron/plus icon indicating state
- Icon rotates on expand

### Item Content
- Smooth expand animation
- Comfortable padding
- No maximum height (content-driven)
- Subtle background differentiation (optional)

### States
- **Collapsed**: Chevron pointing right/down
- **Expanded**: Chevron rotated, content visible
- **Hover**: Subtle background highlight
- **Disabled**: Reduced opacity, non-interactive

## Props

### Accordion Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `multiple` | `boolean` | `false` | Allow multiple open |
| `value` | `string \| string[]` | - | Open item(s) (bindable) |
| `collapsible` | `boolean` | `true` | Allow closing all items |
| `disabled` | `boolean` | `false` | Disable all items |
| `dense` | `boolean` | `false` | Compact header/content padding |
| `comfortable` | `boolean` | `false` | Relaxed header/content padding |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `3` | Number of skeleton items |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

### Accordion Item

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Unique identifier |
| `title` | `string` | - | Header text |
| `disabled` | `boolean` | `false` | Disable this item |

## Behavior Modes

### Single Mode (Default)
- One section open at a time
- Opening new section closes current
- Clean, focused navigation

### Multiple Mode
```svelte
<Accordion multiple bind:value={openSections}>
  ...
</Accordion>
```
- Multiple sections can be open
- Independent toggle behavior
- `value` is an array

### Always One Open
```svelte
<Accordion collapsible={false} value="first">
  ...
</Accordion>
```
- Cannot close all sections
- At least one always visible

## Animation

### Expand
1. Height animates from 0 to auto (using Expand component)
2. Content fades in slightly
3. Chevron rotates 90° or 180°
4. Duration: 250ms ease-out

### Collapse
1. Content fades slightly
2. Height animates to 0
3. Chevron rotates back
4. Duration: 200ms ease-in

## Delightful Details

### Smooth Transitions
- Uses CSS Grid animation trick
- No content measurement needed
- Silky smooth expand/collapse

### Icon Animation
- Chevron rotates with easing
- Or: Plus morphs to minus
- Subtle spring effect

### Focus Flow
- Tab moves between headers
- Arrow keys navigate between items
- Enter/Space toggles current

### Nested Accordions
- Support for accordion within accordion
- Proper indentation
- Independent state management

## Accessibility

- `role="region"` for each panel
- `aria-expanded` on triggers
- `aria-controls` linking header to content
- Keyboard navigation (arrows, home, end)
- Focus management

## Code Example

```svelte
<script>
  import { Accordion, AccordionItem } from '@delightstack/components';

  let openSection = $state('faq-1');
</script>

<Accordion bind:value={openSection}>
  <AccordionItem value="faq-1" title="How do I get started?">
    <p>Getting started is easy! Simply create an account and follow
    the onboarding steps.</p>
  </AccordionItem>

  <AccordionItem value="faq-2" title="What payment methods do you accept?">
    <p>We accept all major credit cards, PayPal, and bank transfers.</p>
  </AccordionItem>

  <AccordionItem value="faq-3" title="How can I contact support?">
    <p>You can reach our support team via email at support@example.com
    or through the in-app chat.</p>
  </AccordionItem>
</Accordion>
```

### With Custom Headers
```svelte
<AccordionItem value="settings">
  {#snippet trigger()}
    <div class="custom-header">
      <SettingsIcon />
      <span>Advanced Settings</span>
      <Badge>Pro</Badge>
    </div>
  {/snippet}

  <SettingsForm />
</AccordionItem>
```

## Implementation Notes

- Uses Expand component internally for animation
- Maintain state via context for nested items
- Support both controlled and uncontrolled modes
