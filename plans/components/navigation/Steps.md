# Steps

**Status**: 🔲 Placeholder
**Category**: Navigation
**File**: `packages/components/src/navigation/Steps.svelte`

## Description

A multi-step progress indicator for wizards, onboarding flows, and sequential processes. Shows the user's progress and allows navigation between completed steps.

## Visual Design

### Horizontal Layout
- Steps in a row
- Connector lines between
- Icons or numbers in circles
- Labels below

### Vertical Layout
- Steps stacked vertically
- Connector line on left
- Labels to the right

### Step States
- **Complete**: Checkmark, filled
- **Current**: Highlighted, accent color
- **Upcoming**: Empty, muted

## Props

### Steps Container
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `current` | `number` | `0` | Current step index (bindable) |
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction |
| `clickable` | `boolean` | `false` | Allow clicking completed steps |
| `linear` | `boolean` | `true` | Must complete in order |

### Step Item
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Step title |
| `description` | `string` | - | Step description |
| `icon` | `Component` | - | Custom icon |
| `optional` | `boolean` | `false` | Mark as optional |
| `error` | `boolean` | `false` | Show error state |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onchange` | `{ step }` | Step changed |
| `oncomplete` | - | All steps completed |

## Structure

```svelte
<Steps bind:current>
  <Step title="Account" description="Create your account" />
  <Step title="Profile" description="Set up your profile" />
  <Step title="Preferences" description="Choose your settings" optional />
  <Step title="Complete" description="Review and finish" />
</Steps>
```

## Features

### Clickable Navigation
```svelte
<Steps clickable bind:current>
```
- Click completed steps to return
- Current and future non-clickable (linear)
- All clickable (non-linear)

### Error State
```svelte
<Step title="Payment" error />
```
- Red indicator
- Error icon
- Indicates validation failure

### Optional Steps
```svelte
<Step title="Survey" optional />
```
- "Optional" label shown
- Can be skipped

### Custom Icons
```svelte
<Step title="Cart" icon={CartIcon} />
<Step title="Payment" icon={CreditCardIcon} />
<Step title="Shipping" icon={TruckIcon} />
```

## Delightful Details

### Progress Animation
- Checkmark draws in on complete
- Line fills between steps
- Smooth transitions

### Current Step Pulse
- Subtle pulse on current
- Draws attention
- Indicates active

### Connector Animation
- Line fills as progress
- Color transitions smoothly

### Responsive
- Horizontal on desktop
- Vertical on mobile
- Or: compact dots only

## Accessibility

- Proper ARIA stepper roles
- Step state announced
- Keyboard navigation
- Focus management

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

<Steps bind:current={currentStep}>
  <Step title="Account" description="Create your account" />
  <Step title="Profile" description="Set up your profile" />
  <Step title="Settings" description="Configure preferences" optional />
  <Step title="Done" description="Review and finish" />
</Steps>

<div class="step-content">
  {#if currentStep === 0}
    <AccountForm />
  {:else if currentStep === 1}
    <ProfileForm />
  {:else if currentStep === 2}
    <SettingsForm />
  {:else}
    <ReviewStep />
  {/if}
</div>

<div class="step-actions">
  <Button onclick={prevStep} disabled={currentStep === 0}>
    Back
  </Button>
  <Button onclick={nextStep}>
    {currentStep === 3 ? 'Complete' : 'Continue'}
  </Button>
</div>
```

## Implementation Notes

- Use CSS for connector lines
- Calculate completion percentage
- Handle dynamic step count
- Support both controlled and uncontrolled
- Consider form validation integration
