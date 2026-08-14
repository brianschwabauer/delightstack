import type { FieldGenerator } from './generators';
import type { FieldValidator } from './validation';

/* -------------------------------------------------------------------------- */
/* Field definitions                                                          */
/* -------------------------------------------------------------------------- */

export type DatabaseFieldType =
	| 'primary_key'
	| 'foreign_key'
	| 'string'
	| 'number'
	| 'boolean'
	| 'geopoint'
	| 'object'
	| 'array'
	| 'enum'
	| 'vector';

/** A custom validation function added via `.check()`. Returning a string fails parsing with that message. */
export type FieldCheck = (value: any) => string | undefined | void;

export interface DatabaseFieldBase {
	/** The type of the field */
	type: DatabaseFieldType;

	/** Whether the field can be fuzzy searched and indexed by the search engine. If 'primary' is true, this is ignored */
	searchable?: boolean;

	/** Whether the field should be indexed by sqlite. If 'primary' is true, this is ignored */
	indexable?: boolean;

	/** Whether the field must be unique in the table. This is ignored if 'primary' is true */
	unique?: boolean;

	/**
	 * Whether the field can be used for sorting results.
	 * If this is true, 'searchable' will also automatically be set to true so that sorting can be done by the search engine
	 */
	sortable?: boolean;

	/** Whether the field is read-only - which shows the value but prevents updates */
	readonly?: boolean;

	/**
	 * Marks the field as optional - meaning it can be undefined or null.
	 * Since we are using sqlite, optional strings will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional strings already cover that case.
	 */
	optional?: boolean;

	/** Whether the field has a default value (set via .default()) */
	has_default?: boolean;

	/** The default value for the field (a value, or a function returning a value) */
	default_value?: unknown;

	/** Custom validation functions added via .check() — run after built-in validation */
	checks?: FieldCheck[];
}

/** The options for a SQLite index created via `.indexable()` */
export interface IndexOptions {
	/** The name of the index to create in sqlite. @defaults to 'idx_<table_name>_<field_name>' */
	name?: string;
	/** Whether the index should be unique */
	unique?: boolean;
	/** Whether the index should be created in descending order */
	descending?: boolean;
	/** Additional columns to include in the index (for covering indexes) */
	additional_columns?: { column: string; descending?: boolean }[];
}

/** Additional options when a database field is indexable */
export interface IndexableField extends DatabaseFieldBase {
	/** Indexable fields must be a string, number, or boolean */
	type: 'string' | 'number' | 'boolean';
	/** Indexable must be true to add the index options */
	indexable: true;
	/** The options for the index to create in sqlite. Only applies when 'indexable' is true */
	index?: IndexOptions;
}

/** The format options for string fields */
export type StringFieldFormat =
	| 'base64'
	| 'color'
	| 'datetime'
	| 'date'
	| 'email'
	| 'ipv4'
	| 'ipv6'
	| 'password'
	| 'phone'
	| 'time'
	| 'uuid'
	| 'url';

/**
 * A transform applied to a string value during parse(), before validation.
 * Stored as plain data (like min/max/pattern) so the descriptors survive
 * serialization the same way the other constraints do.
 */
export type StringFieldTransform =
	| { type: 'trim' }
	| { type: 'lowercase' }
	| { type: 'uppercase' }
	| { type: 'normalize'; form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' };

/** The format options for string fields */
export interface StringField extends DatabaseFieldBase {
	type: 'string';

	/** Whether the string should be shown in a textarea input instead of a regular text input */
	textarea?: boolean;

	/**
	 * How the string should be formatted/validated/parsed.
	 * This is also used by the UI to determine what kind of input to show (like a color picker for 'color' format).
	 */
	format?: StringFieldFormat;

	/** The minimum length of the string */
	minlength?: number;

	/** The maximum length of the string */
	maxlength?: number;

	/** The regular expression the string must match */
	pattern?: string;

	/** The regular expressions (added via .regex()) the string must match */
	patterns?: RegExp[];

	/** The string the value must start with (added via .startsWith()) */
	starts_with?: string;

	/** The string the value must end with (added via .endsWith()) */
	ends_with?: string;

	/** The substring the value must include (added via .includes()) */
	includes?: string;

	/** Transforms (added via .trim()/.toLowerCase()/…) applied in declaration order before validation */
	transforms?: StringFieldTransform[];

	/** The validator used to validate/parse the string field */
	schema: FieldValidator;
}

/** Determines the html element input type for the string field */
export type StringFieldInputType<StringField extends any> = StringField extends {
	textarea: true;
}
	? 'textarea'
	: StringField extends { type: 'string'; format: infer Format extends StringFieldFormat }
		? Format extends 'color' | 'email' | 'password' | 'url' | 'date' | 'time'
			? Format
			: // Match the runtime mapping: these formats translate to different
				// native input types.
				Format extends 'phone'
				? 'tel'
				: Format extends 'datetime'
					? 'datetime-local'
					: 'text'
		: StringField extends { type: 'string' }
			? 'text'
			: never;

/** The format options for number fields */
export interface NumberField extends DatabaseFieldBase {
	type: 'number';
	/** Whether the number should be an integer */
	integer?: boolean;
	/** The validator used to validate/parse the number field */
	schema: FieldValidator;
	/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	max?: number;
	/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	min?: number;
	/** The exclusive lower bound (added via .gt()) - the value must be strictly greater */
	exclusive_min?: number;
	/** The exclusive upper bound (added via .lt()) - the value must be strictly less */
	exclusive_max?: number;
	/**
	 * The amount the number should be increased/decreased with each 'step'.
	 * Also validated: the value must be a multiple of the step (float-tolerant).
	 */
	step?: number;
}

/** The options for a boolean field */
export interface BooleanField extends Omit<DatabaseFieldBase, 'unique'> {
	type: 'boolean';
	/** The validator used to validate/parse the boolean field */
	schema: FieldValidator;
}

/** The options for a geopoint field */
export interface GeopointField extends Omit<
	DatabaseFieldBase,
	'indexable' | 'unique' | 'sortable'
> {
	type: 'geopoint';
	/** Geopoints are always searchable since that is the primary point of a geopoint field */
	searchable: true;
	/** The validator used to validate/parse the geopoint field */
	schema: FieldValidator;
}

/** The options for an object field */
export interface ObjectField<
	Properties extends Record<string, FieldGenerator>,
> extends Pick<DatabaseFieldBase, 'optional' | 'readonly'> {
	type: 'object';
	/** A record of properties for the object */
	properties: Properties;
}

/** The options for an array field */
export interface ArrayField<Items extends FieldGenerator> extends Pick<
	DatabaseFieldBase,
	'optional' | 'readonly' | 'searchable'
> {
	type: 'array';
	/** The type of items in the array */
	items: Items;
	/** The minimum number of items in the array */
	min?: number;
	/** The maximum number of items in the array */
	max?: number;
}

/** The options for an enum field */
export interface EnumField<Options extends string[] = string[]> extends Omit<
	DatabaseFieldBase,
	'indexable' | 'unique'
> {
	type: 'enum';
	/** The available string options this field can be equal to */
	options: Options;
	/** Human-readable labels for options defined as { value, label } pairs */
	option_labels?: Record<string, string>;
	/** The validator used to validate/parse the enum field */
	schema: FieldValidator;
}

/** The options for a vector field */
export interface VectorField extends Omit<
	DatabaseFieldBase,
	'indexable' | 'unique' | 'sortable'
> {
	type: 'vector';
	/** Vector fields are always searchable because that it the point of a vector field */
	searchable: true;
	/** The dimensionality of the vector (also known as 'size') */
	dimensions: number;
	/** The validator used to validate/parse the vector field */
	schema: FieldValidator;
}

/** The options for a primary key field */
export interface PrimaryKeyField<
	Type extends 'string' | 'number' = 'string',
> extends Pick<DatabaseFieldBase, 'searchable' | 'sortable' | 'readonly'> {
	type: 'primary_key';
	/** Primary key fields are always added to the search index */
	searchable: true;
	primary_key: {
		/** Primary keys can only be strings or numbers since they are the IDs of the table */
		type: Type;
	};
}

export type SqliteForeignKeyAction =
	| 'CASCADE'
	| 'SET NULL'
	| 'RESTRICT'
	| 'NO ACTION'
	| 'SET DEFAULT';

/** The options for a field that references a field in a foreign table */
export interface ForeignKeyField extends Pick<
	DatabaseFieldBase,
	'searchable' | 'sortable' | 'optional' | 'readonly'
> {
	type: 'foreign_key';
	foreign_key: {
		/** The type of the column in the referenced table. Since this is a foreign key, it must be a string or number */
		type: 'string' | 'number';
		/** The name of the table that this field references */
		table: string;
		/** The name of the column in the referenced table */
		column: string;
		/** The action to take when the referenced row is updated */
		on_update?: SqliteForeignKeyAction | undefined;
		/** The action to take when the referenced row is deleted */
		on_delete?: SqliteForeignKeyAction | undefined;
	};
}

/** The flags for a database field */
export type DatabaseField =
	| IndexableField
	| StringField
	| NumberField
	| BooleanField
	| GeopointField
	| ObjectField<any>
	| ArrayField<any>
	| EnumField
	| VectorField
	| ForeignKeyField
	| PrimaryKeyField<'string' | 'number'>;

/* -------------------------------------------------------------------------- */
/* Builder flag wrappers                                                      */
/* -------------------------------------------------------------------------- */

export type Searchable<T extends { _: any }> = T & { _: T['_'] & { searchable: true } };
export type Indexable<T extends { _: any }> = T & { _: T['_'] & { indexable: true } };
export type Unique<T extends { _: any }> = T & { _: T['_'] & { unique: true } };
export type Sortable<T extends { _: any }> = T & { _: T['_'] & { sortable: true } };
export type OptionalValue<T extends { _: any }> = T & { _: T['_'] & { optional: true } };
export type ReadOnly<T extends { _: any }> = T & { _: T['_'] & { readonly: true } };
export type DerivedValue<T extends { _: any }> = T & { _: T['_'] & { derived: true } };
export type IntegerValue<T extends { _: any }> = T & {
	_: T['_'] & { type: 'number'; integer: true };
};
export type FormattedString<
	T extends { _: any },
	Format extends StringFieldFormat,
> = T & {
	_: T['_'] & { type: 'string'; format: Format };
};
export type TextareaString<T extends { _: any }> = T & { _: T['_'] & { textarea: true } };
export type Label<T extends { _: any }, LabelText extends string> = T & {
	_: T['_'] & { label: LabelText };
};
export type Placeholder<T extends { _: any }, PlaceholderText extends string> = T & {
	_: T['_'] & { placeholder: PlaceholderText };
};
export type Description<T extends { _: any }, DescriptionText extends string> = T & {
	_: T['_'] & { description: DescriptionText };
};
export type DefaultedValue<T extends { _: any }> = T & {
	_: T['_'] & { has_default: true };
};
export type ForeignKey<
	T extends { readonly _: any },
	KeyType extends 'string' | 'number',
	TableName extends string,
	ColumnName extends string,
	OnUpdate extends SqliteForeignKeyAction | undefined,
	OnDelete extends SqliteForeignKeyAction | undefined,
> = T & {
	readonly _: T['_'] & {
		foreign_key: {
			type: KeyType;
			table: TableName;
			column: ColumnName;
			on_update: OnUpdate;
			on_delete: OnDelete;
		};
	};
};

/* -------------------------------------------------------------------------- */
/* Flag predicates                                                            */
/* -------------------------------------------------------------------------- */

export type IsPrimaryKey<T> = T extends { _: (infer _U) & { type: 'primary_key' } }
	? true
	: false;
export type IsForeignKey<T> = T extends { _: (infer _U) & { type: 'foreign_key' } }
	? true
	: false;

/** Checks if any field in a table config is a primary key (produces `true` or `never`) */
export type HasPrimaryKeyField<TC extends Record<string, FieldGenerator>> = {
	[K in keyof TC]: IsPrimaryKey<TC[K]> extends true ? true : never;
}[keyof TC];
export type IsSearchable<T> = T extends { _: (infer _U) & { searchable: true } }
	? true
	: false;
export type IsIndexable<T> = T extends { _: (infer _U) & { indexable: true } }
	? true
	: false;
export type IsUnique<T> = T extends { _: (infer _U) & { unique: true } } ? true : false;
export type IsSortable<T> = T extends { _: (infer _U) & { sortable: true } }
	? true
	: false;
export type IsOptional<T> = T extends { _: (infer _U) & { optional: true } }
	? true
	: false;
export type HasDefault<T> = T extends { _: (infer _U) & { has_default: true } }
	? true
	: false;
export type IsReadOnly<T> = T extends { _: (infer _U) & { readonly: true } }
	? true
	: false;
export type IsDerived<T> = T extends { _: infer U }
	? unknown extends U
		? false
		: U extends { derived: true }
			? true
			: false
	: false;

/* -------------------------------------------------------------------------- */
/* Generic type helpers                                                       */
/* -------------------------------------------------------------------------- */

export type OmitNeverProperties<T> = {
	[K in keyof T as T[K] extends never ? never : K]: T[K];
};

export type NeverIfEmptyObject<T extends object> = keyof T extends never ? never : T;

type Identity<T> = T;
export type Flatten<T extends object> = Identity<{ [k in keyof T]: T[k] }>;
export type OptionalKeys<T extends object> = {
	[k in keyof T]: undefined extends T[k] ? k : never;
}[keyof T];
export type RequiredKeys<T extends object> = {
	[k in keyof T]: undefined extends T[k] ? never : k;
}[keyof T];
export type AddQuestionMarks<T extends object> = Flatten<
	Partial<Pick<T, OptionalKeys<T>>> & Pick<T, RequiredKeys<T>>
>;

/* -------------------------------------------------------------------------- */
/* Field value / index types                                                  */
/* -------------------------------------------------------------------------- */

/** Determines the TypeScript type of a database field */
export type FieldType<T> = T extends {
	readonly _: { type: infer TypeString extends DatabaseFieldType };
}
	? TypeString extends 'string'
		? string
		: TypeString extends 'number'
			? number
			: TypeString extends 'boolean'
				? boolean
				: TypeString extends 'vector'
					? number[]
					: TypeString extends 'geopoint'
						? { lat: number; lon: number }
						: TypeString extends 'primary_key'
							? T extends {
									_: { primary_key: { type: infer PKType extends 'string' | 'number' } };
								}
								? PKType extends 'string'
									? string
									: number
								: never
							: TypeString extends 'foreign_key'
								? T extends {
										_: {
											foreign_key: { type: infer FKType extends 'string' | 'number' };
										};
									}
									? FKType extends 'string'
										? string
										: number
									: never
								: TypeString extends 'enum'
									? T extends { _: { options: infer EnumOptions extends string[] } }
										? EnumOptions[number]
										: never
									: TypeString extends 'object'
										? T extends { _: { properties: infer ObjectType } }
											? AddQuestionMarks<
													Flatten<
														{
															// Mark the readonly fields as readonly
															readonly [Key in keyof ObjectType as IsReadOnly<
																ObjectType[Key]
															> extends true
																? Key
																: never]: IsOptional<ObjectType[Key]> extends true
																? FieldType<ObjectType[Key]> | undefined | null
																: FieldType<ObjectType[Key]>;
														} & {
															// Mark the non-readonly fields as normal
															[Key in keyof ObjectType as IsReadOnly<
																ObjectType[Key]
															> extends true
																? never
																: Key]: IsOptional<ObjectType[Key]> extends true
																? FieldType<ObjectType[Key]> | undefined | null
																: FieldType<ObjectType[Key]>;
														}
													>
												>
											: never
										: TypeString extends 'array'
											? T extends { _: { items: infer ArrayType } }
												? FieldType<ArrayType>[]
												: never
											: never
	: never;

/** Determines the search-index type of a database field */
export type IndexFieldType<T> = T extends {
	readonly _: { type: infer TypeString extends DatabaseFieldType };
}
	? TypeString extends 'object'
		? T extends { _: { properties: infer ObjectType } }
			? NeverIfEmptyObject<
					Flatten<
						OmitNeverProperties<{
							[Key in keyof ObjectType]: IndexFieldType<ObjectType[Key]>;
						}>
					>
				>
			: never
		: TypeString extends 'array'
			? T extends {
					_: { items: { _: { type: infer ArrayType extends DatabaseFieldType } } };
				}
				? IsSearchable<T> extends true
					? ArrayType extends 'string'
						? `string[]`
						: ArrayType extends 'number'
							? `number[]`
							: ArrayType extends 'boolean'
								? `boolean[]`
								: ArrayType extends 'enum'
									? `enum[]`
									: never
					: never
				: never
			: TypeString extends 'primary_key'
				? T extends {
						_: { primary_key: { type: infer PKType extends 'string' | 'number' } };
					}
					? PKType extends 'string'
						? `string`
						: `number`
					: never
				: IsSearchable<T> extends true
					? TypeString extends 'string' | 'number' | 'boolean' | 'geopoint' | 'enum'
						? TypeString
						: TypeString extends 'vector'
							? `vector[${number}]`
							: TypeString extends 'foreign_key'
								? T extends {
										_: {
											foreign_key: { type: infer FKType extends 'string' | 'number' };
										};
									}
									? FKType extends 'string'
										? `string`
										: `number`
									: never
								: never
					: never
	: never;

/* -------------------------------------------------------------------------- */
/* Form field props                                                           */
/* -------------------------------------------------------------------------- */

export interface BaseFormFieldProps<FieldName extends string = string> {
	/** The name of the field (used when inside a <form> element) */
	name: FieldName;
	/**
	 * Parses & validates a single value for this field and returns the parsed value.
	 * Throws an error whose `message` is safe to show to the user.
	 * Input components run this automatically when these props are spread onto them.
	 */
	parse: (value: unknown) => unknown;
}

/**
 * A minimal Standard Schema (v1) interface.
 * Any consumer that accepts a Standard Schema (like the components Form's `schema` prop) can use it.
 */
export interface FormStandardSchema<Output = Record<string, unknown>> {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) =>
			| { value: Output; issues?: undefined }
			| {
					issues: ReadonlyArray<{
						message: string;
						path?: ReadonlyArray<PropertyKey> | undefined;
					}>;
			  };
	};
}

/** The form props shared by every field type (derived from the field's schema flags) */
export type CommonFormFieldProps<
	T,
	InheritedOptional extends boolean = false,
> = OmitNeverProperties<{
	/**
	 * Whether the field is required. Optional fields, fields with a .default(),
	 * and fields nested inside an optional object are not required
	 */
	required: InheritedOptional extends true
		? never
		: IsOptional<T> extends true
			? never
			: HasDefault<T> extends true
				? never
				: true;
	/** Whether the field is read-only (shows the current value, but disables editing) */
	readonly: IsReadOnly<T> extends true ? true : never;
	/**
	 * A human-readable label for the field (usually shown above an input).
	 * Auto-derived from the field name when not set via .label()
	 */
	label: T extends { _: { label: infer LabelText extends string } } ? LabelText : string;
	/** A placeholder string for the field (usually a lighter color text in the Input box) */
	placeholder: T extends {
		_: { placeholder: infer PlaceholderText extends string };
	}
		? PlaceholderText
		: never;
	/** Description text shown below the input */
	description: T extends {
		_: { description: infer DescriptionText extends string };
	}
		? DescriptionText
		: never;
}>;

type FormFieldPathValue<T, P extends string> = P extends `${infer Key}.${infer Rest}`
	? Key extends keyof T
		? FormFieldPathValue<T[Key], Rest>
		: never
	: P extends keyof T
		? T[P]
		: never;

type FormFieldPaths<T> = T extends object
	? {
			[Key in keyof T]: Key extends string
				? Key extends '_'
					? Key // This is a leaf node because it has props stored in the '_' key
					: T[Key] extends object
						? FormFieldPaths<T[Key]> extends never
							? never // Prevents paths to empty objects
							: FormFieldPaths<T[Key]> extends '_'
								? Key
								: `${Key}.${FormFieldPaths<T[Key]>}`
						: Key // Includes the path to a primitive value
				: never;
		}[keyof T]
	: never;

type FlattenFormFieldProps<T> = {
	[P in FormFieldPaths<T>]: FormFieldPathValue<T, P>;
};

type ExtractFormFieldProps<T> =
	T extends Record<string, any> ? { [Key in keyof T]: T[Key]['_'] } : never;

export type GenericFormFieldProps = BaseFormFieldProps & {
	/** The type of value that the input element accepts */
	type:
		| 'text'
		| 'textarea'
		| 'number'
		| 'boolean'
		| 'color'
		| 'datetime-local'
		| 'email'
		| 'password'
		| 'tel'
		| 'url'
		| 'date'
		| 'time';

	/**
	 * Whether the field allows multiple values to be selected.
	 * The field must be defined as an array() type to use this option.
	 */
	multiple?: boolean;
	/**
	 * A human-readable label for the field (usually shown above an input).
	 * Auto-derived from the field name when not set via .label()
	 */
	label: string;
	/** Whether the field is required */
	required?: boolean;
	/** Whether the field is read-only (shows the current value, but disables editing) */
	readonly?: boolean;
	/** A placeholder string for the field (usually a lighter color text in the Input box) */
	placeholder?: string;
	/** Description text shown below the input */
	description?: string;
	/** The maximum number of characters the input string can be. 'type' must be one of the string options */
	maxlength?: number;
	/** The minimum number of characters the input string can be. 'type' must be one of the string options */
	minlength?: number;
	/** The regular expression the input must match (handled by the native browser input). 'type' must be one of the string options */
	pattern?: string;
	/** The available options for the enum field (ready to pass to a Select component) */
	options?: { value: string; label: string }[];
	/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	max?: number;
	/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	min?: number;
	/** The amount the number should be increased/decreased with each 'step' */
	step?: number;
	/**
	 * Whether a boolean field is tri-state (optional with no default):
	 * null/undefined mean "unanswered" and display as indeterminate
	 */
	tristate?: boolean;
	/** A defaulted boolean field's default value (shown when the draft is empty) */
	default_checked?: boolean;
};

/**
 * Defines the props that can be added to input components for a form field.
 * This makes it easy to spread the props onto an input element.
 */
export type FormFieldProps<
	T,
	FieldName extends string | undefined = undefined,
	InheritedOptional extends boolean = false,
> =
	/** Check if FieldName is a string - meaning this is a child field */
	FieldName extends string
		? T extends {
				readonly _: { type: infer TypeString extends DatabaseFieldType };
			}
			? /** The field is a child object. so merge the props with the parent object */
				TypeString extends 'object'
				? T extends { _: { properties: infer ObjectType } }
					? {
							[Key in keyof ObjectType & string]: FormFieldProps<
								ObjectType[Key],
								Key,
								IsOptional<T> extends true ? true : InheritedOptional
							>;
						}
					: never
				: /** The field is an array type so add the necessary array input props */
					TypeString extends 'array'
					? T extends { _: { items: infer ArrayType } }
						? ArrayType extends {
								_: { type: infer ItemTypeString extends DatabaseFieldType };
							}
							? ItemTypeString extends 'string' | 'number' | 'enum'
								? FormFieldProps<ArrayType, FieldName> extends {
										_: infer ItemProps;
									}
									? Flatten<{
											/**
											 * The item field provides the value props (type, minlength, options, ...);
											 * required/readonly/label/placeholder/description come from the ARRAY field itself
											 */
											_: Omit<
												ItemProps,
												| 'multiple'
												| 'required'
												| 'readonly'
												| 'label'
												| 'placeholder'
												| 'description'
											> & {
												/**
												 * Whether the field allows multiple values to be selected.
												 * The field must be defined as an array() type to use this option.
												 */
												multiple: true;
											} & CommonFormFieldProps<T, InheritedOptional>;
										}>
									: never
								: never
							: never
						: never
					: /** The field is an enum type so add the necessary enum input props */
						TypeString extends 'enum'
						? Flatten<{
								_: BaseFormFieldProps<FieldName> & {
									/** The type of value that the input element accepts */
									type: 'text';
									/** The available options for the enum field (ready to pass to a Select component) */
									options: T extends {
										_: { options: infer EnumOptions extends string[] };
									}
										? { value: EnumOptions[number]; label: string }[]
										: { value: string; label: string }[];
								} & CommonFormFieldProps<T, InheritedOptional>;
							}>
						: /** The field is a number type so add the necessary number input props */
							TypeString extends 'number'
							? Flatten<{
									_: BaseFormFieldProps<FieldName> & {
										/** The type of value that the input element accepts */
										type: 'number';
										/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
										max?: number;
										/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
										min?: number;
										/** The amount the number should be increased/decreased with each 'step' */
										step?: number;
									} & CommonFormFieldProps<T, InheritedOptional>;
								}>
							: /** The field is a boolean type so add the necessary boolean input props */
								TypeString extends 'boolean'
								? Flatten<{
										_: BaseFormFieldProps<FieldName> & {
											/** The type of value that the input element accepts */
											type: 'boolean';
										} & OmitNeverProperties<{
												/**
												 * Whether the field is tri-state (optional with no default):
												 * null/undefined mean "unanswered" and display as indeterminate
												 */
												tristate: HasDefault<T> extends true
													? never
													: InheritedOptional extends true
														? true
														: IsOptional<T> extends true
															? true
															: never;
												/** The field's default value (shown when the draft is empty) */
												default_checked: HasDefault<T> extends true ? boolean : never;
											}> &
											CommonFormFieldProps<T, InheritedOptional>;
									}>
								: /** The field is a string type so add the necessary string input props */
									TypeString extends 'string'
									? Flatten<{
											_: BaseFormFieldProps<FieldName> & {
												/** The type of value that the input element accepts */
												type: StringFieldInputType<T['_']>;
												/** The maximum number of characters the input string can be. */
												maxlength?: number;
												/** The minimum number of characters the input string can be. */
												minlength?: number;
												/** The regular expression the input must match (handled by the native browser input) */
												pattern?: string;
											} & CommonFormFieldProps<T, InheritedOptional>;
										}>
									: never
			: never
		: /** FieldName is undefined, so this is the root. We need create an object with all deeply nested keys */
			T extends Record<string, any>
			? NeverIfEmptyObject<
					ExtractFormFieldProps<
						FlattenFormFieldProps<
							OmitNeverProperties<{
								[Key in keyof T & string]: IsDerived<T[Key]> extends true
									? never
									: FormFieldProps<T[Key], Key>;
							}>
						>
					>
				>
			: never;
