# ListItem

**Status**: Complete
**Category**: Display
**File**: `packages/components/src/display/ListItem.svelte`

## Description

A versatile list item component that adapts to its parent List context. Supports multiple interaction modes (button, radio, checkbox, text), async click handling with loading states, submenu support via Popover, and rich content layouts with start/end snippet slots. Shines within a List container.

## Dependencies

- **Components**: `Button` (for menu action), `Loading` (for async click states)
- **Utilities**: `@delightstack/utilities` -- `ripple` (attachment, for click feedback), `tooltip` (attachment)
- **Libraries**: `@floating-ui/dom` (via Popover, for submenu positioning)

## Visual Design

### Layout
- Flexible horizontal layout
- Leading content area via `{#snippet start()}` (icon, avatar, checkbox)
- Main content (text, description) as default children
- Trailing content area via `{#snippet end()}` (action, chevron)

### States
- **Default**: Subtle background
- **Hover**: Elevated background via `::before` pseudo-element opacity
- **Active/Selected**: Accent background tint
- **Disabled**: Reduced opacity, `cursor: not-allowed`
- **Loading**: Spinner displayed while async `onclick` resolves

### Selection Indicators
- **Radio**: Custom styled circle with filled dot
- **Checkbox**: Custom styled square with checkmark
- Smooth CSS transitions on state change

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `any` | - | Value for selection modes |
| `disabled` | `boolean` | `false` | Disable interaction |
| `active` | `boolean` | `false` | Force active/selected appearance |
| `href` | `string` | - | Render as anchor link |
| `target` | `string` | - | Link target attribute |
| `menu` | `Snippet` | - | Submenu content (renders a more-options button) |
| `badge` | `number \| boolean` | - | Notification badge on the item |
| `tooltip` | `string` | - | Tooltip text via `{@attach tooltip()}` |
| `popoverPlacement` | `Placement` | `'bottom-end'` | Submenu position |
| `popoverCloseOnInsideClick` | `boolean` | `false` | Close submenu on inside click |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `style` | `string` | - | Additional inline styles |
| `children` | `Snippet` | - | Main content |
| `start` | `Snippet` | - | Leading content slot |
| `end` | `Snippet` | - | Trailing content slot |
| `onclick` | `(e: MouseEvent) => void \| Promise<any>` | - | Click handler; returns a Promise to show loading state |
| `onchange` | `(value: boolean) => void` | - | Selection changed |

## Badge

When `badge` is provided:
- `badge={true}`: small dot indicator, positioned on the trailing edge
- `badge={3}`: circular badge with number
- Numbers above 99 display as "99+"

## Tooltip

When `tooltip` is provided, the `tooltip` attachment from `@delightstack/utilities` is applied to the `<li>` element: `{@attach tooltip(tooltipText)}`.

## Behavior by List Type

### Button Type (Default)
- Renders a `<button>` (or `<a>` if `href` is provided)
- Clickable with ripple effect
- Hover/active states
- Async click handling: if `onclick` returns a Promise, a loading spinner is shown until it resolves

### Radio Type
- Renders a `<label>` with a hidden `<input type="radio">`
- Custom styled radio indicator
- Single selection per list (name linked to list context ID)

### Checkbox Type
- Renders a `<label>` with a hidden `<input type="checkbox">`
- Custom styled checkbox indicator
- Multiple selection supported

### Text Type
- Renders plain content, no interactive wrapper
- No hover effects
- Display-only

## Async Click Handling

```svelte
<ListItem onclick={async () => {
  await api.saveItem();
}}>
  Save Item
</ListItem>
```

When `onclick` returns a Promise:
1. A loading spinner appears
2. Interaction is disabled during the async operation
3. On success, the spinner briefly shows a success state
4. Returns to normal state after completion

## Submenu Support

```svelte
<ListItem>
  More Options
  {#snippet menu()}
    <List>
      <ListItem>Option A</ListItem>
      <ListItem>Option B</ListItem>
    </List>
  {/snippet}
</ListItem>
```

When `menu` is provided, a more-options button (three dots icon) appears at the trailing edge. Clicking it opens a Popover-positioned dropdown with the menu content.

## Content Structure

```svelte
<ListItem>
  {#snippet start()}
    <Avatar src={user.avatar} name={user.name} size="1" />
  {/snippet}

  <span class="title">{user.name}</span>
  <span class="subtitle">{user.email}</span>

  {#snippet end()}
    <ChevronIcon />
  {/snippet}
</ListItem>
```

## Accessibility

- Proper roles based on list type (button, radio, checkbox)
- `aria-selected` / `aria-checked` for selection states
- Keyboard navigation (handled by parent List)
- Focus indicators via `focus-visible`
- Disabled state communicated to assistive technology

## CSS Approach

```css
li.list-item {
  min-height: 3.5rem;
  padding: 0;
  margin: 0;
  position: relative;
  overflow: hidden;
  list-style: none;
  display: flex;
  align-items: center;
}

li.list-item::after {
  content: '';
  position: absolute;
  top: 0;
  right: 1rem;
  left: 1rem;
  border-top: solid 1px color-mix(in oklch, transparent, var(--color-text) 6%);
}

li.list-item:first-child::after {
  content: none;
}

li.list-item a,
li.list-item button,
li.list-item label {
  flex: 1;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--color-text);
  background-color: transparent;
  text-decoration: none;
}
```

## Code Example

```svelte
<script>
  import { List, ListItem } from '@delightstack/components';
  import UserIcon from '~icons/mdi/account';
  import SettingsIcon from '~icons/mdi/cog';
  import LogoutIcon from '~icons/mdi/logout';
</script>

<!-- Menu with icons -->
<List>
  <ListItem href="/profile" tooltip="View your profile">
    {#snippet start()}<UserIcon />{/snippet}
    Profile
  </ListItem>
  <ListItem href="/settings">
    {#snippet start()}<SettingsIcon />{/snippet}
    Settings
  </ListItem>
  <ListItem onclick={handleLogout}>
    {#snippet start()}<LogoutIcon />{/snippet}
    Log Out
  </ListItem>
</List>

<!-- With badge -->
<List>
  <ListItem badge={5}>
    {#snippet start()}<InboxIcon />{/snippet}
    Inbox
  </ListItem>
  <ListItem badge={true}>
    {#snippet start()}<NotificationIcon />{/snippet}
    Notifications
  </ListItem>
</List>

<!-- Settings with checkboxes -->
<List type="checkbox" bind:value={settings}>
  <ListItem>
    Enable Notifications
    {#snippet end()}
      <span class="hint">Recommended</span>
    {/snippet}
  </ListItem>
  <ListItem>Dark Mode</ListItem>
  <ListItem>Sound Effects</ListItem>
</List>
```

## Implementation Notes

- The current implementation is complete
- Adapts rendering based on parent List context (`getContext('list')`)
- Ripple attachment for tactile click feedback
- Custom checkbox/radio styling (not native inputs visually)
- Async onclick automatically manages loading/success states
- Submenu via Button + Popover integration
- Level-based indentation for nested lists via CSS custom property `--level`
