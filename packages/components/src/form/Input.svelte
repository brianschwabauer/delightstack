<script lang="ts" module>
	/**
	 * 
	 * Single-line Text Field: Basic text input.
	
	Password Field: Masks input characters.
	
	Email Field: Specific validation for email format.
	
	Number Field (Spinbutton): Numeric input with increment/decrement arrows.
	
	Search Input: Often with a clear button or search icon.
	
	Textarea: Multi-line text input.
	
	Labeled Input: Input field with an associated label.
	
	Placeholder Text: Example text within the input field.
	
	Helper Text / Hint Text: Provides context or instructions.
	
	Validation States (Error, Success, Warning): Visual feedback for input validity.
	
	Input with Icon: Prefix/suffix icons for visual cues.
	
	Masked Input: Enforces a specific input format (e.g., phone number, credit card).

	Date Picker: Allows selection of a single date.

	Date Range Picker: Selects a start and end date.

	Time Picker: Selects a specific time.

	Date & Time Picker: Combines both.

	Color Picker: Allows users to select a color from a palette or gradient.

	Copyable Input: Input field with a copy button to easily copy its content.

	https://flowbite-svelte.com/docs/forms/input-field

	https://flowbite-svelte.com/docs/forms/search-input
	
	https://next.melt-ui.com/components/combobox/
	
	 */

	type InputTypeMap = {
		text: string | null;
		textarea: string | null;
		color: string | null;
		date: number | null | undefined;
		time: number | null | undefined; // Number of ms since midnight
		datetime: number | null | undefined;
		email: string | null;
		file: File | null;
		number: number | null;
		password: string | null;
		phone: string | null;
		search: string | null;
		url: string | null;
		custom: any | null;
	};

	/** Converts the given value to a string that an html input field can use */
	function convertFromValueToHtmlInputString<Type extends keyof InputTypeMap>(
		type: Type,
		data?: InputTypeMap[Type],
	) {
		if (Array.isArray(data)) return '';
		if (type === 'time') {
			if (data && typeof data === 'number') {
				if (data < 24 * 60 * 60 * 1000) {
					const hours = Math.floor(data / (60 * 60 * 1000));
					const minutes = Math.floor((data - hours * 60 * 60 * 1000) / (60 * 1000));
					return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
				}
				const date = new Date(data);
				return `${String(date.getHours()).padStart(2, '0')}:${String(
					date.getMinutes(),
				).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
			}
		}
		if (type === 'date') {
			if (typeof data === 'number') {
				try {
					const date = new Date(data);
					return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
						2,
						'0',
					)}-${String(date.getDate()).padStart(2, '0')}`;
				} catch (error) {
					return '';
				}
			}
		}
		if (type === 'datetime') {
			if (typeof data === 'number') {
				try {
					const date = new Date(data);
					return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
						2,
						'0',
					)}-${String(date.getUTCDate()).padStart(2, '0')}T${String(
						date.getUTCHours(),
					).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(
						date.getUTCSeconds(),
					).padStart(2, '0')}`;
				} catch (error) {
					return '';
				}
			}
		}
		if (type === 'color') {
			if (typeof data !== 'string' || !data) return '';
			if (data.match(/^#[0-9a-fA-F]{6}$/)) return data.toUpperCase();
			if (data.match(/^\[/)) return data;
			try {
				const div = document.createElement('div');
				div.style.backgroundColor = data;
				document.body.appendChild(div);
				const rgb = getComputedStyle(div).backgroundColor;
				let hex = rgbSringToHex(rgb);
				if (typeof hex === 'string') hex = hex.toUpperCase();
				document.body.removeChild(div);
				return hex;
			} catch (error) {
				return '';
			}
		}
		return data ?? '';
	}
</script>

<script
	lang="ts"
	generics="InputType extends keyof InputTypeMap = 'text', Multiple extends boolean = false">
	import type { FullAutoFill, HTMLInputTypeAttribute } from 'svelte/elements';
	import {
		rgbSringToHex,
		ripple,
		autoAnimate,
		truncateText,
		focusWithin,
		tooltip as tooltipAction,
		isEqual,
	} from '@packages/lib';
	import { browser } from '$app/environment';
	import { untrack, tick, type Snippet } from 'svelte';
	import CalendarIcon from '~icons/material-symbols/calendar-today';
	import ClockIcon from '~icons/mdi/clock';
	import CloseIcon from '~icons/ion/md-close-circle';
	import HelpIcon from '~icons/material-symbols/help';
	import Portal from './../components/Portal.svelte';
	import { cubicOut } from 'svelte/easing';

	interface InputProps {
		/** The type of value the input expects */
		type?: InputType;
		/** The current validated value of the input */
		value?: InputType extends keyof InputTypeMap
			? Multiple extends true
				? Array<NonNullable<InputTypeMap[InputType]>>
				: InputTypeMap[InputType]
			: string;
		/** The list of values that are suggested in a dropdown when the user types */
		options?: NonNullable<InputTypeMap[InputType]>[];
		/**
		 * The mode of the options dropdown.
		 * 'autocomplete' shows a list of options as the user types. The user doesn't have to choose one of the options
		 * 'select' does the same as autocomplete, but requires the user to select one of the options
		 */
		optionsMode?: 'autocomplete' | 'select';
		/** The snippet that will be used to render the options list */
		optionsDisplay?: Snippet<[NonNullable<InputTypeMap[InputType]>, number]>;
		/** The snippet that will be used to render the chips list. Only valid if 'multiple' is true */
		chipsDisplay?: Snippet<[NonNullable<InputTypeMap[InputType]>, number]>;
		/** Whether the input should autofocus when the page loads */
		autofocus?: boolean;
		/** The browser html input autocomplete attribute which tells the browser how the input can be autofilled */
		autocomplete?: FullAutoFill;
		/**
		 * Whether the input should include less padding
		 * Note - this doesn't change font size - just spacing.
		 * To change font size, set the font-size on the parent element
		 */
		dense?: boolean;
		/** Whether the input should have more padding */
		comfortable?: boolean;
		/** Whether the input should be rounded (larger border-radius) */
		rounded?: boolean;
		/** Whether the input should be outlined @default true */
		outlined?: boolean;
		/** Whether the input is currently loading (shows a loading spinner) */
		loading?: boolean;
		/** Whether a 'clear' button (with X) should be added to the input to clear the contents */
		clearable?: boolean;
		/** Whether the input is readonly (disallows edits) */
		readonly?: boolean;
		/** Whether the input is a required field in the form */
		required?: boolean;
		/** Whether the input is disabled and accepts no interactions */
		disabled?: boolean;
		/** Whether the field has been touched (and blurred) */
		touched?: boolean;
		/** Whether the field has a value (field is filled in) */
		dirty?: boolean;
		/** Whether or not multiple values are allowed. If true, the values will show up as 'chips' beside the input */
		multiple?: Multiple;
		/**
		 * The list of mime types the input will accept. Only valid if 'type' === 'file'
		 * @example ['image/png', 'image/jpeg', 'image/*', 'video/*', 'audio/*', 'application/pdf']
		 */
		accept?: string[];
		/** The text in the input field when there is no value yet */
		label?: string;
		/**
		 * How the label should be displayed.
		 * 'floating' - the label floats above the input when there is a value
		 * 'placeholder' - the label is a placeholder inside the input
		 * @default 'floating'
		 */
		labelDisplay?: 'floating' | 'placeholder';
		/** Additional helpful information shown when hovering over the label. Adds a "question mark" icon to the label */
		tooltip?: string;
		/** Small text under the input that gives additional helpful information */
		hint?: string;
		/** The ID of the input element. @defaults to a random ID */
		id?: string;
		/** The css style string added to the component from the parent */
		style?: string;
		/** The maximum length the input string can be. Only valid for certain inputs - like text, email, etc */
		maxlength?: number;
		/** The minimum length the input string can be. Only valid for certain inputs - like text, email, etc */
		minlength?: number;
		/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
		max?: string | number;
		/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
		min?: string | number;
		/** The amount the number should be increased/decreased with each 'step' */
		step?: number;
		/** The maximum amount of digits allowed in a number input. 0 makes the number an integer */
		maxDigits?: number;
		/** The regular expression the input must match (handled by the native browser input) */
		pattern?: string;
		/**
		 * The raw input text shown in the input field. May or may not be the same as value
		 * This can be used by the parent component to get the text of the input field without the value validation/parsing
		 * The parent component could then use the input field text to search an autocomplete list
		 */
		input?: string;

		/**
		 * A function that when given the current value of the input, should return the stringified version of the value
		 * This value will be used to show the value in the input field, or in the autocomplete panel
		 */
		toDisplayString?: (value: this['value']) => string;

		/**
		 * A function for converting the current value to the input to the html stringified version that the input element is expecting
		 * This is necessary because the 'value' might be a complex object, but the input element only accepts strings
		 */
		toHtmlString?: (value: this['value']) => string;
		/**
		 * A function that is called on every change
		 * If it throws and error, the error can contain a "message" field that will be shown to the user
		 */
		validate?: (value: any) => void;
		/** The native browser input element. This is exported so parent components can access it easily */
		inputElement?: HTMLInputElement | HTMLTextAreaElement;
		/** Specifies a custom class name for the container element */
		class?: string;
		/** Whether the label text and outlines should show an "error" red color */
		error?: boolean;
		/** The error message to display from the parent component */
		errorMessage?: string;
		/** The snippet for displaying html before the input element (but inside the container) */
		prepend?: Snippet;
		/** The snippet for displaying html right before the input element */
		content?: Snippet;
		/** The snippet for displaying the clear/close icon inside the input box */
		clearIcon?: Snippet;
		/** The snippet for displaying html after the input element */
		append?: Snippet;
		/** The snippet for displaying html in the input label/placeholder */
		children?: Snippet;
		/** Emits when the field has been focused */
		onfocus?: (e: FocusEvent) => void;
		/** Emits when the field has been blurred */
		onblur?: (e: FocusEvent) => void;
		/** Emits when a key is pressed down in the input field */
		onkeydown?: (e: KeyboardEvent) => void;
		/** Emits when a key is released in the input field */
		onkeyup?: (e: KeyboardEvent) => void;
		/** Emits the new input value when the user pastes text into the field */
		onpaste?: (value: this['value'] | undefined, e: ClipboardEvent) => void;
		/** Emits when the field has been touched (and blurred) */
		ontouch?: () => void;
		/** Emits when the field has a value (field is filled in) */
		ondirty?: () => void;
		/** Emits the current value of the input when it changes */
		onchange?: (output: this['value']) => void;
		/** Emits the string value of the input field when the user types */
		oninput?: (input: string) => void;
		/** Emits the current value of the input when the user 'submits' the input via 'Enter' key */
		onsubmit?: (output: this['value']) => void;
		/** Emits the value that was selected using the autocomplete panel */
		onselect?: (output: this['value']) => void;
		/** Emits when the input has been marked as valid */
		onvalid?: () => void;
		/** Emits when the input has been marked as invalid */
		oninvalid?: () => void;
	}

	const propId = $props.id();
	let {
		type = 'text' as InputType,
		value = $bindable(),
		toDisplayString,
		toHtmlString,
		options,
		optionsMode = 'autocomplete',
		optionsDisplay,
		chipsDisplay,
		autocomplete = '',
		autofocus = false,
		dense = false,
		comfortable = false,
		rounded = false,
		outlined = true,
		loading = $bindable(false) as boolean,
		clearable = false,
		readonly = false,
		required = false,
		disabled = false,
		touched = false,
		dirty = false,
		multiple = false as Multiple,
		accept,
		label = '',
		labelDisplay = 'floating',
		tooltip = '',
		hint = '',
		id = propId,
		style = '',
		maxlength,
		minlength,
		max,
		min,
		step,
		maxDigits,
		pattern,
		validate,
		inputElement = $bindable() as HTMLInputElement | HTMLTextAreaElement | undefined,
		class: className = '',
		error = false,
		errorMessage = $bindable('') as string,
		append,
		prepend,
		clearIcon,
		content,
		children,
		onfocus,
		onblur,
		oninput,
		onkeydown,
		onkeyup,
		onpaste,
		ontouch,
		ondirty,
		onchange,
		onsubmit,
		onselect,
		onvalid,
		oninvalid,
	}: InputProps = $props();

	/** The native browser autocomplete panel element */
	let autocompleteElement = $state<HTMLDivElement | undefined>(undefined);

	const TEXTAREA_MIN_LINES = 3;
	let labelElement = $state<HTMLLabelElement | undefined>(undefined);
	let inputParentElement = $state<HTMLDivElement | undefined>(undefined);
	let inputContainerElement = $state<HTMLDivElement | undefined>(undefined);
	let focusedChipIndex = $state(0);
	let popoverIndex = $state(0);

	/** The index of the currently active/focused autocomplete item */
	let autocompleteIndex = $state(0);

	/** Whether or not the autocomplete panel is currently being shown */
	let autocompleteShown = $state(false);

	/** Whether or not any element is focused inside of the input container */
	let focused = $state(false);

	/** The type to use for the input element. Must be a valid input type (like 'text') */
	const elType = $derived.by<HTMLInputTypeAttribute>(() => {
		if (type === 'phone') return 'tel';
		if (type === 'datetime') return 'datetime-local';
		if (type === 'number') return 'number';
		if (type === 'date') return 'date';
		if (type === 'time') return 'time';
		if (type === 'email') return 'email';
		if (type === 'file') return 'file';
		if (type === 'phone') return 'tel';
		if (type === 'url') return 'url';
		if (type === 'password') return 'password';
		return 'text';
	});

	/** The value of the input element. Different than 'value' because html inputs only support certain types */
	let elValue = $derived(
		toHtmlString ? toHtmlString(value) : convertFromValueToHtmlInputString(type, value),
	);

	/** Whether the input value is valid based on the contraints (and validator function) */
	const valid = $derived(!!errorMessage);

	/** The list of chips to display (only used when 'multiple' is true) */
	const chips = $derived<InputTypeMap[InputType][]>(
		!multiple
			? []
			: Array.isArray(value)
				? value
				: value !== null && value !== undefined && value !== ''
					? [value]
					: [],
	);
	const hasLabel = $derived(labelDisplay === 'floating' && (children || label));
	const labelText = $derived(
		(multiple && !!chips.length ? 'Add ' : '') +
			(label || labelElement?.innerText || ' '),
	);
	const canShowError = $derived(!focused && dirty && errorMessage);

	// Autofocus the input element if necessary
	$effect(() => {
		if (inputElement && autofocus) {
			setTimeout(() => inputElement?.focus(), 100);
		}
	});

	// Reset the autocomplete index when the autocomplete list changes
	$effect(() => {
		if (options?.length) autocompleteIndex = 0;
	});

	// Scroll the autocomplete panel to the currently selected item
	$effect(() => {
		if (autocompleteElement && autocompleteIndex > -1 && options?.length) {
			const items = autocompleteElement.querySelectorAll('.autocomplete-item');
			const item = items?.[autocompleteIndex];
			if (item) {
				item.scrollIntoView({
					block: 'nearest',
					inline: 'nearest',
				});
			}
		}
	});

	// Update the error message when the field value changes
	$effect(() => {
		if (validate) {
			try {
				validate(value);
				errorMessage = '';
			} catch (error: any) {
				if (typeof error === 'string') errorMessage = error;
				else if (error?.message) errorMessage = error.message;
				else if (error instanceof Error) errorMessage = error.message;
				else errorMessage = 'Invalid value';
			}
			return;
		}
		if (
			required &&
			((Array.isArray(value) && !value.length) ||
				(!value && value !== 0 && value !== false))
		) {
			errorMessage = 'Please fill out this field';
			return;
		}
		const tempElement = document.createElement('input');
		tempElement.type = elType;
		if (maxlength) tempElement.maxLength = maxlength;
		if (minlength) tempElement.minLength = minlength;
		if (pattern) tempElement.pattern = pattern;
		if (min) tempElement.min = min.toString();
		if (max) tempElement.max = max.toString();
		if (step) tempElement.step = step.toString();
		tempElement.value = elValue;

		try {
			const isValid = tempElement.checkValidity();
			errorMessage = isValid
				? ''
				: tempElement.validationMessage.replace(/^\w/, (c) => c.toUpperCase());
		} catch (error: any) {
			errorMessage = (
				(typeof error?.message === 'string'
					? error?.message
					: tempElement.validationMessage) || 'Invalid value'
			).replace(/^\w/, (c: string) => c.toUpperCase());
		} finally {
			tempElement.remove();
		}
	});

	// Emit the 'onvalid' or 'oninvalid' event when the validity state changes
	$effect(() => {
		if (valid) {
			if (onvalid) onvalid();
		} else {
			if (oninvalid) oninvalid();
		}
	});

	/** Sanitizes, validates and updates the value to the given value */
	function updateValue(rawValue: any) {
		const unstated = $state.snapshot(rawValue);
		let array = Array.isArray(unstated) ? unstated : [unstated];

		function maybeSplitEmails(email: string): string[] {
			if (!email || typeof email !== 'string') return [];
			const isEmail = (v: string) => v.match(/^[^@]+@[^@]+\.[^@]+$/);
			return email
				.split(',')
				.map((v) => v.trim())
				.filter((email) => isEmail(email));
		}

		const addedValues: any[] = [];
		for (let i = 0; i < array.length; i++) {
			if (type === 'number') {
				if (typeof array[i] === 'string' && array[i]) {
					array[i] = +array[i];
				}
				if (typeof array[i] === 'number') {
					if (typeof maxDigits === 'number') {
						if (maxDigits === 0) {
							array[i] = `${array[i]}`.replace(/\.\d*/g, '');
						} else if (typeof array[i] === 'string' && array[i].includes('.')) {
							array[i] = array[i].replace(
								new RegExp(`^(\\d*\\.\\d{0,${maxDigits}})\.*`),
								'$1',
							);
						}
					}
					if (typeof max === 'number') {
						array[i] = Math.min(max, array[i]);
					}
					if (typeof min === 'number') {
						array[i] = Math.max(min, array[i]);
					}
				}
			} else if (type === 'color') {
				if (typeof array[i] !== 'string' || !array[i]) {
					array[i] = undefined;
				} else if (array[i].match(/^#[0-9a-fA-F]{6}$/)) {
					array[i] = array[i].toUpperCase();
				} else if (!array[i].match(/^\[/)) {
					try {
						const div = document.createElement('div');
						div.style.backgroundColor = array[i];
						document.body.appendChild(div);
						const rgb = getComputedStyle(div).backgroundColor;
						let hex = rgbSringToHex(rgb);
						if (typeof hex === 'string') hex = hex.toUpperCase();
						document.body.removeChild(div);
						array[i] = hex.toUpperCase();
					} catch (error) {
						array[i] = undefined;
					}
				}
			} else if (type === 'date' || type === 'datetime') {
				if (typeof array[i] === 'string') {
					try {
						array[i] = new Date(array[i]).getTime();
					} catch (error) {
						array[i] = undefined;
					}
				}
				if (typeof array[i] !== 'number') {
					array[i] = undefined;
				} else {
					if (typeof max === 'number') {
						array[i] = Math.min(max, array[i]);
					}
					if (typeof min === 'number') {
						array[i] = Math.max(min, array[i]);
					}
				}
			} else if (type === 'time') {
				if (typeof array[i] === 'string') {
					try {
						const [hours, minutes] = array[i].split(':').map((v: string) => +v);
						array[i] = (hours * 60 + minutes) * 60 * 1000;
					} catch (error) {
						array[i] = undefined;
					}
				}
				if (typeof array[i] !== 'number') {
					array[i] = undefined;
				} else {
					array[i] = Math.max(
						0,
						+min! || 0,
						Math.min(1000 * 60 * 60 * 24, +max! || Infinity, array[i]),
					);
				}
			} else if (type === 'file') {
				if (array[i] instanceof File) {
					if (accept?.length) {
						const isValidType = accept.some((mime) => {
							return array[i].type.startsWith(mime.replace(/\*/g, ''));
						});
						if (!isValidType) array[i] = undefined;
					}
				} else {
					array[i] = undefined;
				}
			} else if (type === 'email') {
				const emails = maybeSplitEmails(array[i]);
				array[i] = emails[0];
				if (emails.length > 1) {
					emails.slice(1).forEach((email) => addedValues.push(email));
				}
			} else if (type === 'text' || type === 'textarea') {
				if (typeof array[i] === 'string') {
					if (maxlength) {
						array[i] = array[i].slice(0, maxlength);
					}
				}
			}
		}
		array = [...array, ...addedValues];

		// Remove invalid & duplicate values
		array = array.reduce((acc: any[], val: any, i) => {
			if (val || val === 0) {
				const isUnique = !acc.slice(0, i).some((v) => isEqual(v, val));
				if (isUnique) acc.push(val);
			}
			return acc;
		}, []);

		value = multiple ? array : array[0];
		if (!dirty) {
			dirty = true;
			if (ondirty) ondirty();
		}
		if (onchange) onchange(value!);
	}

	/** Adds an item to the 'chips' list for when 'multiple' is true */
	function addChips(val: any[]) {
		if (!multiple || !val?.length) return;
		if (!value || !Array.isArray(value)) value = [] as any;
		updateValue([...(value as any[]), ...val]);
		if (inputElement) inputElement.value = '';
	}

	/** Removes the item at the given index for when 'multiple' is true and there are multiple selected items */
	async function removeChip(index: number) {
		if (!multiple) {
			updateValue('');
			return;
		}
		if (!value || !Array.isArray(value) || (value as any[])[index] === undefined) return;
		const list = [...value] as any[];
		list.splice(index, 1);
		updateValue(list);
		await tick();
		if (!(value as any[]).length) inputElement?.focus();
	}

	/** Focuses the 'chip' at the given index so the user can remove it with the keyboard - via backspace or delete key */
	async function focusChip(index: number) {
		if (!multiple || !browser || !document || !inputParentElement) return;
		const numChips = (value as unknown as any[])?.length || 0;
		focusedChipIndex = Math.max(0, Math.min(numChips - 1, index));
		await tick();
		if (document.activeElement !== inputParentElement) inputParentElement.focus();
	}

	/** Returns whether the key code from a keyboard event is a key that doesn't effect an input field */
	function isSystemKey(key: string) {
		return (
			key.match(/^F\d+$/) ||
			[
				'Enter',
				'Escape',
				'Tab',
				'Control',
				'Shift',
				'Alt',
				'Meta',
				'PageDown',
				'PageUp',
				'ArrowUp',
				'ArrowDown',
				'ArrowLeft',
				'ArrowRight',
				'Home',
				'End',
			].includes(key)
		);
	}

	/** Handles when the value changes on the input field */
	function onInputChange(evt: Event) {
		const element = (evt.target as HTMLInputElement) || inputElement;
		if (!element) return;
		if (type === 'file') {
			if (multiple) addChips(Array.from(element?.files || []));
			if (!multiple) updateValue(element?.files?.[0]);
			return;
		}
		if (type === 'time') {
			try {
				const [hours, minutes] = element.value.split(':').map((v: string) => +v);
				const time = Math.max(
					0,
					+min! || 0,
					Math.min(
						1000 * 60 * 60 * 24,
						+max! || Infinity,
						(hours * 60 + minutes) * 60 * 1000,
					),
				);
				element.value = convertFromValueToHtmlInputString(type, time);
			} catch (error) {}
		}
		elValue = element.value;
		oninput?.(element.value);
		if (!multiple) updateValue(element.value);
	}

	/** Called when the input field is blurred */
	function onInputBlur() {
		if (!touched) {
			touched = true;
			if (ontouch) ontouch();
		}
		if (optionsMode === 'select') {
			if (
				elValue &&
				options &&
				options[autocompleteIndex] &&
				!options.some((v) => isEqual(v, value))
			) {
				onAutocompleteClick(options[autocompleteIndex], autocompleteIndex);
			}
		} else if (multiple) {
			if (autocompleteShown) {
				if (elValue && options && options[autocompleteIndex]) {
					// Add the autocomplete value with a delay to allow the input's width to be set to 0
					// This prevents the input from jumping around when the chip is added
					const autocompleteValue = options[autocompleteIndex];
					setTimeout(() => onAutocompleteClick(autocompleteValue, autocompleteIndex), 50);
				}
			} else {
				if (elValue || elValue === 0) {
					// Add the chip with a delay to allow the input's width to be set to 0
					// This prevents the input from jumping around when the chip is added
					const chipValue = elValue;
					setTimeout(() => addChips([chipValue]), 50);
				}
			}
		}
	}

	/** Handles the key down event for the main input field */
	let prevInput: any;
	function onInputKeyDown(evt: KeyboardEvent) {
		const element = (evt.target as HTMLInputElement) || inputElement;
		if (!element) return;
		prevInput = element.value;
		if (autocompleteShown && options) {
			if (evt.key === 'ArrowDown') {
				evt.preventDefault();
				autocompleteIndex = (autocompleteIndex + 1) % options.length;
			} else if (evt.key === 'ArrowUp') {
				evt.preventDefault();
				autocompleteIndex = (autocompleteIndex + options.length - 1) % options.length;
			}
		}
		if (type === 'number' && evt.key.toLowerCase() === 'e') {
			evt.preventDefault();
		}
	}

	/** Handles the key up event for the main input field */
	function onInputKeyUp(evt: KeyboardEvent) {
		if (evt.key === 'Enter') {
			if (autocompleteShown && options && options.length) {
				onAutocompleteClick(options[autocompleteIndex], autocompleteIndex);
			} else if (multiple) {
				if (inputElement) addChips([inputElement.value]);
			} else if (valid && type !== 'textarea') {
				if (onsubmit) onsubmit(value!);
			}
		}
		if (evt.key === 'Escape') {
			if (autocompleteShown) {
				autocompleteShown = false;
				evt.preventDefault();
				evt.stopPropagation();
			}
		}
		if (
			evt.key &&
			(!isSystemKey(evt.key) || evt.key === 'ArrowDown' || evt.key === 'ArrowUp')
		) {
			if (!autocompleteShown && options?.length) autocompleteShown = true;
			evt.preventDefault();
		}
		if (evt.key === 'Backspace' && multiple && !prevInput && !elValue && chips.length) {
			focusChip(chips.length - 1);
		}
		if (evt.key === ',' && multiple) {
			addChips(
				elValue
					.split(/,/g)
					.map((v: string) => v.trim())
					.filter(Boolean),
			);
			elValue = '';
		}
	}

	/** Handles when text is pasted into the input field */
	function onInputPaste(evt: ClipboardEvent) {
		if (!evt?.clipboardData) return;
		const paste = evt.clipboardData.getData('text');
		if (!paste || typeof paste !== 'string') return;
		if (multiple) {
			evt.preventDefault();
			addChips(
				paste
					.split(/,/g)
					.map((v: string) => v.trim())
					.filter(Boolean),
			);
		}
		setTimeout(() => {
			onpaste && onpaste(value, evt);
		}, 0);
	}

	/** Handles when the picker input (like the color picker input) has a key pressed */
	function onInputPickerKeyUp(evt: KeyboardEvent | Event) {
		evt.preventDefault();
		if (('key' in evt && evt.key !== 'Enter') || !inputElement) return;
		const target = evt.target as HTMLElement;
		const element = target?.querySelector('input') || inputElement;
		if ('showPicker' in HTMLInputElement.prototype) {
			(element as HTMLInputElement).showPicker();
		} else {
			element.click();
		}
	}

	/** Called when a picker input element 'input' event fires - happens on every keypress */
	function onInputPickerInput(evt: Event) {
		const element = (evt.target as HTMLInputElement) || inputElement;
		if (!element) return;
		elValue = element.value;
		if (type === 'color' && !multiple && elValue) {
			updateValue(elValue);
		}
	}

	/** Called when a picker input element 'change' event fires - happens after a selection is made */
	function onInputPickerChange(evt: Event) {
		const element = (evt.target as HTMLInputElement) || inputElement;
		if (!element) return;
		if (type === 'time') {
			try {
				const [hours, minutes] = element.value.split(':').map((v: string) => +v);
				const time = Math.max(
					0,
					+min! || 0,
					Math.min(
						1000 * 60 * 60 * 24,
						+max! || Infinity,
						(hours * 60 + minutes) * 60 * 1000,
					),
				);
				element.value = convertFromValueToHtmlInputString(type, time);
			} catch (error) {}
		}
		elValue = element.value;
		if (multiple) addChips([elValue]);
		if (!multiple) updateValue(elValue);
	}

	/** Called when the focus withint the input container changes */
	function onInputFocusChange(isFocused: boolean) {
		focused = isFocused;
		if (disabled) return;
		autocompleteShown = focused && (options?.length || 0) > 0;
		if (isFocused && !touched) {
			touched = true;
			if (ontouch) ontouch();
		}
		if (!focused) {
			if (
				optionsMode === 'select' &&
				elValue &&
				options &&
				options[autocompleteIndex] &&
				!options.some((v) => isEqual(v, value))
			) {
				onAutocompleteClick(options[autocompleteIndex], autocompleteIndex);
			}
			if (multiple) {
				elValue = '';
				if (inputElement) inputElement.value = '';
			}
		}
	}

	/** Handles when a key is pressed down on a chip (only when 'multiple' is true) */
	function onChipsKeyDown(evt: KeyboardEvent) {
		if (!multiple || !browser || !document || !inputParentElement) return;
		if (document.activeElement !== inputParentElement) return;
		if (evt.key !== 'Tab') {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	/** Handles when a key is pressed up on a chip (only when 'multiple' is true) */
	function onChipsKeyUp(evt: KeyboardEvent) {
		if (!multiple || !browser || !document || !inputParentElement) return;
		if (document.activeElement !== inputParentElement) return;
		evt.preventDefault();
		evt.stopPropagation();
		const numChips = chips.length || 0;
		const index = Math.min(focusedChipIndex, chips.length - 1);
		if (evt.key === 'ArrowLeft' || evt.key === 'ArrowUp') {
			focusedChipIndex = (index - 1 + numChips) % numChips;
		} else if (evt.key === 'ArrowRight' || evt.key === 'ArrowDown') {
			focusedChipIndex = (index + 1) % numChips;
		} else if (evt.key === 'Backspace' || evt.key === 'Delete' || evt.key === 'Enter') {
			removeChip(index);
		}
	}

	/** Handles when an autocomplete item is clicked/selected */
	function onAutocompleteClick(item: InputTypeMap[InputType], index: number) {
		if (autocompleteIndex !== index) autocompleteIndex = index;
		autocompleteShown = false;
		if (item === 'new') {
			if (loading || !elValue.trim()) {
				return;
			}
			loading = true;
			return;
		}
		if (multiple) addChips([item]);
		if (!multiple) updateValue(item);
		tick().then(() => {
			if (onselect) onselect(value ?? item);
		});
	}

	/** Autoresizes the text area to fit the content */
	function resizeTextArea() {
		if (type !== 'textarea' || !inputElement) return;
		const styles = getComputedStyle(inputElement);
		const fontSize = parseInt(styles.fontSize);
		const lineHeight = parseInt(styles.lineHeight);
		const padding = parseInt(styles.paddingTop) + parseInt(styles.paddingBottom);
		const minSize = (TEXTAREA_MIN_LINES * lineHeight + padding) / fontSize;
		inputElement.style.height = `${minSize}em`;
		const scrollHeight = inputElement.scrollHeight / fontSize;
		inputElement.style.height = Math.max(minSize, scrollHeight) + 'em';
	}

	/** Determines the position of the autocomplete panel so that it fits on screen */
	let autocompletePositionDestroy = () => {};
	$effect(() => {
		if (browser && autocompleteElement && inputContainerElement) {
			let lastPosition: 'top' | 'bottom' | undefined = undefined;
			untrack(async () => {
				const { computePosition, autoUpdate, flip, size } = await import(
					'@floating-ui/dom'
				);
				if (!inputContainerElement || !autocompleteElement) return;
				autocompletePositionDestroy();
				autocompletePositionDestroy = autoUpdate(
					inputContainerElement,
					autocompleteElement,
					async () => {
						if (!inputContainerElement || !autocompleteElement || !autocompleteShown) {
							return;
						}
						let { placement, x, y } = await computePosition(
							inputContainerElement,
							autocompleteElement,
							{
								placement: 'bottom',
								strategy: 'fixed',
								middleware: [
									flip(),
									size({
										apply({ rects, elements }) {
											Object.assign(elements.floating.style, {
												width: `${rects.reference.width}px`,
											});
										},
									}),
								],
							},
						);
						const position = placement.startsWith('bottom') ? 'bottom' : 'top';
						if (position === 'top' && label && labelDisplay === 'floating') y -= 6;
						const currentY = parseFloat(autocompleteElement.style.top || '');
						const shouldAnimateOn = !lastPosition;
						const shouldAnimateFlip =
							lastPosition !== position && lastPosition && Math.abs(currentY - y) > 5;
						lastPosition = position;
						autocompleteElement.style.left = `${x}px`;
						autocompleteElement.style.top = `${y}px`;
						autocompleteElement.style.transformOrigin =
							position === 'bottom' ? 'top' : 'bottom';
						if (shouldAnimateOn) {
							const animation = autocompleteElement.animate(
								[
									{
										opacity: 1,
										transform: 'translateZ(0) scale(1)',
									},
								],
								{
									duration: 200,
									easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
									fill: 'forwards',
								},
							);
							await animation.finished.catch(() => undefined);
							try {
								animation.commitStyles();
								animation.cancel();
							} catch (error) {
								// ignore
							}
						}
						if (shouldAnimateFlip) {
							const animations = autocompleteElement.getAnimations();
							animations.forEach((animation) => {
								try {
									animation.commitStyles();
									animation.cancel();
								} catch (error) {
									// ignore
								}
							});
							const animation = autocompleteElement.animate(
								[
									{ transform: `translate3d(0px, ${Math.floor(currentY - y)}px, 0px)` },
									{ transform: 'translate3d(0px, 0px, 0px)' },
								],
								{
									duration: 200,
									easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
									fill: 'forwards',
								},
							);
							await animation.finished.catch(() => undefined);
							try {
								animation.commitStyles();
								animation.cancel();
							} catch (error) {
								// ignore
							}
						}
					},
				);
			});
		}
		return () => autocompletePositionDestroy();
	});

	function panelTransitionOut(element: HTMLElement) {
		return () => {
			return {
				duration: 80,
				easing: cubicOut,
				css: (t: number) => `transform: translateZ(0) scale(1, ${t * 0.75 + 0.25});`,
			};
		};
	}

	$effect.pre(() => {
		if (!autocompleteShown) return;
		let highestIndex = -1;
		document.querySelectorAll('[data-popover-index]').forEach((el) => {
			highestIndex = Math.max(
				highestIndex,
				+((el as HTMLElement).dataset.popoverIndex || '0'),
			);
		});
		popoverIndex = highestIndex + 1;
	});
</script>

<div
	class={['input', className].filter(Boolean).join(' ')}
	class:error={(canShowError && errorMessage) || error}
	class:dense
	class:outlined
	class:comfortable
	class:readonly
	class:disabled={disabled || !browser}
	use:focusWithin={{ onfocuswithin: (focused) => onInputFocusChange(focused) }}
	bind:this={inputContainerElement}
	use:autoAnimate={{ easing: 'cubic-bezier(0.25, 1, 0.5, 1)', start: 0.5 }}
	{style}>
	<div class="input-outer">
		<div class="input-inner" class:rounded class:has-label={hasLabel} class:loading>
			{#if prepend}
				<div class="prepend">{@render prepend()}</div>
			{/if}

			<div
				class="input-box"
				role="combobox"
				aria-expanded={autocompleteShown}
				aria-controls={id + '-autocomplete'}
				class:chips={multiple}
				class:has-chips={!!chips.length}
				bind:this={inputParentElement}
				tabindex={!!chips.length && !disabled && browser ? 0 : -1}
				data-autoanimate-ignore="transform,width"
				onkeydown={!!chips.length ? onChipsKeyDown : () => {}}
				onkeyup={!!chips.length ? onChipsKeyUp : () => {}}
				onblur={() => (focusedChipIndex = 0)}
				use:autoAnimate={{
					disableOnBlur: true,
					easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
				}}>
				{#if !!chips.length}
					{#each chips as chip, i (chip)}
						<button
							type="button"
							class="chip"
							role="row"
							disabled={disabled || !browser}
							class:active={Math.min(focusedChipIndex, chips.length - 1) === i}
							tabindex="-1"
							aria-label="Remove item {i + 1}"
							use:ripple
							onclick={() => removeChip(i)}>
							{#if chipsDisplay}
								{@render chipsDisplay(chip, i)}
							{:else if toDisplayString}
								<span>{toDisplayString(chip)}</span>
							{:else if type === 'color'}
								<figure style:background-color={chip}></figure>
								<span>{chip}</span>
							{:else if type === 'date' || type === 'datetime'}
								{@const date = new Date(chip)}
								<span>
									{date.toLocaleDateString(undefined, { dateStyle: 'medium' })}
									{#if type === 'datetime'}
										{date.toLocaleTimeString(undefined, { timeStyle: 'short' })}
									{/if}
								</span>
							{:else if type === 'time'}
								{@const date = new Date(chip)}
								<span>
									{date.toLocaleTimeString(undefined, {
										timeZone: 'UTC',
										timeStyle: 'short',
									})}
								</span>
							{:else if type === 'file'}
								<span use:truncateText={{ limit: 30 }}>{chip.name}</span>
							{:else if type === 'password'}
								<span>{new Array(chip.length).fill('*').join('')}</span>
							{:else}
								<span>{chip}</span>
							{/if}
							<CloseIcon />
						</button>
					{/each}
				{/if}

				{#if content}{@render content()}{/if}
				{#if type === 'textarea'}
					<!-- svelte-ignore element_invalid_self_closing_tag -->
					<textarea
						placeholder={labelText}
						bind:this={inputElement}
						aria-invalid={!valid}
						aria-describedby={id + '-error'}
						value={elValue}
						disabled={disabled || !browser}
						{id}
						{required}
						{readonly}
						{minlength}
						{maxlength}
						oninput={onInputChange}
						onblur={(e) => {
							onInputBlur();
							if (onblur) onblur(e);
						}}
						onkeydown={(e) => {
							onInputKeyDown(e);
							resizeTextArea();
							if (onkeydown) onkeydown(e);
						}}
						onkeyup={(e) => {
							onInputKeyUp(e);
							resizeTextArea();
							if (onkeyup) onkeyup(e);
						}}
						onpaste={onInputPaste}
						{onfocus}
						rows={TEXTAREA_MIN_LINES} />
				{:else}
					<input
						type={elType}
						placeholder={labelText}
						bind:this={inputElement}
						aria-invalid={!valid}
						aria-describedby={id + '-error'}
						data-autoanimate-ignore="all"
						value={elValue}
						disabled={disabled || !browser}
						{id}
						{required}
						{readonly}
						{minlength}
						{maxlength}
						autocomplete={autocomplete ? (autocomplete as FullAutoFill) : undefined}
						style:min-width={focused || !multiple ? null : '0px'}
						style:width={focused || !multiple ? null : '0px'}
						min={type === 'date' || type === 'datetime' || type === 'time'
							? toHtmlString
								? toHtmlString(min as any)
								: convertFromValueToHtmlInputString(type, min)
							: min}
						max={type === 'date' || type === 'datetime' || type === 'time'
							? toHtmlString
								? toHtmlString(max as any)
								: convertFromValueToHtmlInputString(type, max)
							: max}
						{step}
						{pattern}
						multiple={type === 'file' && multiple}
						accept={type === 'file' && accept ? accept.join(',') : undefined}
						oninput={onInputChange}
						{onfocus}
						onblur={(e) => {
							onInputBlur();
							if (onblur) onblur(e);
						}}
						onkeydown={(e) => {
							onInputKeyDown(e);
							if (onkeydown) onkeydown(e);
						}}
						onkeyup={(e) => {
							onInputKeyUp(e);
							resizeTextArea();
							if (onkeyup) onkeyup(e);
						}}
						onpaste={onInputPaste}
						onclick={() => {
							if (disabled || !browser) return;
							if (!autocompleteShown && (options?.length || 0) > 0 && multiple) {
								autocompleteShown = true;
							}
						}}
						oninvalid={(e) => {
							if (focused) e.preventDefault();
						}} />
				{/if}
				{#if hasLabel}
					<label
						for={id}
						bind:this={labelElement}
						data-autoanimate-ignore="transform,width">
						{#if children}
							{@render children()}
						{:else}
							{label}
						{/if}
						{#if tooltip}
							<div class="tooltip-icon" use:tooltipAction={tooltip}>
								<HelpIcon />
							</div>
						{/if}
					</label>
				{/if}
				{#if type === 'file'}
					<div class="file-picker">
						<span class="button">Choose File{multiple ? 's' : ''}</span>
						{#if !multiple}
							<span class="selection">
								{#if value && typeof value === 'object' && 'name' in value}
									{value.name}
								{:else}
									No file{multiple ? 's' : ''} selected
								{/if}
							</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if clearable && elValue !== ''}
				<button type="button" onclick={() => (value = undefined)} class="blank clear">
					<!-- Slot for the icon when `clearable` is true. -->
					{#if clearIcon}
						{@render clearIcon()}
					{:else}
						<CloseIcon />
					{/if}
				</button>
			{/if}

			<!-- Slot for append inside the input. -->
			{#if append}
				<div style="z-index: 2;">
					{@render append()}
				</div>
			{/if}

			<!-- The native date picker button -->
			{#if type === 'date' || type === 'datetime' || type === 'time'}
				<button type="button" class="picker" onkeyup={onInputPickerKeyUp}>
					{#if type === 'time'}<ClockIcon />{:else}<CalendarIcon />{/if}
					<input
						min={toHtmlString
							? toHtmlString(min as any)
							: convertFromValueToHtmlInputString(type, min)}
						max={toHtmlString
							? toHtmlString(max as any)
							: convertFromValueToHtmlInputString(type, max)}
						type={elType}
						disabled={disabled || !browser}
						tabindex="-1"
						value={elValue}
						onchange={onInputPickerChange}
						oninput={onInputPickerInput} />
				</button>
			{/if}

			<!-- The native color picker button/input -->
			{#if type === 'color'}
				<div class="picker">
					<input
						type="color"
						disabled={disabled || !browser}
						id={id + '-picker'}
						value={(toHtmlString
							? toHtmlString(elValue)
							: convertFromValueToHtmlInputString(type, elValue)) || '#000000'}
						onchange={onInputPickerChange}
						oninput={onInputPickerInput} />
					<label for={id + '-picker'} style:--color-input={elValue || 'black'}></label>
				</div>
			{/if}
		</div>
	</div>

	<!-- The helper text below the input field - to show hints and error messages -->
	{#if (maxlength && isFinite(maxlength)) || hint || (canShowError && errorMessage)}
		<div class="input-details">
			<span id={id + '-error'}>{errorMessage || hint || ''}</span>
			{#if maxlength && isFinite(maxlength) && elValue}
				<span class="counter">{elValue.length} / {maxlength}</span>
			{/if}
		</div>
	{/if}
</div>

<!-- The panel of autocomplete suggestions that shows when focused -->
{#if options}
	<Portal>
		{#if autocompleteShown}
			<div
				id={id + '-autocomplete'}
				class="autocomplete"
				role="listbox"
				data-popover-index={popoverIndex}
				style="opacity: 0; transform: translateZ(0) scale(1, 0);"
				bind:this={autocompleteElement}
				out:panelTransitionOut>
				{#each options as item, i (item)}
					<div
						class="autocomplete-item"
						role="option"
						tabindex="-1"
						use:ripple
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => onAutocompleteClick(item, i)}
						onkeyup={() => {}}
						aria-selected={autocompleteIndex === i}
						class:active={autocompleteIndex === i}>
						{#if optionsDisplay}
							{@render optionsDisplay(item, i)}
						{:else if toDisplayString}
							{toDisplayString(item)}
						{:else if type === 'date' || type === 'datetime'}
							{@const date = new Date(item)}
							{date.toLocaleDateString(undefined, { dateStyle: 'medium' })}
							{#if type === 'datetime'}
								{date.toLocaleTimeString(undefined, { timeStyle: 'short' })}
							{/if}
						{:else if type === 'time'}
							{@const date = new Date(item)}
							{date.toLocaleTimeString(undefined, {
								timeZone: 'UTC',
								timeStyle: 'short',
							})}
						{:else}
							{item}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</Portal>
{/if}

<style lang="scss">
	$label-font-size: 0.8em;
	$label-margin: 0.4em;

	/** The outer most container */
	.input {
		flex: 1 1 auto;
		font-size: 1em;
		letter-spacing: normal;
		max-width: 100%;
		text-align: left;
		--height: 3.5em;

		&.dense {
			--height: 2.5em;
			input,
			textarea {
				padding: 0.25em 0.75em;
			}
		}
		&.comfortable {
			--height: 4em;
			input,
			textarea {
				padding: 0 1.5em;
			}
		}

		input,
		textarea {
			color: var(--c-text);

			&:invalid {
				box-shadow: none;
			}

			&:focus,
			&:active {
				outline: none;
			}
			&::placeholder {
				color: transparent;
			}
		}

		&.disabled {
			cursor: not-allowed;
			color: var(--c-text-disabled);

			input,
			textarea {
				cursor: not-allowed;
				color: var(--c-text-disabled);
			}

			label {
				cursor: not-allowed;
				color: var(--c-text-disabled);
			}
		}

		&.input-inner.has-label {
			input,
			textarea {
				&::placeholder {
					color: transparent;
				}
			}
		}

		&:not(.outlined) {
			input,
			textarea {
				&::placeholder {
					color: var(--c-text-disabled);
				}
			}
			.input-inner {
				&::before {
					display: none;
				}
			}
			.input-box {
				> label {
					border: none !important;
					&::before,
					&::after {
						border: none !important;
					}
				}
			}
		}
	}

	/** The parent of the .input-inner div - used for flex */
	.input-outer {
		border-radius: inherit;
		align-items: center;
		color: inherit;
		display: flex;
		position: relative;
		width: 100%;
		margin-bottom: $label-margin;
		z-index: 1;
	}

	/** Information below the main input field */
	.input-details {
		color: var(--c-text-disabled);
		display: flex;
		justify-content: space-between;
		flex: 1 0 auto;
		max-width: 100%;
		font-size: 0.75em;
		overflow: hidden;
		margin-top: -$label-margin;
		margin-bottom: $label-margin;

		span {
			flex-grow: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			padding: 0.25em 0.5em 0;
		}
		.counter {
			flex-grow: 0;
			flex-shrink: 0;
		}
	}

	/** The div containing the input, prepend, append elements*/
	.input-inner {
		width: 100%;
		color: inherit;
		caret-color: currentColor;
		display: flex;
		align-items: center;
		min-height: calc(var(--height) + $label-margin);
		border-radius: var(--radius);

		> :global(*) {
			margin-top: $label-margin;
		}

		&.loading {
			--loading-size: 2rem;
			&:global(::after) {
				top: calc(50% - (var(--loading-size) / 2) + 0.2em);
				left: unset;
				right: 0.5rem;
			}
		}

		&.rounded {
			--radius: calc((var(--height) / 2) + #{$label-margin});
			.input-box > label {
				&::before {
					transition:
						border-color 0.1s,
						margin-right 0.2s,
						width 0.3s;
				}
				&::after {
					transition:
						border-color 0.1s,
						margin-right 0.2s,
						width 0.3s;
				}
			}
			&:focus-within:not(:hover) {
				.input-box > label {
					&::after,
					&::before {
						transition:
							border-color 0.2s,
							margin-right 0.2s,
							width 0.3s;
					}
				}
			}
		}

		&::before {
			border-radius: inherit;
			width: inherit;
			bottom: -1px;
			content: '';
			left: 0;
			position: absolute;
			pointer-events: none;
			border-color: var(--c-outline);
			border-style: solid;
			top: $label-margin;
			border-width: 1px;
			box-sizing: border-box;
			transition: border-color 0.1s;
		}

		& > {
			.prepend {
				min-width: 3em;
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.prepend ~ .input-box {
				> input:not(:focus):placeholder-shown + label::before,
				> textarea:not(:focus):placeholder-shown + label::before {
					width: 3em;
					transition:
						margin-right 0.2s cubic-bezier(0, 0.54, 0.47, 1),
						width 0.2s cubic-bezier(0, 0.54, 0.47, 1);
				}
			}
			:global([slot='append']) {
				min-width: 3em;
				display: flex;
				align-items: center;
				justify-content: center;
			}
		}
	}

	/** Change the colors of the input when hovered or errored */
	.input-inner:hover {
		.input-box > label {
			color: currentColor;
		}
		&::before {
			border-color: currentColor;
		}
		&.has-label {
			&::before {
				border-top-color: transparent;
			}
			label {
				border-color: currentColor;
			}
		}
		input:not(:placeholder-shown) + label,
		textarea:not(:placeholder-shown) + label,
		.input-box.has-chips > label {
			&::before,
			&::after {
				border-top-color: currentColor;
			}
		}
	}
	.input.error {
		color: var(--c-error);
		--c-outline: var(--c-error);
		--c-text-disabled: var(--c-error);
		.input-inner:hover,
		&:focus-within {
			color: var(--c-error-active);
		}
		.input-inner:hover,
		&:focus-within .input-inner {
			&::before {
				border-color: var(--c-error-active);
			}
			&.has-label {
				&::before {
					border-top-color: transparent;
				}
			}
		}
	}

	/** The element that contains the input/label elements */
	.input-box {
		display: flex;
		flex-grow: 1;
		flex-wrap: wrap;
		overflow: hidden;
		position: inherit !important; // overwrite the autoAnimate 'position: relative' styles
		align-items: center;
		z-index: 1;

		// Animate the label when the input is focused (but only when the input is empty)
		&:not(.has-chips) {
			> input:placeholder-shown,
			> textarea:placeholder-shown {
				+ label {
					transition:
						border-color 0.1s,
						color 0.1s,
						top 0.2s cubic-bezier(0, 0.54, 0.47, 1),
						font-size 0.2s,
						line-height 0.2s;
					&::before {
						transition:
							border-color 0.1s,
							margin-right 0.2s,
							width 0.3s;
					}
				}
			}
		}

		> label {
			position: absolute;
			text-overflow: ellipsis;
			transform-origin: top left;
			top: $label-margin;
			left: 0;
			display: flex;
			width: 100%;
			min-height: calc(100% - $label-margin);
			max-height: 100%;
			max-width: 100%;
			line-height: calc(var(--height) - ($label-margin / 2));
			height: auto;
			padding: 0;
			transform: none;
			cursor: text;
			overflow: visible;
			font-size: 1em;
			border-top: solid 1px var(--c-outline);
			border-radius: var(--radius);
			color: var(--c-text-disabled);
			.tooltip-icon {
				line-height: 0px;
				margin: -0.5em 0 0 0.5em;
				cursor: default;
				display: none;
			}
			&::before,
			&::after {
				content: '';
				display: block;
				box-sizing: border-box;
				min-width: max(var(--radius), 1em);
				width: 0;
				height: var(--radius);
				pointer-events: none;
				border-top: solid 1px transparent;
				margin-top: 0.1em;
			}
			&::before {
				margin-right: 0;
				border-radius: var(--radius) 0;
				border-left: solid 1px transparent;
				border-bottom: solid 1px transparent;
			}
			&::after {
				flex-grow: 1;
				margin-left: 4px;
				border-radius: 0 var(--radius);
				border-right: solid 1px transparent;
				border-bottom: solid 1px transparent;
			}
		}

		input,
		textarea {
			caret-color: inherit;
			flex: 1 1 auto;
			line-height: 1em;
			padding: 0 0 0 1em;
			max-width: 100%;
			min-width: 0;
			width: 100%;
			background-color: transparent;
			border-style: none;
			box-shadow: none;
			z-index: 1;
		}
		textarea {
			padding: 1em;
			line-height: 1.5em;
			overflow-x: hidden;
			overflow-y: auto;
		}
		> input[type='date'],
		> input[type='datetime-local'],
		> input[type='time'] {
			&::-webkit-calendar-picker-indicator {
				display: none;
				opacity: 0;
			}
		}
	}
	.prepend + .input-box {
		input,
		textarea {
			padding-left: 0;
		}
	}

	/** Overwrites for the input label positioning and the active state of the input */
	.input-inner {
		&.has-label {
			&:focus-within::before,
			&:before {
				border-top-color: transparent;
			}
		}

		&:focus-within {
			&::after {
				transform: scale(1);
			}
			&::before {
				border-color: currentColor;
				border-width: 2px;
			}
			.input-box > label {
				color: inherit;
				// top: calc($label-margin + 2px);
			}
			.input-box {
				&:not(.has-chips) > input:not(:focus):placeholder-shown,
				&:not(.has-chips) > textarea:not(:focus):placeholder-shown {
					+ label {
						// The input is empty (so the placeholder text is in the down position) and a picker button is focused
						border-top: solid 2px currentColor;
					}
				}
				> input:focus,
				> textarea:focus,
				> input:not(:placeholder-shown),
				> textarea:not(:placeholder-shown) {
					+ label {
						// The top border when the input is focused and there is placeholder text
						&::after,
						&::before {
							border-top: solid 2px currentColor;
						}
					}
				}
				&.has-chips > input,
				&.has-chips > textarea {
					+ label {
						border-top-color: transparent;
						&::after,
						&::before {
							border-top: solid 2px currentColor;
						}
					}
				}
			}
		}
	}
	.input-box {
		input:not(:placeholder-shown) + label,
		textarea:not(:placeholder-shown) + label,
		&.has-chips > label {
			&::before,
			&::after {
				// The top border when there is a value in the input and the input is not focused
				// The placeholder text shows up at the top
				border-top: solid 1px var(--c-outline);
			}
		}
		input:focus + label,
		textarea:focus + label,
		input:not(:placeholder-shown) + label,
		textarea:not(:placeholder-shown) + label,
		&.has-chips > label {
			line-height: 0px !important;
			font-size: $label-font-size;
			border-top: transparent;
			.tooltip-icon {
				@media (min-width: 768px) {
					display: inline-block;
				}
			}
			&::before {
				margin-right: 4px;
			}
		}
	}

	button.clear {
		z-index: 1;
		min-height: var(--height);
		min-width: var(--height);
	}

	/** The container for the button that launches the browser native input picker (like color/date/etc) */
	.picker {
		z-index: 1;
		flex-shrink: 0;
		margin-left: 0.1em;
		margin-right: 0.1em;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1 / 1;
		min-height: var(--height);
		position: relative;
		color: inherit;

		input {
			position: absolute;
			left: 0;
			right: 0;
			width: 100%;
			min-height: var(--height);
			opacity: 0;
			cursor: pointer;
			outline: none;
			border: none;
			&[type='color'] + label {
				border: none;
				outline: none;
				padding: 10px;
				width: 100%;
				height: 100%;
				border-radius: var(--radius-round);
				&::after {
					content: '';
					background-color: var(--color-input, 'black');
					border-radius: var(--radius-round);
					display: block;
					width: 100%;
					height: 100%;
					outline: solid 1px currentColor;
				}
			}
			&[type='color']:hover,
			&[type='color']:focus {
				+ label {
					outline: solid 2px currentColor;
					outline-offset: -8px;
				}
			}
			&::-webkit-calendar-picker-indicator {
				position: absolute;
				left: 0;
				right: 0;
				width: 100%;
				height: 100%;
				margin: 0;
				padding: 0;
				cursor: pointer;
			}
		}
	}
	button.picker {
		background-color: transparent;
		color: inherit;
		border-radius: 0;
		position: relative;
		border: none;
		outline: none;
		box-shadow: none;
		&::after {
			content: '';
			background-color: var(--c-bg);
			width: calc(100% - #{$label-font-size});
			height: calc(100% - #{$label-font-size});
			position: absolute;
			top: 0.4em;
			left: 0.4em;
			z-index: -1;
			pointer-events: none;
			border-radius: 100%;
			border: solid 1px transparent;
			opacity: 0;
		}
		&:focus,
		&:hover {
			&::after {
				opacity: 1;
			}
		}
		&:focus-visible {
			&::after {
				opacity: 1;
				border-color: currentColor;
			}
		}
	}

	/** The styles for the 'chips' (selected items if 'multiple' is true) */
	.input-box {
		&.chips {
			gap: 0.5em;
			padding: calc(1em + 1px);
			padding-top: calc(1em + $label-margin + 1px);
			margin: 0;
			&:focus,
			&:focus-visible {
				outline: none;
				border: none;
				box-shadow: none;
			}
			&:focus-visible {
				.chip.active {
					background-color: var(--c-bg-4);
					color: var(--c-text-active);
				}
			}
			input,
			textarea {
				width: 11em;
				max-width: 100%;
				min-width: 25%;
				flex-grow: 1;
				padding-left: 0;
			}
			&.has-chips:focus-within {
				input,
				textarea {
					&::placeholder {
						color: var(--c-text-disabled);
					}
				}
			}
		}
		.chip {
			position: relative;
			display: flex;
			align-items: center;
			background-color: var(--c-bg-3);
			border-radius: var(--radius-round);
			color: var(--c-text);
			border: none;
			outline: none;
			padding: 0.25em 0.5em 0.25em 1em;
			font-size: 0.875em;
			max-width: 100%;
			z-index: 2;
			height: 2em;
			transition: background-color 100ms;
			cursor: pointer;

			figure {
				height: 2em;
				width: 2em;
				display: block;
				border-radius: 100%;
				margin-left: -1em;
				margin-right: 0.25em;
				border: solid 1px var(--c-bg-2);
			}

			span {
				flex: 1;
				text-overflow: ellipsis;
				overflow: hidden;
				white-space: nowrap;
				margin-right: 0.5em;
			}
			&:disabled {
				opacity: 0.75;
				cursor: not-allowed;
			}
			&:not(:disabled):hover {
				background-color: var(--c-bg-4);
				color: var(--c-text-active);
			}
		}
	}
	.input.dense {
		.input-box.chips {
			padding: 0.5em 1em 0.5em;
			padding-top: calc(0.75em + $label-margin);
			gap: 0.5em;
			input,
			textarea {
				padding: 0;
			}
			.chip {
				padding: 0.15em 0.25em 0.15em 0.5em;
				height: 1.75em;
				span {
					margin-right: 0.25em;
				}
			}
		}
	}

	/** The styles of the button for when the input is a file input */
	.file-picker {
		display: flex;
		align-items: center;
		.button {
			display: block;
			border-radius: var(--radius);
			background-color: var(--c-action);
			color: var(--c-action-text);
			outline: none;
			border: none;
			margin: 0 1em;
			padding: 0.25em 0.5em;
			font-size: 0.9em;
			&:hover {
				background-color: var(--c-action);
				color: var(--c-action-text-active);
			}
		}
	}
	.input-box.chips {
		.file-picker {
			.button {
				margin: 0;
			}
		}
	}
	input[type='file'] {
		opacity: 0;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		cursor: pointer;
		+ label {
			cursor: pointer;
		}
		&:hover,
		&:focus {
			~ .file-picker {
				.button {
					background-color: var(--c-action);
					color: var(--c-action-text-active);
				}
			}
		}
	}

	.autocomplete {
		--radius: var(--radius-4);
		--border-inset: 6px;
		position: fixed;
		z-index: var(--layer-5);
		background-color: var(--c-bg-0);
		color: var(--c-text);
		border-radius: var(--radius);
		overflow-x: hidden;
		overflow-y: auto;
		box-shadow: var(--shadow-2);
		max-height: calc((3.5em * 5) + 16px);
		scrollbar-color: var(--c-bg-1) transparent;
		scrollbar-width: thin;
		margin: 2px 0;
		&::-webkit-scrollbar {
			width: 0.5rem;
		}
		&::-webkit-scrollbar-track {
			box-shadow: none;
			background-color: transparent;
		}
		&::-webkit-scrollbar-track-piece:start {
			margin-top: var(--radius);
		}
		&::-webkit-scrollbar-track-piece:end {
			margin-bottom: var(--radius);
		}
		&::-webkit-scrollbar-thumb {
			background-color: var(--c-action);
			border-radius: 9999px;
			min-height: 2rem;
			&:hover {
				background-color: var(--c-action-active);
				cursor: pointer;
			}
		}

		.autocomplete-item {
			display: flex;
			align-items: center;
			position: relative;
			cursor: pointer;
			height: 3.5em;
			padding: 1.5em;
			z-index: 1;
			:global(> .ripple) {
				inset: 2px var(--border-inset) !important;
				border-radius: calc(var(--radius) - var(--border-inset)) !important;
			}
			&:first-child {
				padding-top: calc(var(--border-inset, 0px) + 1.5em - 2px);
				&::before {
					top: var(--border-inset);
				}
				:global(> .ripple) {
					top: var(--border-inset) !important;
				}
			}
			&:last-child {
				padding-bottom: calc(var(--border-inset, 0px) + 1.5em - 2px);
				&::before {
					bottom: var(--border-inset);
				}
				:global(> .ripple) {
					bottom: var(--border-inset) !important;
				}
			}
			&::before {
				display: block;
				position: absolute;
				top: 2px;
				bottom: 2px;
				left: var(--border-inset);
				right: var(--border-inset);
				border-radius: calc(var(--radius) - var(--border-inset));
				background-color: var(--c-bg-1);
				z-index: -1;
			}
			&:hover,
			&.active {
				color: var(--c-text-active);
				&::before {
					content: '';
				}
			}
			&:hover {
				transition:
					background-color 100ms,
					color 100ms;
			}
			:global(small) {
				color: var(--c-text-disabled);
				font-size: var(--font-size-0);
				margin-left: 0.5em;
				display: inline-block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			:global(strong) {
				font-weight: bold;
			}
			:global(p) {
				flex-shrink: 0;
			}
		}
	}
</style>
