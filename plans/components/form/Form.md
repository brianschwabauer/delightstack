# Form

**Category**: Form
**File**: `packages/components/src/form/Form.svelte`

## Dependencies

- [Standard Schema](https://github.com/standard-schema/standard-schema) compatible validators (Zod, Valibot, ArkType, etc.)

## Description

A form container that provides validation, submission handling, and state management for child form controls. Accepts any Standard Schema compatible validator for schema validation. Provides form context via `setContext`/`getContext` including data, errors, touched fields, dirty tracking, and submission state. Child form controls auto-register via context using their `name` prop. Features auto-focus on first error field on validation failure and a promise-aware `onsubmit` handler with automatic loading state.

## Visual Design

This is primarily a functional wrapper. Visual output is minimal:
- Wraps children in a native `<form>` element
- Form-level error display above or below content
- No visible styling by default (transparent wrapper)

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `object` | - | Form data object (`$bindable()`) |
| `schema` | `StandardSchema` | - | Any Standard Schema compatible validator (Zod, Valibot, ArkType, etc.) |
| `validateOn` | `'change' \| 'blur' \| 'submit'` | `'blur'` | When to validate fields |
| `disabled` | `boolean` | `false` | Disable all child fields |
| `resetOnSubmit` | `boolean` | `false` | Reset form after successful submission |
| `dense` | `boolean` | `false` | Compact spacing between child fields |
| `comfortable` | `boolean` | `false` | Relaxed spacing between child fields |
| `id` | `string` | - | Element ID |
| `class` | `string` | - | Additional CSS classes |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onsubmit` | `{ data, isValid }` | Form submitted. Can return a Promise for automatic loading state |
| `onchange` | `{ data, errors }` | Form data changed |
| `onerror` | `{ errors }` | Validation failed on submit |
| `onreset` | - | Form reset |

## Form Context

Form provides state to child controls via `setContext`:

```typescript
interface FormContext {
  data: object;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isDirty: boolean;
  isSubmitting: boolean;
  isValid: boolean;
  register: (name: string, element: HTMLElement) => void;
  unregister: (name: string) => void;
  setValue: (name: string, value: any) => void;
  setTouched: (name: string) => void;
  validateField: (name: string) => void;
}
```

### Child Auto-Registration

Child form controls (Input, Select, Checkbox, etc.) call `getContext` on mount. If a Form context exists and the child has a `name` prop, the child:
1. Calls `register(name, element)` to register with the form
2. Reads `errors[name]` to display field-level errors
3. Reads `touched[name]` to know when to show errors
4. Calls `setValue(name, value)` when value changes
5. Calls `setTouched(name)` on blur
6. Calls `unregister(name)` on destroy

This means child controls work the same whether inside a Form or standalone. The Form context is optional.

## Standard Schema Integration

The `schema` prop accepts any validator conforming to the [Standard Schema](https://github.com/standard-schema/standard-schema) spec. This includes Zod, Valibot, ArkType, and others.

### With Zod
```svelte
<script>
  import { z } from 'zod';

  const schema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'At least 8 characters'),
  });
</script>

<Form bind:data={formData} {schema} onsubmit={handleSubmit}>
  <Input name="email" label="Email" type="email" />
  <Input name="password" label="Password" type="password" />
  <Button type="submit">Sign In</Button>
</Form>
```

### With Valibot
```svelte
<script>
  import * as v from 'valibot';

  const schema = v.object({
    name: v.pipe(v.string(), v.minLength(2, 'At least 2 characters')),
    age: v.pipe(v.number(), v.minValue(18, 'Must be 18+')),
  });
</script>

<Form bind:data={formData} {schema} onsubmit={handleSubmit}>
  <Input name="name" label="Name" />
  <Input name="age" label="Age" type="number" />
  <Button type="submit">Submit</Button>
</Form>
```

### With ArkType
```svelte
<script>
  import { type } from 'arktype';

  const schema = type({
    email: 'string.email',
    password: 'string >= 8',
  });
</script>

<Form bind:data={formData} {schema} onsubmit={handleSubmit}>
  <Input name="email" label="Email" />
  <Input name="password" label="Password" type="password" />
  <Button type="submit">Submit</Button>
</Form>
```

The Form calls `schema['~standard'].validate(data)` to validate. Errors are mapped by field path to the `errors` record in context.

## Features

### Promise-Aware Submission
```svelte
<Form
  bind:data={formData}
  {schema}
  onsubmit={async ({ data }) => {
    await api.createAccount(data);
    goto('/dashboard');
  }}
>
```
- If `onsubmit` returns a Promise, Form automatically sets `isSubmitting` to `true`
- All fields and submit button are disabled during submission
- `isSubmitting` resets to `false` when the Promise resolves or rejects
- Prevents double submission

### Auto-Focus on First Error
- On submit validation failure, Form finds the first field with an error
- Uses the registered element reference to call `.focus()`
- Smooth scroll to the error field if it's off-screen
- Error message appears on the focused field

### Validation Timing
- `validateOn: 'submit'`: Only validate on form submission
- `validateOn: 'blur'`: Validate each field when it loses focus (after first touch)
- `validateOn: 'change'`: Validate each field on every value change (after first touch)
- Errors shown only after the field has been touched (prevents showing errors on pristine fields)
- Clear individual errors when the field value becomes valid

### Dirty Tracking
- `isDirty` is `true` when any field value differs from the initial `data`
- Useful for enabling/disabling submit button or warning before navigation
- Resets when `data` is reset

### Form Reset
```svelte
<Form bind:data={formData} {schema} onsubmit={handleSubmit}>
  ...
  <Button type="reset">Reset</Button>
</Form>
```
- Native `<button type="reset">` triggers form reset
- All fields return to initial values
- All errors and touched states cleared
- `isDirty` resets to `false`
- `onreset` event fires

### Field-Level Error Display
- Errors from schema validation are mapped to fields by `name`
- Each field reads its own error from context
- Fields display errors via their own `error` prop (auto-set from context)
- Manual `error` prop on a child field takes precedence over context errors

## Styling

Minimal styling since Form is a functional wrapper:
- Uses `<form>` element with optional `class`
- Children spacing controlled by `dense` / `comfortable` via CSS `gap`
- Form-level error uses `--color-error` for text
- Disabled state: opacity 0.6 on form, `pointer-events: none`

## Delightful Details

### Validation Timing
- Errors appear only after field is touched (no immediate red on load)
- Errors clear immediately when the value becomes valid
- Smooth fade-in for error messages

### Submit Protection
- Automatic loading state during async `onsubmit`
- Submit button disabled via context `isSubmitting`
- Prevents accidental double-submit
- If `onsubmit` throws, form catches the error and returns to normal state

### Error Focus
- On submit validation failure, first error field auto-focused
- `scrollIntoView({ behavior: 'smooth', block: 'center' })` if off-screen
- Error message immediately visible

### Dirty Tracking
- Compares current `data` against initial snapshot
- Deep comparison for nested objects
- `isDirty` updates reactively

### Reset Animation
- Fields smoothly transition back to empty/default state
- Error messages fade out

## Accessibility

- Semantic `<form>` element
- `aria-live="polite"` region for form-level errors
- Field errors linked via `aria-describedby` (handled by child controls)
- Focus management on validation failure
- `aria-disabled` when form is disabled
- Screen reader announces submission state changes

## Code Example

```svelte
<script>
  import { Form, Input, Select, Checkbox, Button, Fieldset } from '@delightstack/components';
  import { z } from 'zod';

  let formData = $state({
    name: '',
    email: '',
    password: '',
    role: '',
    terms: false,
  });

  const schema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.string().min(1, 'Please select a role'),
    terms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
  });

  async function handleSubmit({ data }) {
    await api.createAccount(data);
    goto('/dashboard');
  }
</script>

<Form
  bind:data={formData}
  {schema}
  onsubmit={handleSubmit}
  validateOn="blur"
>
  <Fieldset legend="Create Account" card>
    <Input name="name" label="Name" />
    <Input name="email" label="Email" type="email" />
    <Input name="password" label="Password" type="password" />
    <Select
      name="role"
      label="Role"
      options={[
        { value: 'user', label: 'User' },
        { value: 'admin', label: 'Admin' },
      ]}
    />
    <Checkbox name="terms" label="I accept the terms and conditions" />
  </Fieldset>

  <div class="actions">
    <Button type="reset" ghost>Reset</Button>
    <Button type="submit">Create Account</Button>
  </div>
</Form>
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `data`
- Uses `$state()` for internal reactive state (errors, touched, isSubmitting, isDirty)
- `setContext()` provides `FormContext` to child components
- Child controls call `getContext()` and register via `name` prop
- Standard Schema validation via `schema['~standard'].validate(data)`
- Error mapping: Standard Schema errors include `path` array, mapped to dot-notation field names
- Initial data snapshot stored for dirty tracking and reset
- Native `<form>` element with `onsubmit` handler calling `event.preventDefault()`
- `{@render children()}` for default slot content
- CSS custom properties for theming, plain CSS
