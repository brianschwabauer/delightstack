# Accordion

**Status**: Planned
**Category**: Display
**File**: `packages/components/src/display/Accordion.svelte`

## Description

A vertically stacked set of collapsible sections, allowing users to expand one or multiple panels to reveal content. Built on semantic `<details>`/`<summary>` elements enhanced with smooth animations via the Expand component. Ideal for FAQs, settings pages, and organizing large amounts of content into digestible sections.

## Dependencies

- **Components**: `Expand`
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Container
- Clean vertical stack
- Subtle dividers between items
- Optional outer border/card styling
- Consistent spacing throughout

### Item Header
- Full-width clickable `<summary>` element
- Clear title text
- Chevron icon indicating state
- Icon rotates on expand

### Item Content
- Smooth expand animation via the Expand component
- Comfortable padding
- No maximum height (content-driven)
- Subtle background differentiation (optional)

### States
- **Collapsed**: Chevron pointing right
- **Expanded**: Chevron rotated 90 degrees, content visible
- **Hover**: Subtle background highlight on summary
- **Disabled**: Reduced opacity, non-interactive

## Props

### Accordion Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `multiple` | `boolean` | `false` | Allow multiple panels open simultaneously |
| `value` | `string \| string[]` | - | Open item(s), bindable |
| `collapsible` | `boolean` | `true` | Allow closing all items |
| `disabled` | `boolean` | `false` | Disable all items |
| `dense` | `boolean` | `false` | Compact header/content padding |
| `comfortable` | `boolean` | `false` | Relaxed header/content padding |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `3` | Number of skeleton items to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | AccordionItem children |

### AccordionItem

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Unique identifier for this item |
| `title` | `string` | - | Header text shown in the `<summary>` |
| `disabled` | `boolean` | `false` | Disable this item |
| `trigger` | `Snippet` | - | Custom header content replacing title text |
| `children` | `Snippet` | - | Panel content |

## Behavior Modes

### Single Mode (Default)
- One section open at a time
- Opening a new section closes the current one
- Clean, focused navigation

### Multiple Mode
```svelte
<Accordion multiple bind:value={openSections}>
  ...
</Accordion>
```
- Multiple sections can be open simultaneously
- Independent toggle behavior
- `value` is an array of strings

### Always One Open
```svelte
<Accordion collapsible={false} value="first">
  ...
</Accordion>
```
- Cannot close all sections
- At least one section always visible

## Animation

The Accordion uses the Expand component internally for all expand/collapse animation. Each AccordionItem wraps its content in `<Expand show={isOpen}>`.

### Expand
1. Height animates from 0 to auto via Expand (CSS Grid `0fr` to `1fr`)
2. Content fades in slightly
3. Chevron rotates 90 degrees
4. Duration: 250ms ease-out

### Collapse
1. Content fades slightly
2. Height animates to 0 via Expand
3. Chevron rotates back
4. Duration: 200ms ease-in

## Semantic HTML

Each AccordionItem renders as a `<details>` element with a `<summary>` for the trigger area. The native open/close behavior is intercepted and managed by the Accordion container via context so that `multiple` and `collapsible` constraints are enforced. The native `<details>` open attribute is synced with the component state for progressive enhancement.

## Keyboard Navigation

- **Tab**: Moves focus between `<summary>` elements
- **Arrow Down / Arrow Up**: Moves focus to next/previous `<summary>`
- **Enter / Space**: Toggles the focused item
- **Home**: Moves focus to the first `<summary>`
- **End**: Moves focus to the last `<summary>`

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder items. Each placeholder shows a shimmering bar for the header and no content area. Maintains the same layout dimensions as real items.

## Accessibility

- Uses semantic `<details>`/`<summary>` elements for native accessibility
- `aria-expanded` on `<summary>` elements reflects state
- `aria-controls` links each `<summary>` to its content panel
- `role="region"` on each content panel
- Full keyboard navigation (arrows, Home, End, Enter, Space)
- Focus management across items

## CSS Approach

```css
.accordion-item {
  border-bottom: 1px solid light-dark(
    var(--color-border),
    var(--color-border)
  );
}

.accordion-item summary {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 1rem 1.25rem;
  list-style: none;
}

.accordion-item summary::-webkit-details-marker {
  display: none;
}

.accordion-item .chevron {
  transition: transform 250ms ease-out;
}

.accordion-item[open] .chevron {
  transform: rotate(90deg);
}
```

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

### Skeleton Loading
```svelte
<Accordion skeleton skeletonCount={4} />
```

### Nested Accordions
```svelte
<Accordion bind:value={outerSection}>
  <AccordionItem value="section-1" title="Parent Section">
    <Accordion bind:value={innerSection}>
      <AccordionItem value="child-1" title="Child Section">
        <p>Nested content</p>
      </AccordionItem>
    </Accordion>
  </AccordionItem>
</Accordion>
```

## Implementation Notes

- Uses Expand component internally for smooth height animation
- Renders `<details>`/`<summary>` for progressive enhancement and semantics
- Intercepts native `<details>` toggle events to enforce `multiple`/`collapsible` rules
- Maintains state via `setContext` for child AccordionItem communication
- Supports both controlled (`value` prop) and uncontrolled modes
