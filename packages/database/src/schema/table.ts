import type {
	AnySearchSchema,
	IndexedDocument,
	SearchableType,
	SearchQuery as CoreSearchQuery,
	SearchQueryResults as CoreSearchQueryResults,
} from '../search/core/types';
import { DelightError } from '@delightstack/utilities';
import type {
	AddQuestionMarks,
	ArrayField,
	DatabaseField,
	FieldType,
	Flatten,
	FormFieldProps,
	FormStandardSchema,
	GenericFormFieldProps,
	HasPrimaryKeyField,
	IndexFieldType,
	IsDerived,
	IsForeignKey,
	IsIndexable,
	IsOptional,
	IsPrimaryKey,
	IsReadOnly,
	IsSearchable,
	IsSortable,
	IsUnique,
	OmitNeverProperties,
	SqliteForeignKeyAction,
} from './field-types';
import { DatabaseGenerator, type FieldGenerator } from './generators';

/**
 * TODO:
 * - Add support for 'currency' fields which would have a separate function db.currency()
 *   - It would save the value in the format `<amount><currency_code>` (like '19.99USD')
 *   - This allows for easy sorting and searching by amount, while still storing the currency code
 *   - It is also easy to parse out the amount and currency code when displaying the value
 */

/* -------------------------------------------------------------------------- */
/* Runtime helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Converts a field name into a human-readable Title Case label
 * ('first_name' → 'First Name'). Labels are titles, so every word is
 * capitalized — if a humanized string is ever needed for sentence-style text
 * (like a placeholder or description), only capitalize the first word.
 */
function humanizeFieldName(name: string): string {
	const last = name.split('.').pop() ?? name;
	const words = last
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim();
	if (!words) return name;
	return words
		.split(' ')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

/**
 * Reads a (possibly dot-notation) field name from form data. Flat keys win
 * ('address.city' as a literal key), then the nested path is walked — so the
 * same form schema validates both flat Form data records and nested entity
 * values.
 */
function getFormValueAtPath(data: Record<string, unknown>, name: string): unknown {
	if (name in data) return data[name];
	if (!name.includes('.')) return undefined;
	let current: unknown = data;
	for (const part of name.split('.')) {
		if (!current || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/** Coerces a timestamp value to an epoch number (ms). Accepts numbers, ISO strings, or Date objects. */
function toEpoch(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return new Date(value).getTime();
	if (value instanceof Date) return value.getTime();
	return 0;
}

/**
 * Recursively builds the search schema for a field, pushing any searchable /
 * sortable (dot-notation) paths it finds into the provided arrays.
 */
function recursivelyBuildSearchSchema(
	subfield: DatabaseField,
	path: string,
	force_searchable: boolean,
	searchable_fields: string[],
	sortable_fields: string[],
): AnySearchSchema | SearchableType | undefined {
	if (subfield.type === 'object') {
		const child = Object.entries(subfield.properties).reduce(
			(acc, [childFieldName, childFieldDef]) => {
				const childField = (childFieldDef as any)?.['_'] as DatabaseField;
				if (!childField) return acc;
				const childSchema = recursivelyBuildSearchSchema(
					childField,
					[path, childFieldName].filter(Boolean).join('.'),
					force_searchable || ('searchable' in childField && !!childField.searchable),
					searchable_fields,
					sortable_fields,
				);
				if (!childSchema) return acc;
				acc[childFieldName] = childSchema;
				return acc;
			},
			{} as Record<string, AnySearchSchema | SearchableType>,
		);
		if (Object.keys(child).length === 0) return undefined;
		return child;
	}

	if (subfield.type === 'array') {
		if ((!subfield.searchable && !force_searchable) || !('items' in subfield)) return;
		const itemType = subfield.items._;
		let arrayType: SearchableType | undefined;
		if (itemType.type === 'string') {
			arrayType = 'string[]';
		} else if (itemType.type === 'number') {
			arrayType = 'number[]';
		} else if (itemType.type === 'boolean') {
			arrayType = 'boolean[]';
		} else if (itemType.type === 'enum') {
			arrayType = 'enum[]';
		}
		if (!arrayType) return;
		// The field must be listed in searchable_fields or toSparse() will
		// never copy it into the indexed document
		if (path) searchable_fields.push(path);
		return arrayType;
	}

	if (!subfield.searchable && !force_searchable) return;
	if (path) searchable_fields.push(path);
	if ('sortable' in subfield && subfield.sortable) {
		sortable_fields.push(path);
	}
	if (subfield.type === 'boolean') return 'boolean';
	if (subfield.type === 'number') return 'number';
	if (subfield.type === 'geopoint') return 'geopoint';
	if (subfield.type === 'vector') return `vector[${subfield.dimensions}]`;
	if (subfield.type === 'enum') return 'enum';
	if (subfield.type === 'string') return 'string';
	if (subfield.type === 'foreign_key') {
		return subfield.foreign_key.type === 'number' ? 'number' : 'string';
	}
	if (subfield.type === 'primary_key') {
		return subfield.primary_key.type === 'number' ? 'number' : 'string';
	}
	return;
}

/**
 * Recursively builds the form field props for a field, writing the props for
 * each (dot-notation) editable field path into `form_field`.
 */
function recursivelyBuildFormFieldProps(
	subfield: DatabaseField,
	path: string,
	inherited: {
		optional?: boolean;
		readonly?: boolean;
		array?: ArrayField<any>;
	},
	form_field: Record<string, GenericFormFieldProps>,
): void {
	if (subfield.type === 'object') {
		for (const [childFieldName, childFieldDef] of Object.entries(subfield.properties)) {
			const childField = (childFieldDef as any)?.['_'] as DatabaseField;
			if (!childField) continue;
			recursivelyBuildFormFieldProps(
				childField,
				[path, childFieldName].filter(Boolean).join('.'),
				{
					optional: inherited.optional || !!subfield.optional,
					readonly: inherited.readonly || !!subfield.readonly,
				},
				form_field,
			);
		}
		return;
	}
	if (subfield.type === 'array') {
		if (subfield.items && subfield.items._) {
			const itemField = subfield.items._ as DatabaseField;
			recursivelyBuildFormFieldProps(
				itemField,
				path,
				{
					optional: inherited.optional,
					readonly: inherited.readonly,
					array: subfield,
				},
				form_field,
			);
		}
		return;
	}
	if (
		subfield.type !== 'string' &&
		subfield.type !== 'number' &&
		subfield.type !== 'boolean' &&
		subfield.type !== 'enum'
	) {
		return;
	}

	// For array items, the field-level flags (required/readonly/label/placeholder/
	// helper) come from the ARRAY field itself - the item field only provides the
	// value-level props (type, minlength, options, ...)
	const flag_field: DatabaseField = inherited.array ?? subfield;
	const is_multiple = !!inherited.array;
	const label: string =
		('label' in flag_field && (flag_field as any).label) || humanizeFieldName(path);
	const has_default = 'has_default' in flag_field && !!(flag_field as any).has_default;
	const required =
		!inherited.optional &&
		!('optional' in flag_field && flag_field.optional) &&
		!has_default;

	/** The field's .default() value, resolved from the field's validator */
	function schemaDefault(): unknown {
		if (!has_default || !('schema' in subfield) || !subfield.schema) {
			return undefined;
		}
		const result = subfield.schema.safeParse(undefined);
		return result.success ? result.data : undefined;
	}
	const readonly = inherited.readonly || flag_field.readonly;

	function parseSingleValue(value: unknown): unknown {
		if ('schema' in subfield && subfield.schema) {
			try {
				return subfield.schema.parse(value);
			} catch (error) {
				throw DelightError.badRequest(DelightError.from(error).message);
			}
		}
		return value;
	}

	const field_props: GenericFormFieldProps = {
		name: path,
		type: 'text',
		readonly,
		required,
		label,
		placeholder:
			'placeholder' in flag_field ? (flag_field as any).placeholder : undefined,
		description:
			'description' in flag_field ? (flag_field as any).description : undefined,
		parse: (value) => {
			// Treat empty input ('', null, undefined, empty array) as "not provided"
			const is_empty =
				value === undefined ||
				value === null ||
				value === '' ||
				(is_multiple && Array.isArray(value) && value.length === 0);
			if (is_empty) {
				if (required) throw DelightError.badRequest(`${label} is required`);
				// Defaulted fields resolve empty input to their default, so the
				// saved draft matches what the table would store anyway
				const default_value = schemaDefault();
				if (default_value !== undefined) return default_value;
				return undefined;
			}
			if (is_multiple) {
				const array_field = inherited.array!;
				const values = Array.isArray(value) ? value : [value];
				if (typeof array_field.min === 'number' && values.length < array_field.min) {
					throw DelightError.badRequest(
						`${label} must have at least ${array_field.min} item${array_field.min === 1 ? '' : 's'}`,
					);
				}
				if (typeof array_field.max === 'number' && values.length > array_field.max) {
					throw DelightError.badRequest(
						`${label} must have at most ${array_field.max} item${array_field.max === 1 ? '' : 's'}`,
					);
				}
				return values.map(parseSingleValue);
			}
			return parseSingleValue(value);
		},
	};
	if (is_multiple) field_props.multiple = true;
	if (subfield.type === 'string') {
		if ('minlength' in subfield && typeof subfield.minlength === 'number') {
			field_props.minlength = subfield.minlength;
		}
		if ('maxlength' in subfield && typeof subfield.maxlength === 'number') {
			field_props.maxlength = subfield.maxlength;
		}
		if ('pattern' in subfield && typeof subfield.pattern === 'string') {
			field_props.pattern = subfield.pattern;
		}
		if ('textarea' in subfield && subfield.textarea) {
			field_props.type = 'textarea';
		} else if ('format' in subfield && typeof subfield.format === 'string') {
			if (subfield.format === 'email') {
				field_props.type = 'email';
			} else if (subfield.format === 'url') {
				field_props.type = 'url';
			} else if (subfield.format === 'date') {
				field_props.type = 'date';
			} else if (subfield.format === 'datetime') {
				field_props.type = 'datetime-local';
			} else if (subfield.format === 'color') {
				field_props.type = 'color';
			} else if (subfield.format === 'password') {
				field_props.type = 'password';
			} else if (subfield.format === 'phone') {
				field_props.type = 'tel';
			} else if (subfield.format === 'time') {
				field_props.type = 'time';
			}
		}
	}
	if (subfield.type === 'number') {
		field_props.type = 'number';
		if ('min' in subfield && typeof subfield.min === 'number') {
			field_props.min = subfield.min;
		}
		if ('max' in subfield && typeof subfield.max === 'number') {
			field_props.max = subfield.max;
		}
		if ('step' in subfield && typeof subfield.step === 'number') {
			field_props.step = subfield.step;
		}
	}
	if (subfield.type === 'boolean') {
		field_props.type = 'boolean';
		if (has_default) {
			const default_value = schemaDefault();
			if (typeof default_value === 'boolean') {
				field_props.default_checked = default_value;
			}
		} else if (!required) {
			// Optional with no default: tri-state — null/undefined mean
			// "unanswered" and display as indeterminate
			field_props.tristate = true;
		}
	}
	if (subfield.type === 'enum') {
		field_props.options = subfield.options.map((option) => ({
			value: option,
			label: subfield.option_labels?.[option] ?? humanizeFieldName(option),
		}));
	}
	form_field[path] = field_props;
}

/**
 * Recursively parses & validates a single field's value, pushing any
 * validation problems into `issues` (and returning the parsed value).
 */
function recursivelyParseField(
	field: DatabaseField,
	value: any,
	path: string[],
	issues: Array<{ path: string[]; message: string }>,
): any {
	let label = path.join('.');
	if ('label' in field && (field as any).label) {
		label = (field as any).label;
	} else if ('placeholder' in field && (field as any).placeholder) {
		label = (field as any).placeholder;
	}
	if (value === undefined || value === null) {
		// Apply .default() declared on the field — the validator fills it in for
		// `undefined` input (an explicit null is an intentional clear and does
		// NOT receive the default)
		if (value === undefined && 'schema' in field && (field as any).schema) {
			try {
				const result = (field as any).schema.safeParse(undefined);
				if (result?.success && result.data !== undefined) return result.data;
			} catch {
				// fall through to the required-field check
			}
		}
		if (!('optional' in field && field.optional)) {
			issues.push({
				message: `Field '${label}' is required but was not provided.`,
				path,
			});
		}
		return;
	}

	// Recursively parse/validate object fields
	if (field.type === 'object') {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			issues.push({
				message: `Field '${label}' must be an object.`,
				path,
			});
			return;
		}
		const parsedObject: any = {};
		for (const [childFieldName, childFieldDef] of Object.entries(field.properties)) {
			const childField = (childFieldDef as any)?.['_'] as DatabaseField;
			if (!childField) continue;
			const childValue = value[childFieldName];
			parsedObject[childFieldName] = recursivelyParseField(
				childField,
				childValue,
				[...path, childFieldName],
				issues,
			);
		}
		return parsedObject;
	}

	// Recursively parse/validate array fields
	if (field.type === 'array') {
		if (!Array.isArray(value)) {
			issues.push({
				message: `Field '${label}' must be an array.`,
				path,
			});
			return;
		}
		if (!field.items || !field.items._) return value;
		const itemField = field.items._ as DatabaseField;
		// Length constraints belong to the ARRAY field itself — the item
		// field's min/max constrain each item's value and are enforced by
		// recursivelyParseField below
		let message = '';
		if (
			'min' in field &&
			typeof field.min === 'number' &&
			'max' in field &&
			typeof field.max === 'number'
		) {
			message = `Field '${label}' must have between ${field.min} and ${field.max} items.`;
		}
		if ('min' in field && typeof field.min === 'number') {
			if (value.length < field.min) {
				issues.push({
					message: message || `Field '${label}' must have at least ${field.min} items.`,
					path,
				});
			}
		}
		if ('max' in field && typeof field.max === 'number') {
			if (value.length > field.max) {
				issues.push({
					message: message || `Field '${label}' must have at most ${field.max} items.`,
					path,
				});
			}
		}
		return value.map((itemValue, index) =>
			recursivelyParseField(itemField, itemValue, [...path, `[${index}]`], issues),
		);
	}

	// Parse/validate geopoint fields (used for location based searching)
	if (field.type === 'geopoint') {
		const lat = Number(value?.lat);
		const lon = Number(value?.lon);
		if (isNaN(lat) || isNaN(lon)) {
			issues.push({
				message: `Field '${label}' must be a geopoint with valid 'lat' and 'lon' numbers.`,
				path,
			});
			return;
		}
		return {
			lat: Math.max(-90, Math.min(90, lat)),
			lon: Math.max(-180, Math.min(180, lon)),
		};
	}

	// Parse/validate boolean fields
	if (field.type === 'boolean') {
		if (value === 'true' || value === '1' || value === 1) return true;
		if (value === 'false' || value === '0' || value === 0) return false;
		if (typeof value !== 'boolean') {
			issues.push({
				message: `Field '${label}' must be a boolean.`,
				path,
			});
		}
		return value;
	}

	// Parse/validate enum fields
	if (field.type === 'enum') {
		if (typeof value !== 'string' || !field.options.includes(value)) {
			issues.push({
				message: `Field '${label}' must be one of the allowed options: ${field.options.join(
					', ',
				)}.`,
				path,
			});
			return;
		}
		return value;
	}

	// Parse/validate vector fields (used for vector search)
	if (field.type === 'vector') {
		if (!Array.isArray(value) || value.length !== field.dimensions) {
			issues.push({
				message: `Field '${label}' must be an array of numbers with length ${field.dimensions}.`,
				path,
			});
			return;
		}
		const parsedVector = value.map((v, i) => {
			const num = Number(v);
			if (isNaN(num)) {
				issues.push({
					message: `Field '${label}' has an invalid number at index ${i}.`,
					path,
				});
			}
			return num;
		});
		return parsedVector;
	}

	// Foreign key fields are either strings or numbers and have no validator
	if (field.type === 'foreign_key') {
		if (field.foreign_key.type === 'number') {
			const parsedNumber = Number(value);
			if (isNaN(parsedNumber)) {
				issues.push({
					message: `Field '${label}' must be a number.`,
					path,
				});
				return;
			}
			return parsedNumber;
		} else {
			return String(value);
		}
	}

	// Primary fields are either strings or numbers and have no validator
	if (field.type === 'primary_key') {
		if (field.primary_key.type === 'number') {
			const parsedNumber = Number(value);
			if (isNaN(parsedNumber)) {
				issues.push({
					message: `Field '${label}' must be a number.`,
					path,
				});
				return;
			}
			return parsedNumber;
		} else {
			return String(value);
		}
	}

	// Use the field validator if provided (this should be provided in most cases)
	if ('schema' in field && field.schema) {
		try {
			return field.schema.parse(value);
		} catch (err) {
			issues.push({
				message: `Field '${label}' is invalid: ${DelightError.from(err).message}`,
				path,
			});
			return;
		}
	}

	return value;
}

/* -------------------------------------------------------------------------- */
/* The Database namespace                                                     */
/* -------------------------------------------------------------------------- */

export namespace Database {
	/** Infer the shape of an entity stored in the database (created via the `table` function) */
	export type Entity<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = Flatten<
		AddQuestionMarks<
			OmitNeverProperties<
				{
					// Mark readonly fields as readonly in the resulting type (exclude derived fields)
					readonly [Key in keyof Table['_'] as IsDerived<Table['_'][Key]> extends true
						? never
						: IsReadOnly<Table['_'][Key]> extends true
							? Key
							: never]: FieldType<Table['_'][Key]> extends infer FieldTypeValue
						? IsOptional<Table['_'][Key]> extends true
							? FieldTypeValue | undefined | null
							: FieldTypeValue
						: never;
				} & {
					// Keep non-readonly fields as normal (exclude derived fields)
					[Key in keyof Table['_'] as IsDerived<Table['_'][Key]> extends true
						? never
						: IsReadOnly<Table['_'][Key]> extends true
							? never
							: Key]: FieldType<Table['_'][Key]> extends infer FieldTypeValue
						? IsOptional<Table['_'][Key]> extends true
							? FieldTypeValue | undefined | null
							: FieldTypeValue
						: never;
				}
			>
		> &
			// Auto-add 'id' primary key if no primary key is defined in the table schema
			(true extends HasPrimaryKeyField<Table['_']> ? {} : { readonly id: string }) & {
				// Auto-managed timestamp fields (set by the server on create/update)
				readonly created_at: number;
				readonly updated_at: number;
			}
	>;

	/** Infers the type of the schema the search engine indexes this table with */
	export type SearchSchema<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = Flatten<
		OmitNeverProperties<{
			[Key in keyof Table['_']]: IndexFieldType<Table['_'][Key]>;
		}> & {
			/** Timestamps are stored as epoch numbers in the search index */
			created_at: 'number';
			updated_at: 'number';
		}
	>;

	/** Infers the shape of the documents returned by the search library */
	export type SearchEntity<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		IndexSchemaConfig extends AnySearchSchema = SearchSchema<Table>,
		PrimaryKeyColumn extends keyof Table['_'] = {
			[Key in keyof Table['_']]: IsPrimaryKey<Table['_'][Key]> extends true ? Key : never;
		}[keyof Table['_']],
	> = Partial<IndexedDocument<IndexSchemaConfig>> & {
		[Key in PrimaryKeyColumn]: string;
	} & (true extends HasPrimaryKeyField<Table['_']> ? {} : { id: string }) & {
			created_at: number;
			updated_at: number;
		};

	/**
	 * A name of a field that is searchable in the database table.
	 * This includes all fields marked as 'searchable', as well as nested fields within objects.
	 * For nested fields, the path is represented using dot notation (e.g., 'address.city').
	 */
	export type SearchableField<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		ForceSearchable extends boolean = false,
	> = Table extends object
		? {
				[Key in keyof Table['_'] & string]: Table['_'][Key] extends {
					readonly _: {
						type: 'object';
						properties: infer Properties extends Record<string, FieldGenerator>;
					};
				}
					? SearchableField<
							{ readonly _: Properties },
							IsSearchable<Table['_'][Key]> extends true ? true : ForceSearchable
						> extends never
						? never
						: `${Key}.${SearchableField<{ readonly _: Properties }, IsSearchable<Table['_'][Key]> extends true ? true : ForceSearchable>}`
					: ForceSearchable extends true
						? Key
						: IsSearchable<Table['_'][Key]> extends true
							? Key
							: never;
			}[keyof Table['_'] & string]
		: never;

	/**
	 * A name of a field that is sortable in the database table.
	 * This includes all fields marked as 'sortable'
	 * For nested fields, the path is represented using dot notation (e.g., 'address.city').
	 */
	export type SortableField<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = Table extends object
		? {
				[Key in keyof Table['_'] & string]: Table['_'][Key] extends {
					readonly _: {
						type: 'object';
						properties: infer Properties extends Record<string, FieldGenerator>;
					};
				}
					? SortableField<{ readonly _: Properties }> extends never
						? never
						: `${Key}.${SortableField<{ readonly _: Properties }>}`
					: IsSortable<Table['_'][Key]> extends true
						? Key
						: never;
			}[keyof Table['_'] & string]
		: never;

	/**
	 * The type used to define the search query parameters for a database table
	 * This is the direct input of the `list`/`search` methods.
	 */
	export type SearchQuery<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		IndexSchemaConfig extends AnySearchSchema = SearchSchema<Table>,
	> = CoreSearchQuery<IndexSchemaConfig> & {
		/**
		 * Where this query is answered (client routing only; the server ignores
		 * it). `'auto'` (default) routes by coverage, `'server'` forces the
		 * server, `'client'` forces the local index even mid-backfill. Overrides
		 * the entity's `search_mode`. `'client'` cannot be combined with
		 * `vector` — vector search is server-only.
		 */
		source?: 'auto' | 'client' | 'server';
	};

	/**
	 * The type returned by the search query for a database table
	 * If the 'sparse' option in the query is false, the full Entity type is returned.
	 * If the 'sparse' option in the query is true, only the SearchEntity type is returned.
	 */
	export type SearchQueryResults<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		Query extends SearchQuery<Table> = {},
		Data extends Query['sparse'] extends false ? Entity<Table> : SearchEntity<Table> =
			Query['sparse'] extends false ? Entity<Table> : SearchEntity<Table>,
	> = Pick<CoreSearchQueryResults<Data>, 'count' | 'elapsed' | 'facets' | 'hits'> & {
		/**
		 * A cursor that can be used to fetch the next set of results.
		 * If this is null/undefined, there are no more results to fetch.
		 */
		cursor: string | null;
	};

	/**
	 * Infers the SQL shape of a database table (created via the `table` function).
	 * This differs from the Entity type since object and array fields are stored in the 'json' column as strings.
	 */
	export type SqlEntity<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = Flatten<
		OmitNeverProperties<{
			[Key in keyof Table['_'] | 'json' | 'created_at' | 'updated_at']: Key extends 'json'
				? string
				: Key extends 'created_at' | 'updated_at'
					? number
					: IsDerived<Table['_'][Key]> extends true
						? never
						: FieldType<Table['_'][Key]> extends infer FieldTypeValue
							? FieldTypeValue extends string | boolean | number
								? FieldTypeValue
								: never
							: never;
		}>
	>;

	/**
	 * The SQLite table definition for a database table (created via the `table`
	 * function): each column name mapped to its SQL column definition string.
	 * This is used to create or update the actual table columns in SQLite.
	 * @example { id: 'TEXT PRIMARY KEY', name: 'TEXT NOT NULL', age: 'INTEGER' }
	 */
	export type SqlTableConfig<
		_Table extends {
			readonly _: Record<string, FieldGenerator>;
		} = { readonly _: Record<string, FieldGenerator> },
	> = Record<string, string>;

	/** The type used to define the indexes for a database table (created via the `table` function) */
	export type SqlIndexes = Array<{
		/** The name of the index that will be created. @example 'idx_person_name' */
		name: string;
		/** The name of the table in sqlite that will be indexed */
		table: string;
		/**
		 * The list of columns (ordered) that the rows should be indexed by.
		 * This will always have at least one column (the main indexed column defined by .indexable()),
		 * but may have additional columns for covering indexes (by adding additional_columns in the indexable() options).
		 */
		columns: {
			/** The name of the column to be indexed */
			column: string;
			/** The direction of the items will be indexed. @default 'ASC' */
			direction: 'ASC' | 'DESC';
		}[];
		/** Whether the index should be unique (no duplicates) */
		unique: boolean;
	}>;

	/** The name of the primary-key field declared in a table config (never when auto-injected) */
	type PrimaryKeyColumnName<TableConfig extends Record<string, FieldGenerator>> = {
		[Key in keyof TableConfig & string]: IsPrimaryKey<TableConfig[Key]> extends true
			? Key
			: never;
	}[keyof TableConfig & string];

	/** The names of the fields declared indexable in a table config */
	type IndexableColumnName<TableConfig extends Record<string, FieldGenerator>> = {
		[Key in keyof TableConfig & string]: IsIndexable<TableConfig[Key]> extends true
			? Key
			: never;
	}[keyof TableConfig & string];

	/** The names of the fields declared unique in a table config */
	type UniqueColumnName<TableConfig extends Record<string, FieldGenerator>> = {
		[Key in keyof TableConfig & string]: IsUnique<TableConfig[Key]> extends true
			? Key
			: never;
	}[keyof TableConfig & string];

	/** The foreign-key config record computed from a table config */
	type ForeignKeysConfig<TableConfig extends Record<string, FieldGenerator>> = Flatten<
		OmitNeverProperties<{
			[Key in keyof TableConfig & string]: IsForeignKey<TableConfig[Key]> extends true
				? {
						type: 'string' | 'number';
						table: string;
						column: string;
						on_update?: SqliteForeignKeyAction | undefined;
						on_delete?: SqliteForeignKeyAction | undefined;
					}
				: never;
		}>
	>;

	/** The concrete instance type returned by `table()` for a specific table config */
	export interface TableInstance<
		TableName extends string,
		TableConfig extends Record<string, FieldGenerator>,
	> {
		/** @private A reference to the table's shape (used only for typescript types) */
		readonly _: TableConfig;

		/** The name of the table. Can only contain alphanumeric characters and underscores. */
		name: TableName;

		/**
		 * Parses & validates the given data against the table's shape
		 * @throws an error if the data is invalid
		 */
		parse(data: any): Entity<{ readonly _: TableConfig }>;

		/** Converts the given entity data to a sparse search entity used by the search index */
		toSparse(
			data: Entity<{ readonly _: TableConfig }>,
		): SearchEntity<{ readonly _: TableConfig }>;

		/** The form properties for the table used when editing a table record in an html form */
		form: {
			/** The form properties for each field that can be spread onto an html element for that field */
			field: FormFieldProps<TableConfig>;
			/**
			 * A Standard Schema (v1) validator over the table's form fields.
			 * Pass it to a Form component's `schema` prop to validate the whole form at once.
			 * The validated data is keyed by the same (dot-notation) names used in form.field.
			 */
			schema: FormStandardSchema;
		};

		/** The table's config used to setup sqlite and the search index */
		config: {
			/** The primary key for the table */
			primary_key: PrimaryKeyColumnName<TableConfig>;
			/** The type of the primary key ('string' for TEXT, 'number' for INTEGER) */
			primary_key_type: 'string' | 'number';
			/** The list of fields that will have indexes created in sqlite */
			indexable_fields: IndexableColumnName<TableConfig>[];
			/** The list of fields that must be unique */
			unique_fields: UniqueColumnName<TableConfig>[];
			/** The list of fields that cannot be changed after creation (enforced on update) */
			readonly_fields: string[];
			/** The list of fields that can be searched */
			searchable_fields: SearchableField<{ readonly _: TableConfig }>[];
			/** The list of fields that can be used for sorting results */
			sortable_fields: SortableField<{ readonly _: TableConfig }>[];
			/** A record of fields that are foreign keys and reference a different table */
			foreign_keys: ForeignKeysConfig<TableConfig>;
			/**
			 * The search schema for the table — every indexed field path mapped to
			 * its declared search type. If no searchable fields are defined, this
			 * will be an empty object.
			 */
			index_schema: AnySearchSchema;
			/**
			 * The SQLite table schema definition for the generated table.
			 * Fields of type 'object' or 'array' are omitted since they are stored in the 'json' column.
			 * @example { id: 'TEXT PRIMARY KEY', name: 'TEXT', age: 'INTEGER' }
			 */
			table_definition: Record<string, string>;
			/** The list of indexes to create for the table */
			indexes: SqlIndexes;
			/** A record of derived fields and their FK dependencies (for FK-aware reindexing) */
			derived_fields: Record<string, { foreign_keys?: string[] }>;
		};
	}

	/**
	 * A database table produced by `table()`.
	 *
	 * This is the widened shape every concrete table satisfies — use it as the
	 * generic constraint wherever a table of any shape is accepted. Concrete
	 * tables keep their narrow per-field types (via `TableInstance`), and
	 * TypeScript preserves those through generic inference against this
	 * constraint because every member here is a supertype of the instance's.
	 */
	export interface Table {
		readonly _: Record<string, FieldGenerator>;
		name: string;
		parse(data: any): Record<string, unknown>;
		toSparse(data: any): Record<string, unknown>;
		form: {
			field: Record<string, GenericFormFieldProps>;
			schema: FormStandardSchema;
		};
		config: {
			primary_key: string;
			primary_key_type: 'string' | 'number';
			indexable_fields: string[];
			unique_fields: string[];
			readonly_fields: string[];
			searchable_fields: string[];
			sortable_fields: string[];
			foreign_keys: Record<
				string,
				{
					type: 'string' | 'number';
					table: string;
					column: string;
					on_update?: SqliteForeignKeyAction | undefined;
					on_delete?: SqliteForeignKeyAction | undefined;
				}
			>;
			index_schema: AnySearchSchema;
			table_definition: Record<string, string>;
			indexes: SqlIndexes;
			derived_fields: Record<string, { foreign_keys?: string[] }>;
		};
	}

	/** @deprecated Use `Database.Table` — the two types are now identical. */
	export type AnyTable = Table;

	/**
	 * Field names that can never be table columns: `created_at`/`updated_at`
	 * are auto-managed, `and`/`or`/`not` are `where`-grammar composites (a
	 * field with one of those names would be unfilterable), and `$derived` is
	 * the reserved search sub-object of the `json` column.
	 */
	type ReservedFieldName =
		| 'created_at'
		| 'updated_at'
		| 'and'
		| 'or'
		| 'not'
		| '$derived';
	const RESERVED_FIELD_NAMES: readonly ReservedFieldName[] = [
		'created_at',
		'updated_at',
		'and',
		'or',
		'not',
		'$derived',
	];

	/** Defines a database table schema using the provided callback function */
	export function table<
		TableName extends string,
		TableConfig extends Record<string, FieldGenerator> & {
			[K in ReservedFieldName]?: never;
		},
	>(
		rawTableName: TableName,
		callback: (tableSchema: DatabaseGenerator) => TableConfig,
	): TableInstance<TableName, TableConfig> {
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawTableName)) {
			throw new DelightError({
				message:
					'Table name must only contain alphanumeric characters and underscores, and cannot start with a number',
				status: 400,
			});
		}
		const tableName: TableName = rawTableName;

		type Instance = TableInstance<TableName, TableConfig>;
		type InstanceEntity = Entity<{ readonly _: TableConfig }>;
		type InstanceSearchEntity = SearchEntity<{ readonly _: TableConfig }>;

		let primary_key: string | undefined;
		let primary_key_type: 'string' | 'number' = 'string';
		const indexable_fields: string[] = [];
		const unique_fields: string[] = [];
		const readonly_fields: string[] = [];
		const searchable_fields: string[] = [];
		const sortable_fields: string[] = [];
		const foreign_keys: Record<string, unknown> = {};
		const derived_fields: Record<string, { foreign_keys?: string[] }> = {};
		const indexes: SqlIndexes = [];
		const form_field: Record<string, GenericFormFieldProps> = {};
		const table_definition: Record<string, string> = {};
		const index_schema: AnySearchSchema = {};

		const generator = new DatabaseGenerator();
		const table_config = callback(generator);

		if (
			typeof table_config !== 'object' ||
			!table_config ||
			!Object.keys(table_config).length ||
			Array.isArray(table_config)
		) {
			throw new Error('Table schema callback must return a non-empty object');
		}

		// Validate reserved field names (also a compile-time error via the
		// `[K in ReservedFieldName]?: never` constraint on TableConfig)
		for (const reserved of RESERVED_FIELD_NAMES) {
			if (!(reserved in table_config)) continue;
			const reason =
				reserved === 'created_at' || reserved === 'updated_at'
					? 'auto-managed by the database'
					: reserved === '$derived'
						? 'reserved for derived search values'
						: 'a reserved word in the where-clause grammar';
			throw new DelightError({
				message: `'${reserved}' is a reserved field name (${reason}). Rename it in your table schema.`,
				status: 400,
			});
		}

		// Auto-inject 'id' primary key if none is defined
		const has_explicit_primary_key = Object.values(table_config).some(
			(f: any) => f?.['_']?.type === 'primary_key',
		);
		if (!has_explicit_primary_key) {
			(table_config as any)['id'] = generator.primaryKey();
		}

		// Collect primary key, indexable fields, etc.
		for (const [fieldName, fieldDef] of Object.entries(table_config)) {
			if (!fieldDef['_']) {
				throw new Error(
					`Field '${fieldName}' is not a valid field definition. Did you forget to call a field generator method?`,
				);
			}
			const field = fieldDef['_'] as DatabaseField;

			// Handle primary key field
			if (field.type === 'primary_key') {
				if (primary_key) {
					throw new Error(
						`Table can only have one primary key defined. Fields ${fieldName} and ${primary_key} are both defined as primary keys.`,
					);
				}
				primary_key = fieldName;
				primary_key_type = field.primary_key.type;
				table_definition[fieldName] =
					field.primary_key.type === 'string'
						? 'TEXT PRIMARY KEY'
						: 'INTEGER PRIMARY KEY AUTOINCREMENT';
				index_schema[fieldName] =
					field.primary_key.type === 'number' ? 'number' : 'string';
				searchable_fields.push(fieldName);
				if ('sortable' in field && field.sortable) {
					sortable_fields.push(fieldName);
				}
				continue;
			}

			// Derived fields: search-only, skip SQLite column/indexes/form but build the search schema
			// derived() always marks the field as searchable
			if ('derived' in field && (field as any).derived) {
				searchable_fields.push(fieldName);
				if ('sortable' in field && field.sortable) {
					sortable_fields.push(fieldName);
				}
				let derived_type: string | undefined;
				if (field.type === 'string') derived_type = 'string';
				else if (field.type === 'number') derived_type = 'number';
				else if (field.type === 'boolean') derived_type = 'boolean';
				else if (field.type === 'enum') derived_type = 'enum';
				if (derived_type) index_schema[fieldName] = derived_type as SearchableType;
				// Store FK dependency metadata for cross-table derived fields
				const fk_deps = (field as any).derived_foreign_keys;
				if (Array.isArray(fk_deps) && fk_deps.length > 0) {
					derived_fields[fieldName] = { foreign_keys: fk_deps };
				}
				continue;
			}

			// Build the indexable fields for sqlite
			if ('indexable' in field && field.indexable) {
				indexable_fields.push(fieldName);
				let unique = false;
				const direction: 'ASC' | 'DESC' =
					'index' in field && field.index?.descending ? 'DESC' : 'ASC';
				let name = `idx_${tableName}_${fieldName}`;
				const columns = [{ column: fieldName, direction }];
				if ('index' in field && field.index) {
					unique = field.index.unique ?? false;
					name = field.index.name ?? name;
					const additional_columns = (field.index.additional_columns || []).filter(
						Boolean,
					);
					if (additional_columns.length) {
						columns.push(
							...additional_columns.map((col) => ({
								column: col.column,
								direction: (col.descending ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
							})),
						);
						if (!field.index.name) {
							name = `idx_${tableName}_${[fieldName, ...additional_columns.map((col) => col.column)].join('_')}`;
						}
					}
				}
				indexes.push({
					name,
					table: tableName,
					columns,
					unique,
				});
			}

			// Build the sqlite table definition
			let sqliteColumnDef: string = 'TEXT';
			if (field.type === 'boolean') {
				sqliteColumnDef = 'BOOLEAN';
			} else if (field.type === 'number') {
				if ('integer' in field && field.integer) {
					sqliteColumnDef = 'INTEGER';
				} else {
					sqliteColumnDef = 'NUMERIC';
				}
			} else if (field.type === 'foreign_key') {
				if (field.foreign_key.type === 'number') {
					sqliteColumnDef = 'INTEGER';
				} else {
					sqliteColumnDef = 'TEXT';
				}
			}
			if ('unique' in field && field.unique) {
				unique_fields.push(fieldName);
				sqliteColumnDef += ' UNIQUE';
			} else if (!field.optional) {
				sqliteColumnDef += ' NOT NULL';
			}
			if ('readonly' in field && field.readonly) {
				readonly_fields.push(fieldName);
			}
			if (field.type === 'foreign_key') {
				// Do a sanity check for invalid table names (in the off chance someone puts a bad table name here)
				if (field.foreign_key.table.match(/[^a-zA-Z0-9_]/)) {
					throw new Error(
						`Foreign key field '${fieldName}' has an invalid table name '${field.foreign_key.table}'. Table names can only contain alphanumeric characters and underscores.`,
					);
				}
				if (field.foreign_key.column.match(/[^a-zA-Z0-9_]/)) {
					throw new Error(
						`Foreign key field '${fieldName}' has an invalid column name '${field.foreign_key.column}'. Column names can only contain alphanumeric characters and underscores.`,
					);
				}
				sqliteColumnDef += ` REFERENCES ${field.foreign_key.table}(${field.foreign_key.column})`;
				if (field.foreign_key.on_update) {
					sqliteColumnDef += ` ON UPDATE ${field.foreign_key.on_update}`;
				}
				if (field.foreign_key.on_delete) {
					sqliteColumnDef += ` ON DELETE ${field.foreign_key.on_delete}`;
				}
				foreign_keys[fieldName] = {
					type: field.foreign_key.type,
					table: field.foreign_key.table,
					column: field.foreign_key.column,
					on_update: field.foreign_key.on_update,
					on_delete: field.foreign_key.on_delete,
				};
			}
			// Non-scalar fields (objects, arrays, vectors, geopoints) are stored in
			// the internal `json` overflow column. Giving them their own TEXT column
			// would store a JSON string that never round-trips back into an object.
			const stored_in_json_column =
				field.type === 'object' ||
				field.type === 'array' ||
				field.type === 'vector' ||
				field.type === 'geopoint';
			if (!stored_in_json_column) {
				table_definition[fieldName] = sqliteColumnDef;
			}

			// Build the search schema
			const built_schema = recursivelyBuildSearchSchema(
				field,
				fieldName,
				false,
				searchable_fields,
				sortable_fields,
			);
			if (built_schema) {
				index_schema[fieldName] = built_schema;
			}

			// Build the form field properties
			recursivelyBuildFormFieldProps(field, fieldName, {}, form_field);
		}

		// Auto-index FK columns that derived fields depend on. Every write to a
		// referenced entity triggers a cascade reindex that runs
		// `WHERE <fk_column> = ?` against this table — without an index that is
		// a full-table scan on every such write.
		const derived_fk_columns = new Set<string>();
		for (const meta of Object.values(derived_fields)) {
			for (const fk of meta.foreign_keys ?? []) derived_fk_columns.add(fk);
		}
		for (const fk_column of derived_fk_columns) {
			if (!(fk_column in foreign_keys)) continue;
			// Skip when an index already has this column in the leading position,
			// or the column is UNIQUE (SQLite creates an implicit index for those)
			if (indexes.some((index) => index.columns[0]?.column === fk_column)) continue;
			if (unique_fields.includes(fk_column)) continue;
			indexes.push({
				name: `idx_${tableName}_${fk_column}`,
				table: tableName,
				columns: [{ column: fk_column, direction: 'ASC' }],
				unique: false,
			});
		}

		// Add auto-managed timestamp columns to the SQLite table definition
		table_definition['created_at'] = 'INTEGER NOT NULL';
		table_definition['updated_at'] = 'INTEGER NOT NULL';

		// Add timestamps to the search schema as sortable numbers (epoch ms)
		index_schema['updated_at'] = 'number';
		index_schema['created_at'] = 'number';
		// updated_at should be sortable (needed for sync/change detection)
		sortable_fields.push('updated_at');

		// At this point primary_key is guaranteed to be set (either user-defined or auto-injected)
		if (!primary_key) throw new Error('Table must have a primary key defined');

		// Validate that FK-derived fields reference actual foreign key fields
		for (const [fieldName, meta] of Object.entries(derived_fields)) {
			if (!meta.foreign_keys) continue;
			for (const fk_name of meta.foreign_keys) {
				if (!(fk_name in foreign_keys)) {
					throw new Error(
						`Derived field '${fieldName}' declares '${fk_name}' as a foreign key dependency, but '${fk_name}' is not a foreign key field in table '${tableName}'.`,
					);
				}
			}
		}

		/**
		 * The parse function to validate data against the table schema
		 * @throws a DelightError (status 400, with an `issues` array) if the data is invalid
		 */
		function parse(data: any): InstanceEntity {
			const parsedData = {} as any;
			const issues: Array<{ path: string[]; message: string }> = [];
			for (const [fieldName, fieldDef] of Object.entries(table_config)) {
				// Skip derived fields — they are computed in toSparse(), not stored
				if ('derived' in (fieldDef as any)['_'] && (fieldDef as any)['_'].derived)
					continue;
				parsedData[fieldName] = recursivelyParseField(
					fieldDef['_'],
					data[fieldName],
					[fieldName],
					issues,
				);
			}

			// Pass through auto-managed timestamp fields, coercing strings to epoch ms
			if (data.created_at !== undefined) parsedData.created_at = toEpoch(data.created_at);
			if (data.updated_at !== undefined) parsedData.updated_at = toEpoch(data.updated_at);

			// If there are any validation issues, throw an error with details
			if (issues.length) {
				throw Object.assign(
					new DelightError({ message: issues[0].message, status: 400 }),
					{ issues },
				);
			}
			return parsedData as InstanceEntity;
		}

		/**
		 * Converts the given entity data to a sparse search entity used by the search index.
		 * This only includes the fields defined as 'searchable' in the table schema.
		 */
		function toSparse(data: InstanceEntity): InstanceSearchEntity {
			const root = {} as any;
			for (const field_dot_notation of searchable_fields) {
				// Skip FK-derived fields — they don't exist in entity data and are computed in db.server.ts
				const top_field = field_dot_notation.split('.')[0];
				if (top_field in derived_fields) continue;

				const field_path = field_dot_notation.split('.');
				let current = data;
				let sparse_data = root;
				for (let i = 0; i < field_path.length; i++) {
					if (current === undefined || current === null) break;
					const field = field_path[i];
					if (i === field_path.length - 1) {
						// Only materialize the key when a real value exists: an explicit
						// `field: undefined` is absence, not a value, and the index must
						// not carry a key for it.
						const value = (current as any)[field];
						if (value !== undefined && value !== null) sparse_data[field] = value;
					} else {
						if (!(field in sparse_data)) {
							sparse_data[field] = {};
						}
						sparse_data = sparse_data[field];
						current = (current as any)[field];
					}
				}
			}

			// Compute same-table derived field values for search indexing
			// FK-derived fields are skipped here — they are computed in db.server.ts where DB access is available
			for (const [fieldName, fieldDef] of Object.entries(table_config)) {
				const field = (fieldDef as any)['_'];
				if (field.derived && typeof field.derived_fn === 'function') {
					if (
						Array.isArray(field.derived_foreign_keys) &&
						field.derived_foreign_keys.length > 0
					) {
						continue;
					}
					try {
						const value = field.derived_fn(data);
						if (value !== undefined && value !== null) {
							root[fieldName] = value;
						} else {
							delete root[fieldName];
						}
					} catch {
						// Silently skip — don't let one bad derived function break indexing
						delete root[fieldName];
					}
				}
			}

			// Always include timestamps for sorting/filtering, coercing to epoch if needed
			const entity = data as any;
			if (entity.updated_at !== undefined) root.updated_at = toEpoch(entity.updated_at);
			if (entity.created_at !== undefined) root.created_at = toEpoch(entity.created_at);

			return root as InstanceSearchEntity;
		}

		/**
		 * A Standard Schema (v1) validator over the table's form fields.
		 * Validates form data keyed by the same (dot-notation) field names as form.field,
		 * producing one human-readable issue per invalid field.
		 */
		const form_schema: FormStandardSchema = {
			'~standard': {
				version: 1,
				vendor: 'delightstack',
				validate: (value: unknown) => {
					const data = (value && typeof value === 'object' ? value : {}) as Record<
						string,
						unknown
					>;
					const issues: { message: string; path: string[] }[] = [];
					for (const [name, props] of Object.entries(form_field)) {
						if (props.readonly) continue;
						try {
							props.parse(getFormValueAtPath(data, name));
						} catch (error) {
							issues.push({ message: DelightError.from(error).message, path: [name] });
						}
					}
					if (issues.length) return { issues };
					return { value: data };
				},
			},
		};

		return {
			_: table_config,
			name: tableName,
			parse,
			toSparse,
			config: {
				primary_key,
				primary_key_type,
				indexable_fields,
				searchable_fields,
				sortable_fields,
				unique_fields,
				readonly_fields,
				foreign_keys,
				derived_fields,
				table_definition,
				indexes,
				index_schema,
			},
			form: {
				field: form_field,
				schema: form_schema,
			},
		} as unknown as Instance;
	}
}
