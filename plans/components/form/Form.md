# Form

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/Form.svelte`

## Description

A form container that provides validation, submission handling, and state management for child form fields. Coordinates form-level validation, tracks dirty state, and handles async submission.

## Visual Design

This is primarily a functional wrapper. Visual output is minimal:
- Wraps children in `<form>` element
- Loading overlay during submission (optional)
- Form-level error display

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `object` | - | Form data object (bindable) |
| `schema` | `ValidationSchema` | - | Validation schema |
| `validateOn` | `'change' \| 'blur' \| 'submit'` | `'blur'` | When to validate |
| `loading` | `boolean` | `false` | Loading state (bindable) |
| `disabled` | `boolean` | `false` | Disable all fields |
| `resetOnSubmit` | `boolean` | `false` | Reset after success |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onsubmit` | `{ data, isValid }` | Form submitted |
| `onchange` | `{ data, errors }` | Data changed |
| `onerror` | `{ errors }` | Validation failed |
| `onreset` | - | Form reset |

## Features

### Validation
```svelte
<Form
  bind:data={formData}
  schema={{
    email: { required: true, email: true },
    password: { required: true, minLength: 8 }
  }}
  onsubmit={handleSubmit}
>
  <Input name="email" label="Email" />
  <Input name="password" label="Password" type="password" />
  <Button type="submit">Sign In</Button>
</Form>
```

### Built-in Validators
- `required`: Field must have value
- `email`: Valid email format
- `minLength` / `maxLength`: String length
- `min` / `max`: Number range
- `pattern`: Regex match
- `custom`: Custom function

### Async Validation
```svelte
schema={{
  username: {
    required: true,
    custom: async (value) => {
      const available = await checkUsername(value);
      return available || 'Username taken';
    }
  }
}}
```

### Form State

The Form provides state to children via context:
```typescript
interface FormContext {
  data: object;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isValid: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
}
```

### Auto-Submission
```svelte
<Form
  onsubmit={async ({ data }) => {
    await api.save(data);
  }}
>
```
- Auto-manages loading state
- Prevents double submission
- Handles errors

## Delightful Details

### Validation Timing
- Configurable validation trigger
- Error shown only after field touched
- Clear errors on successful validation

### Submit Protection
- Disables button during submission
- Shows loading indicator
- Prevents accidental double-submit

### Error Focus
- On submit validation failure
- Auto-focuses first field with error
- Smooth scroll to error

### Dirty Tracking
- Tracks if form has changes
- Warn before leaving (optional)
- Reset to clean state

### Field Registration
- Fields auto-register with form
- Errors passed down via context
- Centralized state management

## Accessibility

- Proper form semantics
- Error summary available
- Focus management on errors
- ARIA live regions for validation

## Code Example

```svelte
<script>
  import { Form, Input, Button, Fieldset } from '@delightstack/components';

  let formData = $state({
    name: '',
    email: '',
    password: ''
  });

  async function handleSubmit({ data }) {
    await api.createAccount(data);
    goto('/dashboard');
  }
</script>

<Form
  bind:data={formData}
  schema={{
    name: { required: true },
    email: { required: true, email: true },
    password: { required: true, minLength: 8 }
  }}
  onsubmit={handleSubmit}
>
  <Fieldset legend="Create Account">
    <Input name="name" label="Name" />
    <Input name="email" label="Email" type="email" />
    <Input name="password" label="Password" type="password" />
  </Fieldset>

  <div class="actions">
    <Button type="reset" variant="ghost">Reset</Button>
    <Button type="submit">Create Account</Button>
  </div>
</Form>
```

## Implementation Notes

- Use Svelte context for state sharing
- Support both controlled and uncontrolled
- Handle nested field names (dot notation)
- Integrate with native form validation API
- Consider form libraries for complex schemas
