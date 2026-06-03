<script lang="ts" module>
	/**
	 * Standard Schema interface (v1) — inlined to avoid a hard dependency
	 * on `@standard-schema/spec`. Any Zod, Valibot, or ArkType schema
	 * satisfies this interface.
	 */
	export interface StandardSchema<Input = unknown, Output = Input> {
		readonly '~standard': {
			readonly version: 1;
			readonly vendor: string;
			readonly validate: (
				value: unknown,
			) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
			readonly types?: { readonly input: Input; readonly output: Output } | undefined;
		};
	}

	type StandardSchemaResult<Output> =
		| { readonly value: Output; readonly issues?: undefined }
		| { readonly issues: ReadonlyArray<StandardSchemaIssue> };

	interface StandardSchemaIssue {
		readonly message: string;
		readonly path?:
			| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
			| undefined;
	}

	export interface FormContext {
		data: Record<string, unknown>;
		errors: Record<string, string>;
		touched: Record<string, boolean>;
		is_dirty: boolean;
		is_submitting: boolean;
		is_valid: boolean;
		disabled: boolean;
		validate_on: 'change' | 'blur' | 'submit';
		register: (name: string, element: HTMLElement) => void;
		unregister: (name: string) => void;
		setValue: (name: string, value: unknown) => void;
		setTouched: (name: string) => void;
		validateField: (name: string) => void;
	}
</script>

<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	const propId = $props.id();

	let {
		/** The form data object (bindable) */
		data = $bindable({}) as Record<string, unknown>,

		/** Any Standard Schema compatible validator (Zod, Valibot, ArkType, etc.) */
		schema = undefined as StandardSchema | undefined,

		/** When to validate fields: 'change', 'blur', or 'submit' */
		validate_on = 'blur' as 'change' | 'blur' | 'submit',

		/** Whether the entire form is disabled */
		disabled = false,

		/** Reset form to initial values after successful submission */
		reset_on_submit = false,

		/** Use compact spacing between child fields */
		dense = false,

		/** Use relaxed spacing between child fields */
		comfortable = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Child content */
		children = undefined as Snippet | undefined,

		/** Called on form submission. May return a Promise for automatic loading state */
		onsubmit = undefined as
			| ((detail: {
					data: Record<string, unknown>;
					is_valid: boolean;
			  }) => void | Promise<void>)
			| undefined,

		/** Called when form data changes */
		onchange = undefined as
			| ((detail: {
					data: Record<string, unknown>;
					errors: Record<string, string>;
			  }) => void)
			| undefined,

		/** Called when validation fails on submit */
		onerror = undefined as
			| ((detail: { errors: Record<string, string> }) => void)
			| undefined,

		/** Called when the form is reset */
		onreset = undefined as (() => void) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Internal state                                                     */
	/* ------------------------------------------------------------------ */

	/** Snapshot of the initial data for dirty tracking and reset */
	let initial_snapshot = JSON.stringify(data);

	/** Registry of field elements by name */
	let field_elements = new Map<string, HTMLElement>();

	/** Validation errors keyed by field name */
	let errors = $state<Record<string, string>>({});

	/** Touched state keyed by field name */
	let touched = $state<Record<string, boolean>>({});

	/** Whether the form is currently submitting */
	let is_submitting = $state(false);

	/** Whether the form data has changed from the initial snapshot */
	let is_dirty = $derived(JSON.stringify(data) !== initial_snapshot);

	/** Whether the form currently has no validation errors */
	let is_valid = $derived(Object.keys(errors).length === 0);

	/** Whether the form should be effectively disabled (explicit or submitting) */
	let effectively_disabled = $derived(disabled || is_submitting);

	/* ------------------------------------------------------------------ */
	/*  Standard Schema validation                                         */
	/* ------------------------------------------------------------------ */

	async function validate(
		values: Record<string, unknown>,
	): Promise<Record<string, string>> {
		if (!schema) return {};
		const result = await schema['~standard'].validate(values);
		if (result.issues) {
			const field_errors: Record<string, string> = {};
			for (const issue of result.issues) {
				const path = issue.path
					?.map((p) => (typeof p === 'object' && p !== null && 'key' in p ? p.key : p))
					.join('.');
				if (path) field_errors[path] = issue.message;
			}
			return field_errors;
		}
		return {};
	}

	async function validateSingleField(name: string): Promise<void> {
		const all_errors = await validate(data);
		if (all_errors[name]) {
			errors[name] = all_errors[name];
		} else {
			delete errors[name];
			// Force reactivity by re-assigning
			errors = { ...errors };
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Context methods                                                    */
	/* ------------------------------------------------------------------ */

	function register(name: string, element: HTMLElement) {
		field_elements.set(name, element);
	}

	function unregister(name: string) {
		field_elements.delete(name);
		delete errors[name];
		delete touched[name];
	}

	function setValue(name: string, value: unknown) {
		(data as Record<string, unknown>)[name] = value;

		if (validate_on === 'change' && touched[name]) {
			validateSingleField(name);
		}

		onchange?.({ data, errors });
	}

	function setTouched(name: string) {
		touched[name] = true;

		if (validate_on === 'blur') {
			validateSingleField(name);
		}
	}

	function validateField(name: string) {
		validateSingleField(name);
	}

	/* ------------------------------------------------------------------ */
	/*  Context                                                            */
	/* ------------------------------------------------------------------ */

	// svelte-ignore state_referenced_locally
	const ctx = $state<FormContext>({
		data,
		errors,
		touched,
		is_dirty: false,
		is_submitting: false,
		is_valid: true,
		disabled: false,
		validate_on,
		register,
		unregister,
		setValue,
		setTouched,
		validateField,
	});
	setContext<FormContext>('form', ctx);

	// Keep context in sync with reactive state
	$effect(() => {
		ctx.data = data;
		ctx.errors = errors;
		ctx.touched = touched;
		ctx.is_dirty = is_dirty;
		ctx.is_submitting = is_submitting;
		ctx.is_valid = is_valid;
		ctx.disabled = effectively_disabled;
		ctx.validate_on = validate_on;
	});

	/* ------------------------------------------------------------------ */
	/*  Auto-focus first error field                                       */
	/* ------------------------------------------------------------------ */

	function focusFirstError(field_errors: Record<string, string>) {
		for (const [name] of field_elements) {
			if (field_errors[name]) {
				const el = field_elements.get(name);
				if (el) {
					el.focus();
					el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
				break;
			}
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Form reset                                                         */
	/* ------------------------------------------------------------------ */

	function resetForm() {
		data = JSON.parse(initial_snapshot);
		errors = {};
		touched = {};
		onreset?.();
	}

	/* ------------------------------------------------------------------ */
	/*  Form submission                                                    */
	/* ------------------------------------------------------------------ */

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();

		if (is_submitting) return;

		// Validate all fields
		const field_errors = await validate(data);
		errors = field_errors;

		// Mark all registered fields as touched
		for (const [name] of field_elements) {
			touched[name] = true;
		}

		const valid = Object.keys(field_errors).length === 0;

		if (!valid) {
			onerror?.({ errors: field_errors });
			focusFirstError(field_errors);
			return;
		}

		if (!onsubmit) return;

		const result = onsubmit({ data, is_valid: valid });

		// Promise-aware submission
		if (result && typeof result === 'object' && 'then' in result) {
			is_submitting = true;
			try {
				await result;
				if (reset_on_submit) {
					resetForm();
				}
			} finally {
				is_submitting = false;
			}
		} else {
			if (reset_on_submit) {
				resetForm();
			}
		}
	}

	function handleReset(event: Event) {
		event.preventDefault();
		resetForm();
	}
</script>

<form
	{id}
	class={['form', class_name].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:disabled={effectively_disabled}
	data-disabled={effectively_disabled || undefined}
	onsubmit={handleSubmit}
	onreset={handleReset}>
	{#if children}
		{@render children()}
	{/if}
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form.dense {
		gap: 0.5rem;
	}

	.form.comfortable {
		gap: 1.5rem;
	}

	.form.disabled {
		opacity: 0.6;
		pointer-events: none;
	}
</style>
