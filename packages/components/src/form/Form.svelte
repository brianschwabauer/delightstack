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

	/**
	 * The minimal entity shape the Form's `entity` prop accepts. `EntityState`
	 * from `@delightstack/database` satisfies it, but any object with an
	 * editable `value` and a `save()` works — the interface is structural, so
	 * the components package has no dependency on the database package.
	 */
	export interface FormEntity {
		/** The editable draft the form reads & writes (field names may be dot-notation paths) */
		value: Record<string, unknown>;
		/** Persists the draft; called on submit after validation passes */
		save: () => Promise<unknown>;
		/** Whether a save is in flight (drives the form's submitting state) */
		readonly saving?: boolean;
		/** Whether the draft differs from the persisted state (drives is_dirty) */
		readonly has_changes?: boolean;
		/** Restores the draft to the persisted state (used by form reset) */
		reset?: () => void;
		/** Last save/load error, if the entity tracks one */
		readonly error?: unknown;
	}

	export interface FormContext {
		/** The current form data keyed by field name */
		data: Record<string, unknown>;
		/** Current validation error messages keyed by field name */
		errors: Record<string, string>;
		/** Which fields have been touched (blurred/edited) keyed by field name */
		touched: Record<string, boolean>;
		/** Whether any field has been changed from its initial value */
		is_dirty: boolean;
		/** Whether the form is currently submitting */
		is_submitting: boolean;
		/** Whether the form currently has no validation errors */
		is_valid: boolean;
		/** Whether the whole form is disabled */
		disabled: boolean;
		/** When fields run validation */
		validate_on: 'change' | 'blur' | 'submit';
		/**
		 * Registers a field's element with the form (for focus-on-error).
		 * A field may also register a validator (like the `parse` function from a
		 * database table's form props) — the form runs it alongside the form-level
		 * schema. When both produce an error for the same field, the schema wins.
		 */
		register: (
			name: string,
			element: HTMLElement,
			validator?: (value: unknown) => unknown,
		) => void;
		/** Removes a field from the form when it unmounts */
		unregister: (name: string) => void;
		/** Updates a field's value in the form data */
		setValue: (name: string, value: unknown) => void;
		/**
		 * Reads a field's value from the form data. Resolves dot-notation
		 * names against nested data (a literal flat key wins), so fields work
		 * over both flat data records and nested entity values.
		 */
		getValue: (name: string) => unknown;
		/** Marks a field as touched */
		setTouched: (name: string) => void;
		/** Runs validation for a single field */
		validateField: (name: string) => void;
	}
</script>

<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	const propId = $props.id();

	let {
		/** The form data object (bindable). Ignored when `entity` is set. */
		data = $bindable({}) as Record<string, unknown>,

		/**
		 * An entity to bind the form to (e.g. `db.entity('person', id)` from
		 * `@delightstack/database`). The form edits `entity.value` directly,
		 * derives dirty/submitting state from it, and calls `entity.save()` on
		 * submit once validation passes. Fields spread from `entity.form.field`
		 * need no `bind:value` — values flow through the form context.
		 */
		entity = undefined as FormEntity | undefined,

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

		/** Called when validation fails on submit, or when an entity save rejects */
		onerror = undefined as
			| ((detail: { errors: Record<string, string>; error?: unknown }) => void)
			| undefined,

		/** Called after an entity-backed form saves successfully */
		onsaved = undefined as ((detail: { entity: FormEntity }) => void) | undefined,

		/** Called when the form is reset */
		onreset = undefined as (() => void) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Data access                                                        */
	/* ------------------------------------------------------------------ */

	/** The record the form reads & writes: the entity's draft, or the data prop */
	const form_data = $derived(entity ? entity.value : data);

	/**
	 * Reads a (possibly dot-notation) field name from the form data. A literal
	 * flat key wins, then the nested path is walked — so the same field names
	 * work over a flat data record or a nested entity value.
	 */
	function getValueAtPath(record: Record<string, unknown>, name: string): unknown {
		if (name in record) return record[name];
		if (!name.includes('.')) return undefined;
		let current: unknown = record;
		for (const part of name.split('.')) {
			if (!current || typeof current !== 'object') return undefined;
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}

	/** Writes a (possibly dot-notation) field name, creating nested objects as needed */
	function setValueAtPath(
		record: Record<string, unknown>,
		name: string,
		value: unknown,
	): void {
		if (!name.includes('.') || name in record) {
			record[name] = value;
			return;
		}
		const parts = name.split('.');
		let current = record;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!current[part] || typeof current[part] !== 'object') {
				current[part] = {};
			}
			current = current[part] as Record<string, unknown>;
		}
		current[parts[parts.length - 1]] = value;
	}

	/* ------------------------------------------------------------------ */
	/*  Internal state                                                     */
	/* ------------------------------------------------------------------ */

	/** Snapshot of the initial data for dirty tracking and reset (data-prop mode only) */
	let initial_snapshot = JSON.stringify(data);

	/** Registry of field elements by name */
	let field_elements = new Map<string, HTMLElement>();

	/** Registry of field-level validators by name (e.g. table form props' parse) */
	let field_validators = new Map<string, (value: unknown) => unknown>();

	/** Validation errors keyed by field name */
	let errors = $state<Record<string, string>>({});

	/** Touched state keyed by field name */
	let touched = $state<Record<string, boolean>>({});

	/** Whether the form is currently submitting */
	let is_submitting = $state(false);

	/** Whether the form data has changed (entity dirty state, or snapshot diff) */
	let is_dirty = $derived(
		entity ? (entity.has_changes ?? false) : JSON.stringify(data) !== initial_snapshot,
	);

	/** Whether the form currently has no validation errors */
	let is_valid = $derived(Object.keys(errors).length === 0);

	/** Whether a submit is in flight (locally tracked, or the entity is saving) */
	let effectively_submitting = $derived(is_submitting || (entity?.saving ?? false));

	/** Whether the form should be effectively disabled (explicit or submitting) */
	let effectively_disabled = $derived(disabled || effectively_submitting);

	/* ------------------------------------------------------------------ */
	/*  Standard Schema validation                                         */
	/* ------------------------------------------------------------------ */

	async function validate(
		values: Record<string, unknown>,
	): Promise<Record<string, string>> {
		const field_errors: Record<string, string> = {};

		// Field-level validators run first; the form-level schema overwrites any
		// error for the same field below, so the two never conflict — fields the
		// schema doesn't cover keep their field-level error.
		for (const [name, validator] of field_validators) {
			try {
				validator(getValueAtPath(values, name));
			} catch (error) {
				field_errors[name] = error instanceof Error ? error.message : 'Invalid value';
			}
		}

		if (schema) {
			const result = await schema['~standard'].validate(values);
			if (result.issues) {
				for (const issue of result.issues) {
					const path = issue.path
						?.map((p) => (typeof p === 'object' && p !== null && 'key' in p ? p.key : p))
						.join('.');
					if (path) field_errors[path] = issue.message;
				}
			}
		}
		return field_errors;
	}

	async function validateSingleField(name: string): Promise<void> {
		const all_errors = await validate(form_data);
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

	function register(
		name: string,
		element: HTMLElement,
		validator?: (value: unknown) => unknown,
	) {
		field_elements.set(name, element);
		if (validator) field_validators.set(name, validator);
	}

	function unregister(name: string) {
		field_elements.delete(name);
		field_validators.delete(name);
		delete errors[name];
		delete touched[name];
	}

	function setValue(name: string, value: unknown) {
		setValueAtPath(form_data, name, value);

		// In 'change' mode, validate on every edit — including the first
		// keystroke, before the field has been blurred. Error display keys off
		// errors[name] (not touched), so this surfaces feedback live as you type.
		if (validate_on === 'change') {
			validateSingleField(name);
		}

		onchange?.({ data: form_data, errors });
	}

	function getValue(name: string): unknown {
		return getValueAtPath(form_data, name);
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
		getValue,
		setTouched,
		validateField,
	});
	setContext<FormContext>('form', ctx);

	// Keep context in sync with reactive state
	$effect(() => {
		ctx.data = form_data;
		ctx.errors = errors;
		ctx.touched = touched;
		ctx.is_dirty = is_dirty;
		ctx.is_submitting = effectively_submitting;
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
		if (entity) {
			entity.reset?.();
		} else {
			data = JSON.parse(initial_snapshot);
		}
		errors = {};
		touched = {};
		onreset?.();
	}

	/* ------------------------------------------------------------------ */
	/*  Form submission                                                    */
	/* ------------------------------------------------------------------ */

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();

		if (effectively_submitting) return;

		// Validate all fields
		const field_errors = await validate(form_data);
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

		// Entity-backed submission: optional onsubmit hook (e.g. to massage the
		// draft), then save. The saved entity carries its id (create or update).
		if (entity) {
			// Write each field's PARSED value back into the draft first — parse()
			// normalizes ('' becomes undefined, schema transforms apply), so the
			// entity saves clean data instead of raw input strings.
			for (const [field_name, validator] of field_validators) {
				try {
					setValueAtPath(
						form_data,
						field_name,
						validator(getValueAtPath(form_data, field_name)),
					);
				} catch {
					// Validation above passed; leave the raw value if a validator
					// is non-deterministic
				}
			}
			is_submitting = true;
			try {
				await onsubmit?.({ data: form_data, is_valid: valid });
				await entity.save();
				if (reset_on_submit) resetForm();
				onsaved?.({ entity });
			} catch (error) {
				// The entity tracks the failure on entity.error too (when supported)
				onerror?.({ errors: {}, error });
			} finally {
				is_submitting = false;
			}
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
	/* The `.form` class is part of the public surface (consumers target
	   `form.form` via :global) — keep it even though the element is unique. */
	.form {
		display: flex;
		flex-direction: column;
		gap: 1rem;

		&.dense {
			gap: 0.5rem;
		}
		&.comfortable {
			gap: 1.5rem;
		}
		&.disabled {
			opacity: 0.6;
			pointer-events: none;
		}
	}
</style>
