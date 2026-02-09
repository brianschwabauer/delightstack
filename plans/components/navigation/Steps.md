# Steps

**Category**: Navigation
**File**: `packages/components/src/navigation/Steps.svelte`

## Description

A multi-step progress indicator for wizards, onboarding flows, and sequential processes. Shows visual state for each step (complete, current, upcoming, error), supports both horizontal and vertical orientations, can contain content panels or serve as an indicator-only display, and provides clickable navigation back to completed steps. Integrates with Form for wizard validation flows.

## Dependencies

- **Components**: `Form` -- used as a wrapper for individual step content panels in wizard flows to enable per-step validation
- **Utilities**: `@delightstack/utilities` -- none directly
- **Libraries**: none

## Visual Design

### Horizontal Layout
- Steps arranged in a row with connector lines between them
- Each step is a numbered circle (or icon) with a label below
- Connector lines fill with color as steps are completed
- Labels can include an optional description underneath

### Vertical Layout
- Steps stacked vertically
- Connector line runs along the left side
- Labels and optional descriptions to the right of each circle
- Content panels can appear inline below each step's label

### Step States

| State | Circle | Connector Before | Icon/Number | Label Color |
|-------|--------|-----------------|-------------|-------------|
| **Complete** | Filled with `--color-success` | Filled `--color-success` | Checkmark icon | `--color-text-primary` |
| **Current** | Filled with `--color-action` | Filled `--color-success` | Current step number | `--color-text-primary`, bold |
| **Upcoming** | Border only, `--color-border` | Unfilled `--color-border` | Step number, muted | `--color-text-tertiary` |
| **Error** | Filled with `--color-error` | Filled `--color-success` | Error/exclamation icon | `--color-error` |

## Props

### Steps Container

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `current` | `number` | `0` | Current step index (`$bindable()`) |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction |
| `clickable` | `boolean` | `false` | Allow clicking completed steps to navigate back |
| `linear` | `boolean` | `true` | Steps must be completed in order |
| `size` | `'0' \| '1' \| '2' \| '3'` | `'1'` | Step circle and text size |
| `skeleton` | `boolean` | `false` | Show loading skeleton |
| `skeletonCount` | `number` | `4` | Number of skeleton steps to render |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |
| `children` | `Snippet` | - | Step children |
| `onchange` | `(detail: { step: number }) => void` | - | Fires when the current step changes |
| `oncomplete` | `() => void` | - | Fires when all steps are completed |

### Step Item

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Step title text |
| `description` | `string` | - | Secondary description text |
| `icon` | `Component` | - | Custom icon replacing the step number |
| `optional` | `boolean` | `false` | Mark as optional (shows "Optional" label) |
| `error` | `boolean` | `false` | Show error state on this step |
| `children` | `Snippet` | - | Content panel for this step (wizard mode) |

## Content Panels (Wizard Mode)

Each Step can contain a `children` snippet for its content panel. When content is provided, the Steps component operates in wizard mode:

```svelte
<Steps bind:current={step}>
  <Step title="Account" description="Create your account">
    <AccountForm />
  </Step>
  <Step title="Profile" description="Set up your profile">
    <ProfileForm />
  </Step>
  <Step title="Review" description="Confirm details">
    <ReviewPanel />
  </Step>
</Steps>
```

- Only the current step's content panel is visible.
- Content panels transition with a horizontal slide animation (or vertical slide for vertical orientation).
- When no children are provided on any Step, the component operates in indicator-only mode, and the parent is responsible for rendering content based on the `current` value.

## Clickable Navigation

When `clickable` is true:
- Completed steps (index < `current`) are clickable. Clicking navigates back to that step.
- The current step is visually active but not clickable (already there).
- Upcoming steps (index > `current`) are not clickable when `linear` is true.
- When `linear` is false, all steps are clickable regardless of completion state.

Click targets include both the circle indicator and the label text.

## Form Integration

Steps integrates with the Form component for wizard flows where each step requires validation before proceeding:

```svelte
<Steps bind:current={step}>
  <Step title="Account">
    <Form data={accountData} schema={accountSchema} onsubmit={nextStep}>
      <Input name="email" label="Email" />
      <Input name="password" label="Password" type="password" />
      <Button type="submit">Continue</Button>
    </Form>
  </Step>
  <Step title="Profile">
    <Form data={profileData} schema={profileSchema} onsubmit={nextStep}>
      <Input name="name" label="Full Name" />
      <Button type="submit">Continue</Button>
    </Form>
  </Step>
</Steps>
```

Each step's Form validates independently. The `onsubmit` handler advances to the next step only if validation passes. If validation fails, the step can be set to `error` state.

## Context API

Steps uses `setContext` to provide state to child Step components:

```typescript
interface StepsContext {
  current: number;
  orientation: 'horizontal' | 'vertical';
  clickable: boolean;
  linear: boolean;
  size: string;
  register: (index: number) => void;
  navigate: (index: number) => void;
}
```

## Delightful Details

### Progress Animation
- Checkmark icon draws in with a stroke animation on step completion
- Connector line fills with a smooth transition (width or height depending on orientation)
- Step circle scales up briefly on transition

### Current Step Pulse
- Subtle pulsing ring animation on the current step's circle
- Draws attention to the active step
- Uses `box-shadow` animation for the pulse effect

### Connector Line Animation
- The connector between steps fills progressively with `--color-success`
- Animated via CSS `background-size` or `scaleX`/`scaleY` transition
- Creates a smooth "progress filling" effect

### Error State Animation
- Brief shake animation on the step circle when entering error state
- Red color transition on the circle and label
- Error icon (exclamation mark) replaces the step number

## Accessibility

- `role="group"` with `aria-label="Progress"` on the container
- Each step has `aria-current="step"` when active
- Step state communicated via `aria-label` (e.g., "Step 1: Account, completed")
- Completed clickable steps are `<button>` elements
- Upcoming non-clickable steps are `<span>` elements
- Full keyboard navigation: Tab between clickable steps, Enter/Space to activate

## Skeleton State

When `skeleton` is true, render `skeletonCount` placeholder step indicators with shimmering circles and text bars. Connector lines between steps are shown in the muted/default state.

## CSS Approach

```css
.steps {
  display: flex;
  align-items: flex-start;
}

.steps.vertical {
  flex-direction: column;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
}

.steps.vertical .step {
  flex-direction: row;
  align-items: flex-start;
  flex: none;
}

.step-circle {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-medium);
  border: 2px solid light-dark(var(--color-border), var(--color-border));
  background: transparent;
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
  transition:
    background var(--duration-normal) var(--ease-default),
    border-color var(--duration-normal) var(--ease-default),
    color var(--duration-normal) var(--ease-default);
}

.step.complete .step-circle {
  background: var(--color-success);
  border-color: var(--color-success);
  color: white;
}

.step.current .step-circle {
  background: var(--color-action);
  border-color: var(--color-action);
  color: white;
}

.step.error .step-circle {
  background: var(--color-error);
  border-color: var(--color-error);
  color: white;
}

.step-connector {
  flex: 1;
  height: 2px;
  background: light-dark(var(--color-border), var(--color-border));
  position: relative;
  align-self: center;
  margin: 0 0.5rem;
}

.step-connector-fill {
  position: absolute;
  inset: 0;
  background: var(--color-success);
  transform-origin: left;
  transform: scaleX(0);
  transition: transform var(--duration-normal) var(--ease-default);
}

.step.complete + .step .step-connector .step-connector-fill {
  transform: scaleX(1);
}

.step-title {
  font-weight: var(--font-weight-medium);
  color: light-dark(var(--color-text-primary), var(--color-text-primary));
  margin-top: 0.5rem;
  text-align: center;
}

.step.upcoming .step-title {
  color: light-dark(var(--color-text-tertiary), var(--color-text-tertiary));
}

.step-description {
  font-size: var(--text-sm);
  color: light-dark(var(--color-text-secondary), var(--color-text-secondary));
  text-align: center;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-action) 40%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in oklch, var(--color-action) 0%, transparent); }
}

.step.current .step-circle {
  animation: pulse 2s ease-in-out infinite;
}
```

## Code Example

```svelte
<script>
  import { Steps, Step, Button } from '@delightstack/components';

  let currentStep = $state(0);

  function nextStep() {
    if (currentStep < 3) currentStep++;
  }

  function prevStep() {
    if (currentStep > 0) currentStep--;
  }
</script>

<!-- Indicator-only mode -->
<Steps bind:current={currentStep} clickable>
  <Step title="Account" description="Create your account" />
  <Step title="Profile" description="Set up your profile" />
  <Step title="Preferences" description="Choose settings" optional />
  <Step title="Complete" description="Review and finish" />
</Steps>

<div class="step-content">
  {#if currentStep === 0}
    <AccountForm />
  {:else if currentStep === 1}
    <ProfileForm />
  {:else if currentStep === 2}
    <PreferencesForm />
  {:else}
    <ReviewPanel />
  {/if}
</div>

<div class="step-actions">
  <Button transparent onclick={prevStep} disabled={currentStep === 0}>
    Back
  </Button>
  <Button onclick={nextStep}>
    {currentStep === 3 ? 'Complete' : 'Continue'}
  </Button>
</div>

<!-- Wizard mode with inline content -->
<Steps bind:current={step}>
  <Step title="Account">
    <AccountForm onsubmit={() => step++} />
  </Step>
  <Step title="Profile">
    <ProfileForm onsubmit={() => step++} />
  </Step>
  <Step title="Done">
    <ReviewPanel />
  </Step>
</Steps>

<!-- Vertical layout -->
<Steps bind:current={step} orientation="vertical">
  <Step title="Order Placed" description="Your order has been confirmed" />
  <Step title="Processing" description="We are preparing your items" />
  <Step title="Shipped" description="On its way to you" />
  <Step title="Delivered" description="Package received" />
</Steps>

<!-- With error state -->
<Steps bind:current={step}>
  <Step title="Details" />
  <Step title="Payment" error />
  <Step title="Confirmation" />
</Steps>

<!-- With custom icons -->
<Steps bind:current={step}>
  <Step title="Cart" icon={CartIcon} />
  <Step title="Payment" icon={CreditCardIcon} />
  <Step title="Shipping" icon={TruckIcon} />
  <Step title="Complete" icon={CheckCircleIcon} />
</Steps>

<!-- Skeleton loading -->
<Steps skeleton skeletonCount={4} />
```
