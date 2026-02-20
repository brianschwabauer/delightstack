import {
	AnyOrama,
	AnySchema,
	Orama,
	Results,
	SearchableType,
	SearchParamsFullText,
	SearchParamsVector,
	SorterConfig,
	TypedDocument,
	SearchParams,
} from '@orama/orama';
import { z } from 'zod';

/**
 * TODO:
 * - Add support for 'currency' fields which would have a separate function db.currency()
 *   - It would save the value in the format `<amount><currency_code>` (like '19.99USD')
 *   - This allows for easy sorting and searching by amount, while still storing the currency code
 *   - It is also easy to parse out the amount and currency code when displaying the value
 */

type DatabaseFieldType =
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

interface DatabaseFieldBase {
	/** The type of the field */
	type: DatabaseFieldType;

	/** Whether the field can be fuzzy searched and indexed by orama. If 'primary' is true, this is ignored */
	searchable?: boolean;

	/** Whether the field should be indexed by sqlite. If 'primary' is true, this is ignored */
	indexable?: boolean;

	/** Whether the field must be unique in the table. This is ignored if 'primary' is true */
	unique?: boolean;

	/**
	 * Whether the field can be used for sorting results.
	 * If this is true, 'searchable' will also automatically be set to true so that sorting can be done via orama
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

	/**
	 * Whether this is a column in the table.
	 * This is true for root fields, and false for nested object fields.
	 */
	column?: boolean;
}

/** Additional options when a database field is indexable */
interface IndexableField extends DatabaseFieldBase {
	/** Indexable fields must be a string, number, or boolean */
	type: 'string' | 'number' | 'boolean';
	/** Indexable must be true to add the index options */
	indexable: true;
	/** Indexable fields must be a column (sqlite can't index nested object fields) */
	column: true;
	/** The options for the index to create in sqlite. Only applies when 'indexable' is true */
	index?: {
		/** The name of the index to create in sqlite. @defaults to 'idx_<table_name>_<field_name>' */
		name?: string;
		/** Whether the index should be unique */
		unique?: boolean;
		/** Whether the index should be created in descending order */
		descending?: boolean;
		/** Additional columns to include in the index (for covering indexes) */
		additional_columns?: { column: string; descending?: boolean }[];
	};
}

/** The format options for string fields */
type StringFieldFormat =
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

type StringFieldFormatToZodSchema = {
	base64: z.ZodBase64;
	color: z.ZodString;
	datetime: z.ZodISODateTime;
	date: z.ZodISODate;
	email: z.ZodEmail;
	ipv4: z.ZodIPv4;
	ipv6: z.ZodIPv6;
	password: z.ZodString;
	phone: z.ZodString;
	time: z.ZodISOTime;
	uuid: z.ZodUUID;
	url: z.ZodURL;
};

/** The format options for string fields */
interface StringField extends DatabaseFieldBase {
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

	/** The zod schema used to validate/parse the string field */
	schema: {
		[Key in StringFieldFormat]: StringFieldFormatToZodSchema[Key];
	}[StringFieldFormat];
}

/** Determines the html element input type for the string field */
type StringFieldInputType<StringField extends any> = StringField extends {
	textarea: true;
}
	? 'textarea'
	: StringField extends { type: 'string'; format: infer Format extends StringFieldFormat }
		? Format extends
				| 'color'
				| 'datetime'
				| 'email'
				| 'password'
				| 'phone'
				| 'url'
				| 'date'
				| 'time'
			? Format
			: 'text'
		: StringField extends { type: 'string' }
			? 'text'
			: never;

/** The format options for number fields */
interface NumberField extends DatabaseFieldBase {
	type: 'number';
	/** Whether the number should be an integer */
	integer?: boolean;
	/** The zod schema used to validate/parse the number field */
	schema: z.ZodNumber;
	/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	max?: number;
	/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	min?: number;
	/** The amount the number should be increased/decreased with each 'step' */
	step?: number;
}

/** The options for a boolean field */
interface BooleanField extends Omit<DatabaseFieldBase, 'unique'> {
	type: 'boolean';
	/** The zod schema used to validate/parse the boolean field */
	schema: z.ZodBoolean;
}

/** The options for a geopoint field */
interface GeopointField
	extends Omit<DatabaseFieldBase, 'indexable' | 'unique' | 'sortable'> {
	type: 'geopoint';
	/** Geopoints are always searchable since that is the primary point of a geopoint field */
	searchable: true;
	/** The zod schema used to validate/parse the geopoint field */
	schema: z.ZodObject<{
		lat: z.ZodNumber;
		lon: z.ZodNumber;
	}>;
}

/** The options for an object field */
interface ObjectField<Properties extends Record<string, FieldGenerator>>
	extends Pick<DatabaseFieldBase, 'column' | 'optional' | 'readonly'> {
	type: 'object';
	/** A record of properties for the object */
	properties: Properties;
}

/** The options for an array field */
interface ArrayField<Items extends FieldGenerator>
	extends Pick<DatabaseFieldBase, 'column' | 'optional' | 'readonly' | 'searchable'> {
	type: 'array';
	/** The type of items in the array */
	items: Items;
	/** The minimum number of items in the array */
	min?: number;
	/** The maximum number of items in the array */
	max?: number;
}

/** The options for an enum field */
interface EnumField<Options extends string[] = string[]>
	extends Omit<DatabaseFieldBase, 'indexable' | 'unique' | 'sortable'> {
	type: 'enum';
	/** The available string options this field can be equal to */
	options: Options;
	/** The zod schema used to validate/parse the enum field */
	schema: z.ZodEnum;
}

/** The options for a vector field */
interface VectorField
	extends Omit<DatabaseFieldBase, 'indexable' | 'unique' | 'sortable'> {
	type: 'vector';
	/** Vector fields are always searchable because that it the point of a vector field */
	searchable: true;
	/** The dimensionality of the vector (also known as 'size') */
	dimensions: number;
	/** The zod schema used to validate/parse the vector field */
	schema: z.ZodArray<z.ZodNumber>;
}

/** The options for a primary key field */
interface PrimaryKeyField<Type extends 'string' | 'number' = 'string'>
	extends Pick<DatabaseFieldBase, 'searchable' | 'sortable' | 'readonly'> {
	type: 'primary_key';
	/** Primary key fields are always added to the search index */
	searchable: true;
	primary_key: {
		/** Primary keys can only be strings or numbers since they are the IDs of the table */
		type: Type;
	};
}

/** The options for a field that references a field in a foreign table */
interface ForeignKeyField
	extends Pick<DatabaseFieldBase, 'searchable' | 'sortable' | 'optional' | 'readonly'> {
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
type DatabaseField =
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

type PrimaryKey<T extends { _: any }> = T & { _: T['_'] & { type: 'primary_key' } };
type Searchable<T extends { _: any }> = T & { _: T['_'] & { searchable: true } };
type Indexable<T extends { _: any }> = T & { _: T['_'] & { indexable: true } };
type Unique<T extends { _: any }> = T & { _: T['_'] & { unique: true } };
type Sortable<T extends { _: any }> = T & { _: T['_'] & { sortable: true } };
type OptionalValue<T extends { _: any }> = T & { _: T['_'] & { optional: true } };
type ReadOnly<T extends { _: any }> = T & { _: T['_'] & { readonly: true } };
type Column<T extends { _: any }> = T & { _: T['_'] & { column: true } };
type IntegerValue<T extends { _: any }> = T & {
	_: T['_'] & { type: 'number'; integer: true };
};
type FormattedString<T extends { _: any }, Format extends StringFieldFormat> = T & {
	_: T['_'] & { type: 'string'; format: Format };
};
type TextareaString<T extends { _: any }> = T & { _: T['_'] & { textarea: true } };
type Label<T extends { _: any }, LabelText extends string> = T & {
	_: T['_'] & { label: LabelText };
};
type Placeholder<T extends { _: any }, PlaceholderText extends string> = T & {
	_: T['_'] & { placeholder: PlaceholderText };
};
type ForeignKey<
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

type IsPrimaryKey<T> = T extends { _: infer U & { type: 'primary_key' } } ? true : false;
type IsForeignKey<T> = T extends { _: infer U & { type: 'foreign_key' } } ? true : false;

/** Checks if any field in a table config is a primary key (produces `true` or `never`) */
type HasPrimaryKeyField<TC extends Record<string, FieldGenerator>> = {
	[K in keyof TC]: IsPrimaryKey<TC[K]> extends true ? true : never;
}[keyof TC];
type IsColumn<T> = T extends { _: infer U & { column: true } } ? true : false;
type IsSearchable<T> = T extends { _: infer U & { searchable: true } } ? true : false;
type IsIndexable<T> = T extends { _: infer U & { indexable: true } } ? true : false;
type IsUnique<T> = T extends { _: infer U & { unique: true } } ? true : false;
type IsSortable<T> = T extends { _: infer U & { sortable: true } } ? true : false;
type IsOptional<T> = T extends { _: infer U & { optional: true } } ? true : false;
type IsReadOnly<T> = T extends { _: infer U & { readonly: true } } ? true : false;
type IsInteger<T> = T extends { _: infer U & { integer: true } } ? true : false;
type IsBoolean<T> = T extends { _: infer U & { type: 'boolean' } } ? true : false;
type IsNumber<T> = T extends { _: infer U & { type: 'number' } } ? true : false;
type IsString<T> = T extends { _: infer U & { type: 'string' } } ? true : false;
type IsEnum<T> = T extends { _: infer U & { type: 'enum' } } ? true : false;

type OmitNeverProperties<T> = {
	[K in keyof T as T[K] extends never ? never : K]: T[K];
};

type NeverIfEmptyObject<T extends object> = keyof T extends never ? never : T;

type Identity<T> = T;
type Flatten<T extends object> = Identity<{ [k in keyof T]: T[k] }>;
type OptionalKeys<T extends object> = {
	[k in keyof T]: undefined extends T[k] ? k : never;
}[keyof T];
type RequiredKeys<T extends object> = {
	[k in keyof T]: undefined extends T[k] ? never : k;
}[keyof T];
type AddQuestionMarks<T extends object> = Flatten<
	Partial<Pick<T, OptionalKeys<T>>> & Pick<T, RequiredKeys<T>>
>;

/** Determines the TypeScript type of a database field */
type FieldType<T> = T extends {
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

/** Determines the Orama formatted type of a database field for search indexing */
type OramaType<T> = T extends {
	readonly _: { type: infer TypeString extends DatabaseFieldType };
}
	? TypeString extends 'object'
		? T extends { _: { properties: infer ObjectType } }
			? NeverIfEmptyObject<
					Flatten<
						OmitNeverProperties<{ [Key in keyof ObjectType]: OramaType<ObjectType[Key]> }>
					>
				>
			: never
		: TypeString extends 'array'
			? T extends {
					_: { items: { type: infer ArrayType extends DatabaseFieldType } };
				}
				? IsSearchable<ArrayType> extends true
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

interface BaseFormFieldProps<FieldName extends string = string> {
	/** The name of the field (used when inside a <form> element) */
	name: FieldName;
	/**
	 * A function that is called on every change
	 * If it throws and error, the error can contain a "message" field that will be shown to the user
	 */
	parse: (value: any) => void;
}

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

type GenericFormFieldProps = BaseFormFieldProps & {
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
	/** A human-readable label for the field (usually shown above an input) */
	label?: string;
	/** Whether the field is required */
	required?: boolean;
	/** Whether the field is read-only (shows the current value, but disables editing) */
	readonly?: boolean;
	/** A placeholder string for the field (usually a lighter color text in the Input box) */
	placeholder?: string;
	/** The maximum number of characters the input string can be. 'type' must be one of the string options */
	maxlength?: number;
	/** The minimum number of characters the input string can be. 'type' must be one of the string options */
	minlength?: number;
	/** The regular expression the input must match (handled by the native browser input). 'type' must be one of the string options */
	pattern?: string;
	/** The available options for the enum field */
	options?: string[];
	/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	max?: number;
	/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
	min?: number;
	/** The amount the number should be increased/decreased with each 'step' */
	step?: number;
};

/**
 * Defines the props that can be added to input components for a form field.
 * This makes it easy to spread the props onto an input element.
 */
type FormFieldProps<T, FieldName extends string | undefined = undefined> =
	/** Check if FieldName is a string - meaning this is a child field */
	FieldName extends string
		? T extends {
				readonly _: { type: infer TypeString extends DatabaseFieldType };
			}
			? /** The field is a child object. so merge the props with the parent object */
				TypeString extends 'object'
				? T extends { _: { properties: infer ObjectType } }
					? {
							[Key in keyof ObjectType & string]: FormFieldProps<ObjectType[Key], Key>;
						}
					: never
				: /** The field is an array type so add the necessary array input props */
					TypeString extends 'array'
					? T extends { _: { items: infer ArrayType } }
						? ArrayType extends {
								_: { type: infer ItemTypeString extends DatabaseFieldType };
							}
							? ItemTypeString extends 'string' | 'number' | 'enum'
								? FormFieldProps<ArrayType, FieldName> &
										OmitNeverProperties<{
											_: {
												/**
												 * Whether the field allows multiple values to be selected.
												 * The field must be defined as an array() type to use this option.
												 */
												multiple: true;
												/** A human-readable label for the field (usually shown above an input) */
												label: T extends { _: { label: infer LabelText extends string } }
													? LabelText
													: never;
												/** Whether the field is required */
												required: IsOptional<T> extends true ? never : true;
												/** Whether the field is read-only (shows the current value, but disables editing) */
												readonly: IsReadOnly<T> extends true ? true : never;
												/** A placeholder string for the field (usually a lighter color text in the Input box) */
												placeholder: T extends {
													_: { placeholder: infer PlaceholderText extends string };
												}
													? PlaceholderText
													: never;
											};
										}>
								: never
							: never
						: never
					: /** The field is an enum type so add the necessary enum input props */
						TypeString extends 'enum'
						? Flatten<{
								_: BaseFormFieldProps<FieldName> &
									OmitNeverProperties<{
										/** The type of value that the input element accepts */
										type: 'text';
										/** The available options for the enum field */
										options: T extends {
											_: { options: infer EnumOptions extends string[] };
										}
											? EnumOptions
											: string[];
										/** Whether the field is required */
										required: IsOptional<T> extends true ? never : true;
										/** Whether the field is read-only (shows the current value, but disables editing) */
										readonly: IsReadOnly<T> extends true ? true : never;
										/** A human-readable label for the field (usually shown above an input) */
										label: T extends { _: { label: infer LabelText extends string } }
											? LabelText
											: never;
										/** A placeholder string for the field (usually a lighter color text in the Input box) */
										placeholder: T extends {
											_: { placeholder: infer PlaceholderText extends string };
										}
											? PlaceholderText
											: never;
									}>;
							}>
						: /** The field is a number type so add the necessary number input props */
							TypeString extends 'number'
							? Flatten<{
									_: BaseFormFieldProps<FieldName> &
										OmitNeverProperties<{
											/** The type of value that the input element accepts */
											type: 'number';
											/** The maximum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
											max?: number;
											/** The minimum value the input can be. Only valid for certain inputs - like numbers, dates, etc */
											min?: number;
											/** The amount the number should be increased/decreased with each 'step' */
											step?: number;
											/** Whether the field is required */
											required: IsOptional<T> extends true ? never : true;
											/** Whether the field is read-only (shows the current value, but disables editing) */
											readonly: IsReadOnly<T> extends true ? true : never;
											/** A human-readable label for the field (usually shown above an input) */
											label: T extends { _: { label: infer LabelText extends string } }
												? LabelText
												: never;
											/** A placeholder string for the field (usually a lighter color text in the Input box) */
											placeholder: T extends {
												_: { placeholder: infer PlaceholderText extends string };
											}
												? PlaceholderText
												: never;
										}>;
								}>
							: /** The field is a boolean type so add the necessary boolean input props */
								TypeString extends 'boolean'
								? Flatten<{
										_: BaseFormFieldProps<FieldName> &
											OmitNeverProperties<{
												/** The type of value that the input element accepts */
												type: 'boolean';
												/** Whether the field is required */
												required: IsOptional<T> extends true ? never : true;
												/** Whether the field is read-only (shows the current value, but disables editing) */
												readonly: IsReadOnly<T> extends true ? true : never;
												/** A human-readable label for the field (usually shown above an input) */
												label: T extends { _: { label: infer LabelText extends string } }
													? LabelText
													: never;
												/** A placeholder string for the field (usually a lighter color text in the Input box) */
												placeholder: T extends {
													_: { placeholder: infer PlaceholderText extends string };
												}
													? PlaceholderText
													: never;
											}>;
									}>
								: /** The field is a string type so add the necessary string input props */
									TypeString extends 'string'
									? Flatten<{
											_: BaseFormFieldProps<FieldName> &
												OmitNeverProperties<{
													/** The type of value that the input element accepts */
													type: StringFieldInputType<T['_']>;
													/** The maximum number of characters the input string can be. */
													maxlength?: number;
													/** The minimum number of characters the input string can be. */
													minlength?: number;
													/** The regular expression the input must match (handled by the native browser input) */
													pattern?: string;
													/** Whether the field is required */
													required: IsOptional<T> extends true ? never : true;
													/** Whether the field is read-only (shows the current value, but disables editing) */
													readonly: IsReadOnly<T> extends true ? true : never;
													/** A human-readable label for the field (usually shown above an input) */
													label: T extends {
														_: { label: infer LabelText extends string };
													}
														? LabelText
														: never;
													/** A placeholder string for the field (usually a lighter color text in the Input box) */
													placeholder: T extends {
														_: { placeholder: infer PlaceholderText extends string };
													}
														? PlaceholderText
														: never;
												}>;
										}>
									: never
			: never
		: /** FieldName is undefined, so this is the root. We need create an object with all deeply nested keys */
			T extends Record<string, any>
			? NeverIfEmptyObject<
					ExtractFormFieldProps<
						FlattenFormFieldProps<
							OmitNeverProperties<{
								[Key in keyof T & string]: FormFieldProps<T[Key], Key>;
							}>
						>
					>
				>
			: never;

type SqliteForeignKeyAction =
	| 'CASCADE'
	| 'SET NULL'
	| 'RESTRICT'
	| 'NO ACTION'
	| 'SET DEFAULT';

type SqliteColumnType<Schema extends FieldGenerator> =
	IsBoolean<Schema> extends true
		? 'BOOLEAN'
		: IsInteger<Schema> extends true
			? 'INTEGER'
			: IsNumber<Schema> extends true
				? 'NUMERIC'
				: IsString<Schema> extends true
					? 'TEXT'
					: IsEnum<Schema> extends true
						? 'TEXT'
						: never;

type SqliteColumnConstraint<Schema extends FieldGenerator> =
	IsPrimaryKey<Schema> extends true
		? 'PRIMARY KEY'
		: IsUnique<Schema> extends true
			? 'UNIQUE'
			: IsOptional<Schema> extends false
				? 'NOT NULL'
				: never;

type SqliteColumnForeignKeyConstraint<Schema extends FieldGenerator> = Schema extends {
	readonly _: {
		foreignKey: {
			type: infer KeyType extends 'string' | 'number';
			table: infer TableName extends string;
			column: infer ColumnName extends string;
			on_update?: infer OnUpdate extends SqliteForeignKeyAction | undefined;
			on_delete?: infer OnDelete extends SqliteForeignKeyAction | undefined;
		};
	};
}
	? OnUpdate extends SqliteForeignKeyAction
		? OnDelete extends SqliteForeignKeyAction
			? `REFERENCES ${TableName}(${ColumnName}) ON UPDATE ${OnUpdate} ON DELETE ${OnDelete}`
			: `REFERENCES ${TableName}(${ColumnName}) ON UPDATE ${OnUpdate}`
		: OnDelete extends SqliteForeignKeyAction
			? `REFERENCES ${TableName}(${ColumnName}) ON DELETE ${OnDelete}`
			: `REFERENCES ${TableName}(${ColumnName})`
	: never;

type SqliteColumnDefinition<Schema extends FieldGenerator> =
	`${SqliteColumnType<Schema>}${SqliteColumnConstraint<Schema> extends never ? '' : ` ${SqliteColumnConstraint<Schema>}`}${SqliteColumnForeignKeyConstraint<Schema> extends never ? '' : ` ${SqliteColumnForeignKeyConstraint<Schema>}`}`;

type SqliteTableDefinition<Schema extends Record<string, FieldGenerator>> = Flatten<
	OmitNeverProperties<{
		[Key in keyof Schema | 'json' | 'created_at' | 'updated_at']: Key extends keyof Schema
			? SqliteColumnDefinition<Schema[Key]>
			: Key extends 'json'
				? 'TEXT'
				: 'INTEGER NOT NULL';
	}>
>;

/** Helper functions for defining attributes & validators for string fields */
class StringFieldGenerator {
	readonly _: StringField;

	constructor() {
		this._ = {
			type: 'string',
			schema: z.string(),
		};
	}

	/** Whether the field can be fuzzy searched and indexed by orama. If 'primary' is true, this is ignored */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		this._.searchable = true;
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Whether the field should be indexed by sqlite. If 'primary' is true, this is ignored */
	indexable(indexOptions?: {
		/** The name of the index to create in sqlite. @defaults to 'idx_<table_name>_<field_name>' */
		name?: string;
		/** Whether the index should be unique */
		unique?: boolean;
		/** Whether the index should be created in descending order */
		descending?: boolean;
		/** Additional columns to include in the index (for covering indexes) */
		additional_columns?: { column: string; descending?: boolean }[];
	}): Omit<Indexable<this>, 'indexable'> {
		this._.indexable = true;
		(this._ as IndexableField).index = indexOptions;
		return this as Omit<Indexable<this>, 'indexable'>;
	}

	/** Whether the field must be unique in the table. This is ignored if 'primary' is true */
	unique(): Omit<Unique<this>, 'unique'> {
		this._.unique = true;
		return this as Omit<Unique<this>, 'unique'>;
	}

	/** Whether the field can be used for sorting results */
	sortable(): Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'> {
		this._.sortable = true;
		this._.searchable = true;
		return this as Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'>;
	}

	/** Validates that the string is a valid base64 encoded string */
	base64(): Omit<FormattedString<this, 'base64'>, StringFieldFormat> {
		this._.format = 'base64';
		this._.schema = z.base64();
		return this as Omit<FormattedString<this, 'base64'>, StringFieldFormat>;
	}

	/**
	 * Validates that the string represents a color string with a #hex format
	 * This also marks the field as a color picker in the UI.
	 */
	color(): Omit<FormattedString<this, 'color'>, StringFieldFormat> {
		this._.schema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
		this._.format = 'color';
		return this as Omit<FormattedString<this, 'color'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid ISO 8601 datetime string */
	datetime(
		...options: Parameters<typeof z.iso.datetime>
	): Omit<FormattedString<this, 'datetime'>, StringFieldFormat> {
		this._.format = 'datetime';
		this._.schema = z.iso.datetime(...options);
		return this as Omit<FormattedString<this, 'datetime'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid ISO date string (YYYY-MM-DD) */
	date(
		...options: Parameters<typeof z.iso.date>
	): Omit<FormattedString<this, 'date'>, StringFieldFormat> {
		this._.format = 'date';
		this._.schema = z.iso.date(...options);
		return this as Omit<FormattedString<this, 'date'>, StringFieldFormat>;
	}

	/** Calls the zod.string().default() method with the given options */
	default(def: z.util.NoUndefined<string>): Omit<this, 'default'>;
	default(def: () => z.util.NoUndefined<string>): Omit<this, 'default'>;
	default(def: any): Omit<this, 'default'> {
		this._.schema = this._.schema.default(def) as any;
		return this as Omit<this, 'default'>;
	}

	/** Validates that the string is a valid email address (matches gmail's regex) */
	email(
		...options: Parameters<typeof z.email>
	): Omit<FormattedString<this, 'email'>, StringFieldFormat> {
		this._.format = 'email';
		this._.schema = z.email(...options);
		return this as Omit<FormattedString<this, 'email'>, StringFieldFormat>;
	}

	/** Calls the zod.string().endsWith() method with the given options */
	endsWith(...options: Parameters<z.ZodString['endsWith']>): Omit<this, 'endsWith'> {
		this._.schema = this._.schema.endsWith(...options);
		return this as Omit<this, 'endsWith'>;
	}

	/** Calls the zod.string().includes() method with the given options */
	includes(...options: Parameters<z.ZodString['includes']>): Omit<this, 'includes'> {
		this._.schema = this._.schema.includes(...options);
		return this as Omit<this, 'includes'>;
	}

	/** Validates that the string is a valid IPv4 address */
	ipv4(
		...options: Parameters<typeof z.ipv4>
	): Omit<FormattedString<this, 'ipv4'>, StringFieldFormat> {
		this._.format = 'ipv4';
		this._.schema = z.ipv4(...options);
		return this as Omit<FormattedString<this, 'ipv4'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid IPv6 address */
	ipv6(
		...options: Parameters<typeof z.ipv6>
	): Omit<FormattedString<this, 'ipv6'>, StringFieldFormat> {
		this._.format = 'ipv6';
		this._.schema = z.ipv6(...options);
		return this as Omit<FormattedString<this, 'ipv6'>, StringFieldFormat>;
	}

	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) {
			(this as Label<this, LabelText>)._.label = text;
		}
		return this as Omit<Label<this, LabelText>, 'label'>;
	}

	/** Calls the zod.string().length() method which validates the length of the string */
	length(...options: Parameters<z.ZodString['length']>): Omit<this, 'length'> {
		this._.schema = this._.schema.length(...options);
		return this as Omit<this, 'length'>;
	}

	/** Calls the zod.string().lowercase() method which checks if the string is lowercase */
	lowercase(...options: Parameters<z.ZodString['lowercase']>): Omit<this, 'lowercase'> {
		this._.schema = this._.schema.lowercase(...options);
		return this as Omit<this, 'lowercase'>;
	}

	/** Calls the zod.string().max() method which checks the maximum length of the string */
	max(...options: Parameters<z.ZodString['max']>): Omit<this, 'max'> {
		if (options[0] >= 0) {
			this._.schema = this._.schema.max(...options);
			this._.maxlength = options[0];
		}
		return this as Omit<this, 'max'>;
	}

	/** Calls the zod.string().min() method which checks the minimum length of the string */
	min(...options: Parameters<z.ZodString['min']>): Omit<this, 'min'> {
		if (options[0] >= 0) {
			this._.schema = this._.schema.min(...options);
			this._.minlength = options[0];
		}
		return this as Omit<this, 'min'>;
	}

	/** Calls the zod.string().nonempty() method which checks if the string is non-empty */
	nonempty(...options: Parameters<z.ZodString['nonempty']>): Omit<this, 'nonempty'> {
		this._.schema = this._.schema.nonempty(...options);
		return this as Omit<this, 'nonempty'>;
	}

	/** Calls the zod.string().normalize() method which normalizes the unicode characters in the string */
	normalize(...options: Parameters<z.ZodString['normalize']>): Omit<this, 'normalize'> {
		this._.schema = this._.schema.normalize(...options);
		return this as Omit<this, 'normalize'>;
	}

	/**
	 * Calls the zod.string().optional() method which marks the string as optional.
	 * Since we are using sqlite, optional strings will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional strings already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'>;
	}

	/** Marks the field as a password input (which replaces the text with *). This doesn't affect validation. */
	password(): Omit<FormattedString<this, 'password'>, 'password'> {
		this._.format = 'password';
		return this as Omit<FormattedString<this, 'password'>, 'password'>;
	}

	/** Marks the field as a phone number input (which may apply specific formatting). This doesn't affect validation. */
	phone(): Omit<FormattedString<this, 'phone'>, 'phone'> {
		this._.format = 'phone';
		return this as Omit<FormattedString<this, 'phone'>, 'phone'>;
	}

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/** Calls the zod.string().prefault() method with the given options */
	prefault(def: z.util.NoUndefined<string>): Omit<this, 'prefault'>;
	prefault(def: () => z.util.NoUndefined<string>): Omit<this, 'prefault'>;
	prefault(def: any): Omit<this, 'prefault'> {
		this._.schema = this._.schema.prefault(def) as any;
		return this as Omit<this, 'prefault'>;
	}

	/**
	 * Calls the zod.string().readonly() method which marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}

	/** Calls the zod.string().refine() method with the given options */
	refine(...options: Parameters<z.ZodString['refine']>): Omit<this, 'refine'> {
		this._.schema = this._.schema.refine(...options);
		return this as Omit<this, 'refine'>;
	}

	/** Calls the zod.string().regex() method which will validate the string against the given regular expression */
	regex(...options: Parameters<z.ZodString['regex']>): Omit<this, 'regex'> {
		this._.schema = this._.schema.regex(...options);
		this._.pattern = options[0].source;
		return this as Omit<this, 'regex'>;
	}

	/** Calls the zod.string().startsWith() method which will ensure the string starts with the given prefix */
	startsWith(
		...options: Parameters<z.ZodString['startsWith']>
	): Omit<this, 'startsWith'> {
		this._.schema = this._.schema.startsWith(...options);
		return this as Omit<this, 'startsWith'>;
	}

	/** Calls the zod.string().superRefine() method with the given options */
	superRefine(
		...options: Parameters<z.ZodString['superRefine']>
	): Omit<this, 'superRefine'> {
		this._.schema = this._.schema.superRefine(...options);
		return this as Omit<this, 'superRefine'>;
	}

	/** Marks the field as a textarea input instead of a regular text input. This doesn't affect validation. */
	textarea(): Omit<TextareaString<this>, 'textarea'> {
		this._.textarea = true;
		return this as Omit<TextareaString<this>, 'textarea'>;
	}

	/** Validates that the string is a valid ISO time string (HH:MM[:SS[.s+]]) */
	time(
		...options: Parameters<typeof z.iso.time>
	): Omit<FormattedString<this, 'time'>, StringFieldFormat> {
		this._.format = 'time';
		this._.schema = z.iso.time(...options);
		return this as Omit<FormattedString<this, 'time'>, StringFieldFormat>;
	}

	/** Calls the zod.string().toLowerCase() method which will transform the string to lowercase */
	toLowerCase(
		...options: Parameters<z.ZodString['toLowerCase']>
	): Omit<this, 'toLowerCase'> {
		this._.schema = this._.schema.toLowerCase(...options);
		return this as Omit<this, 'toLowerCase'>;
	}

	/** Calls the zod.string().toUpperCase() method which will transform the string to uppercase */
	toUpperCase(
		...options: Parameters<z.ZodString['toUpperCase']>
	): Omit<this, 'toUpperCase'> {
		this._.schema = this._.schema.toUpperCase(...options);
		return this as Omit<this, 'toUpperCase'>;
	}

	/** Transforms the input string into an output string using the given transformation function */
	transform(transformer: (val: any) => string): Omit<this, 'transform'> {
		this._.schema = this._.schema.transform(transformer) as any;
		return this as Omit<this, 'transform'>;
	}

	/** Calls the zod.string().trim() method which will trim whitespace from both ends of the string */
	trim(...options: Parameters<z.ZodString['trim']>): Omit<this, 'trim'> {
		this._.schema = this._.schema.trim(...options);
		return this as Omit<this, 'trim'>;
	}

	/** Validates that the string is a valid UUID */
	uuid(
		...options: Parameters<typeof z.uuid>
	): Omit<FormattedString<this, 'uuid'>, StringFieldFormat> {
		this._.format = 'uuid';
		this._.schema = z.uuid(...options);
		return this as Omit<FormattedString<this, 'uuid'>, StringFieldFormat>;
	}

	/** Calls the zod.string().uppercase() method which checks if the string is uppercase */
	uppercase(...options: Parameters<z.ZodString['uppercase']>): Omit<this, 'uppercase'> {
		this._.schema = this._.schema.uppercase(...options);
		return this as Omit<this, 'uppercase'>;
	}

	/** Validates that the string is a valid URL */
	url(
		...options: Parameters<typeof z.url>
	): Omit<FormattedString<this, 'url'>, StringFieldFormat> {
		this._.format = 'url';
		this._.schema = z.url(...options);
		return this as Omit<FormattedString<this, 'url'>, StringFieldFormat>;
	}
}

/** Helper functions for defining attributes & validators for number fields */
class NumberFieldGenerator {
	readonly _: NumberField;
	constructor() {
		this._ = {
			type: 'number',
			schema: z.number(),
		};
	}

	/** Whether the field can be fuzzy searched and indexed by orama. */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		this._.searchable = true;
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Whether the field should be indexed by sqlite. */
	indexable(indexOptions?: {
		/** The name of the index to create in sqlite. @defaults to 'idx_<table_name>_<field_name>' */
		name?: string;
		/** Whether the index should be unique */
		unique?: boolean;
		/** Whether the index should be created in descending order */
		descending?: boolean;
		/** Additional columns to include in the index (for covering indexes) */
		additional_columns?: { column: string; descending?: boolean }[];
	}): Omit<Indexable<this>, 'indexable'> {
		this._.indexable = true;
		(this._ as IndexableField).index = indexOptions;
		return this as Omit<Indexable<this>, 'indexable'>;
	}

	/** Whether the field must be unique in the table */
	unique(): Omit<Unique<this>, 'unique'> {
		this._.unique = true;
		return this as Omit<Unique<this>, 'unique'>;
	}

	/** Whether the field can be used for sorting results */
	sortable(): Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'> {
		this._.sortable = true;
		this._.searchable = true;
		return this as Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'>;
	}

	/** Calls the zod.number().default() method with the given options */
	default(def: z.util.NoUndefined<number>): Omit<this, 'default'>;
	default(def: () => z.util.NoUndefined<number>): Omit<this, 'default'>;
	default(def: any): Omit<this, 'default'> {
		this._.schema = this._.schema.default(def) as any;
		return this as Omit<this, 'default'>;
	}

	/** Calls the zod.number().gt() method which ensures the number is greater than the given value */
	gt(...options: Parameters<z.ZodNumber['gt']>): Omit<this, 'min' | 'gt' | 'gte'> {
		this._.schema = this._.schema.gt(...options);
		this._.min = Math.max(this._.min ?? -Infinity, options[0] + Number.EPSILON);
		return this as Omit<this, 'min' | 'gt' | 'gte'>;
	}

	/** Calls the zod.number().gte() method which ensures the number is greater than or equal to the given value */
	gte(...options: Parameters<z.ZodNumber['gte']>): Omit<this, 'min' | 'gt' | 'gte'> {
		this._.schema = this._.schema.gte(...options);
		this._.min = Math.max(this._.min ?? -Infinity, options[0]);
		return this as Omit<this, 'min' | 'gt' | 'gte'>;
	}

	/** Calls the zod.number().int() method which ensures the number is an integer */
	int(...options: Parameters<z.ZodNumber['int']>): Omit<IntegerValue<this>, 'int'> {
		this._.schema = this._.schema.int(...options);
		this._.integer = true;
		return this as Omit<IntegerValue<this>, 'int'>;
	}

	/** Calls the zod.number().max() method which ensures the number is less than or equal to the given value */
	max(...options: Parameters<z.ZodNumber['max']>): Omit<this, 'max' | 'lt' | 'lte'> {
		this._.schema = this._.schema.max(...options);
		this._.max = Math.min(this._.max ?? Infinity, options[0]);
		return this as Omit<this, 'max' | 'lt' | 'lte'>;
	}

	/** Calls the zod.number().min() method which ensures the number is greater than or equal to the given value */
	min(...options: Parameters<z.ZodNumber['min']>): Omit<this, 'min' | 'gt' | 'gte'> {
		this._.schema = this._.schema.min(...options);
		this._.min = Math.max(this._.min ?? -Infinity, options[0]);
		return this as Omit<this, 'min' | 'gt' | 'gte'>;
	}

	/** Calls the zod.number().multipleOf() method which ensures the number is a multiple of the given value */
	multipleOf(
		...options: Parameters<z.ZodNumber['multipleOf']>
	): Omit<this, 'multipleOf'> {
		this._.schema = this._.schema.multipleOf(...options);
		this._.step = options[0];
		return this as Omit<this, 'multipleOf'>;
	}

	/** Calls the zod.number().min() method which ensures the number is less than 0 */
	negative(...options: Parameters<z.ZodNumber['negative']>): Omit<this, 'negative'> {
		this._.schema = this._.schema.negative(...options);
		this._.max = Math.min(this._.max ?? Infinity, 0 - Number.EPSILON);
		return this as Omit<this, 'negative'>;
	}

	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) {
			(this as Label<this, LabelText>)._.label = text;
		}
		return this as Omit<Label<this, LabelText>, 'label'>;
	}

	/** Calls the zod.number().lt() method which ensures the number is less than the given value */
	lt(...options: Parameters<z.ZodNumber['lt']>): Omit<this, 'max' | 'lt' | 'lte'> {
		this._.schema = this._.schema.lt(...options);
		this._.max = Math.min(this._.max ?? Infinity, options[0] - Number.EPSILON);
		return this as Omit<this, 'max' | 'lt' | 'lte'>;
	}

	/** Calls the zod.number().lte() method which ensures the number is less than or equal to the given value */
	lte(...options: Parameters<z.ZodNumber['lte']>): Omit<this, 'max' | 'lt' | 'lte'> {
		this._.schema = this._.schema.lte(...options);
		this._.max = Math.min(this._.max ?? Infinity, options[0]);
		return this as Omit<this, 'max' | 'lt' | 'lte'>;
	}

	/**
	 * Calls the zod.number().optional() method which marks the number as optional.
	 * Since we are using sqlite, optional numbers will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional numbers already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'>;
	}

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/** Calls the zod.number().positive() method which ensures the number is positive */
	positive(...options: Parameters<z.ZodNumber['positive']>): Omit<this, 'positive'> {
		this._.schema = this._.schema.positive(...options);
		this._.min = Math.max(this._.min ?? -Infinity, 0 + Number.EPSILON);
		return this as Omit<this, 'positive'>;
	}

	/** Calls the zod.number().prefault() method with the given options */
	prefault(def: z.util.NoUndefined<number>): Omit<this, 'prefault'>;
	prefault(def: () => z.util.NoUndefined<number>): Omit<this, 'prefault'>;
	prefault(def: any): Omit<this, 'prefault'> {
		this._.schema = this._.schema.prefault(def) as any;
		return this as Omit<this, 'prefault'>;
	}

	/**
	 * Calls the zod.number().readonly() method which marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

/** Helper functions for defining attributes & validators for boolean fields */
class BooleanFieldGenerator {
	readonly _: BooleanField;

	constructor() {
		this._ = {
			type: 'boolean',
			schema: z.boolean(),
		};
	}

	/** Whether the field can be fuzzy searched and indexed by orama. */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		this._.searchable = true;
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Whether the field can be used for sorting results */
	sortable(): Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'> {
		this._.sortable = true;
		this._.searchable = true;
		return this as Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'>;
	}

	/** Calls the zod.boolean().default() method with the given options */
	default(def: z.util.NoUndefined<boolean>): Omit<this, 'default'>;
	default(def: () => z.util.NoUndefined<boolean>): Omit<this, 'default'>;
	default(def: any): Omit<this, 'default'> {
		this._.schema = this._.schema.default(def) as any;
		return this as Omit<this, 'default'>;
	}

	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) {
			(this as Label<this, LabelText>)._.label = text;
		}
		return this as Omit<Label<this, LabelText>, 'label'>;
	}

	/**
	 * Calls the zod.boolean().optional() method which marks the boolean as optional.
	 * Since we are using sqlite, optional booleans will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional booleans already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional'>;
	}

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/** Calls the zod.boolean().prefault() method with the given options */
	prefault(def: z.util.NoUndefined<boolean>): Omit<this, 'prefault'>;
	prefault(def: () => z.util.NoUndefined<boolean>): Omit<this, 'prefault'>;
	prefault(def: any): Omit<this, 'prefault'> {
		this._.schema = this._.schema.prefault(def) as any;
		return this as Omit<this, 'prefault'>;
	}

	/**
	 * Calls the zod.boolean().readonly() method which marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

class EnumFieldGenerator<Options extends string[]> {
	readonly _: EnumField<Options>;

	constructor(options: Options) {
		if (!options.length) {
			throw new Error('schema.enum() requires at least one option');
		}
		this._ = {
			type: 'enum',
			options,
			schema: z.enum(options),
		};
	}

	/** Whether the field can be fuzzy searched and indexed by orama. */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		this._.searchable = true;
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Calls the zod.enum().default() method with the given options */
	default(def: Options[number]): Omit<this, 'default'>;
	default(def: () => Options[number]): Omit<this, 'default'>;
	default(def: any): Omit<this, 'default'> {
		this._.schema = this._.schema.default(def) as any;
		return this as Omit<this, 'default'>;
	}

	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) {
			(this as Label<this, LabelText>)._.label = text;
		}
		return this as Omit<Label<this, LabelText>, 'label'>;
	}

	/**
	 * Calls the zod.enum().optional() method which marks the enum as optional.
	 * Since we are using sqlite, optional enums will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional enums already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'>;
	}

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

class VectorFieldGenerator {
	readonly _: VectorField;

	constructor(size?: number) {
		const dimensions = size ?? 0;
		this._ = {
			type: 'vector',
			dimensions,
			searchable: true,
			schema:
				dimensions > 0
					? (z.array(z.number()).length(dimensions) as any)
					: (z.array(z.number()) as any),
		};
	}

	/** Sets the size (number of dimensions) of the vector */
	size(dimensions: number): Omit<this, 'size'> {
		this._.dimensions = dimensions;
		this._.schema = z.array(z.number()).length(dimensions) as any;
		return this as Omit<this, 'size'>;
	}

	/**
	 * Marks the vector as optional (nullable).
	 * Since we are using sqlite, optional vectors will be stored as NULL in the database.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

class GeopointFieldGenerator {
	readonly _: GeopointField;

	constructor() {
		this._ = {
			type: 'geopoint',
			searchable: true,
			schema: z.object({
				lat: z.number().min(-90).max(90),
				lon: z.number().min(-180).max(180),
			}),
		};
	}

	/**
	 * Marks the field as optional (nullable).
	 * Since we are using sqlite, optional geopoints will be stored as NULL in the database.
	 */
	optional(): Omit<OptionalValue<this>, 'optional'> {
		this._.optional = true;
		this._.schema = this._.schema.optional().nullable() as any;
		return this as Omit<OptionalValue<this>, 'optional'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		this._.schema = this._.schema.readonly() as any;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

/**
 * Marks the field as a database primary key.
 * If the type is 'string', a random string will be generated for each new row (unless a value is provided).
 * If the type is 'number', an auto-incrementing integer will be used as the primary key.
 */
class PrimaryKeyGenerator<Type extends 'string' | 'number' = 'string'> {
	readonly _: PrimaryKeyField<Type>;

	constructor(options?: { type?: Type }) {
		this._ = {
			type: 'primary_key',
			readonly: true,
			searchable: true,
			primary_key: {
				type: (options?.type ?? 'string') as Type,
			},
		};
	}

	/** Whether the field can be used for sorting results */
	sortable(): Omit<Sortable<this>, 'sortable'> {
		this._.sortable = true;
		return this as Sortable<typeof this>;
	}
}

class ForeignKeyFieldGenerator {
	readonly _: ForeignKeyField;

	constructor(options: {
		/** The type of the field that this foreign key references */
		type: 'string' | 'number';
		/** The name of the table this field references */
		table: string;
		/** The name of the column in the referenced table @example 'id' */
		column: string;
		/** The action to take when the referenced row is updated */
		on_update?: SqliteForeignKeyAction;
		/** The action to take when the referenced row is deleted */
		on_delete?: SqliteForeignKeyAction;
	}) {
		this._ = {
			type: 'foreign_key',
			foreign_key: {
				type: options.type,
				table: options.table,
				column: options.column,
				on_update: options.on_update,
				on_delete: options.on_delete,
			},
		};
	}

	/** Whether the field can be fuzzy searched and indexed by orama. */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		this._.searchable = true;
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Whether the field can be used for sorting results */
	sortable(): Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'> {
		this._.sortable = true;
		this._.searchable = true;
		return this as Omit<Searchable<Sortable<this>>, 'sortable' | 'searchable'>;
	}

	/**
	 * Calls the zod.foreignKey().optional() method which marks the foreign key as optional.
	 * Since we are using sqlite, optional foreign keys will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional foreign keys already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'> {
		this._.optional = true;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique' | 'primary'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}

	/** Sets an action to occur when the referenced row is updated */
	onUpdate<UpdateAction extends SqliteForeignKeyAction>(
		action: UpdateAction,
	): Omit<
		ForeignKey<
			this,
			this['_']['foreign_key']['type'],
			this['_']['foreign_key']['table'],
			this['_']['foreign_key']['column'],
			UpdateAction,
			this['_']['foreign_key']['on_delete']
		>,
		'onUpdate'
	> {
		this._.foreign_key.on_update = action;
		return this as Omit<
			ForeignKey<
				this,
				this['_']['foreign_key']['type'],
				this['_']['foreign_key']['table'],
				this['_']['foreign_key']['column'],
				UpdateAction,
				this['_']['foreign_key']['on_delete']
			>,
			'onUpdate'
		>;
	}

	/** Sets an action to occur when the referenced row is deleted */
	onDelete<DeleteAction extends SqliteForeignKeyAction>(
		action: DeleteAction,
	): Omit<
		ForeignKey<
			this,
			this['_']['foreign_key']['type'],
			this['_']['foreign_key']['table'],
			this['_']['foreign_key']['column'],
			this['_']['foreign_key']['on_update'],
			DeleteAction
		>,
		'onDelete'
	> {
		this._.foreign_key.on_delete = action;
		return this as Omit<
			ForeignKey<
				this,
				this['_']['foreign_key']['type'],
				this['_']['foreign_key']['table'],
				this['_']['foreign_key']['column'],
				this['_']['foreign_key']['on_update'],
				DeleteAction
			>,
			'onDelete'
		>;
	}
}

class ObjectFieldGenerator<Properties extends Record<string, FieldGenerator>> {
	readonly _: ObjectField<Properties>;

	constructor(properties: Properties) {
		this._ = {
			type: 'object',
			properties,
		};
	}

	/**
	 * Marks the object as optional (nullable).
	 * Since we are using sqlite, optional objects will be stored as NULL in the database.
	 */
	optional(): Omit<OptionalValue<this>, 'optional'> {
		this._.optional = true;
		return this as Omit<OptionalValue<this>, 'optional'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

class ArrayFieldGenerator<Items extends FieldGenerator> {
	readonly _: ArrayField<Items>;

	constructor(itemType: Items) {
		this._ = {
			type: 'array',
			items: itemType,
		};
	}

	/**
	 * Marks the field as searchable in orama.
	 * Only simple arrays like string[], number[], and boolean[] can be made searchable.
	 */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		const searchableTypes = ['string', 'number', 'boolean'];
		if (this._.items._.type && searchableTypes.includes(this._.items._.type)) {
			this._.searchable = true;
		}
		return this as Omit<Searchable<this>, 'searchable'>;
	}

	/** Sets the minimum length of the array */
	min(length: number): Omit<this, 'min'> {
		if (length >= 0) {
			this._.min = length;
		}
		return this as Omit<this, 'min'>;
	}

	/** Sets the maximum length of the array */
	max(length: number): Omit<this, 'max'> {
		if (length >= 0) {
			this._.max = length;
		}
		return this as Omit<this, 'max'>;
	}

	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) (this as Label<this, LabelText>)._.label = text;
		return this as Omit<Label<this, LabelText>, 'label'>;
	}

	/**
	 * Marks the array as optional (nullable).
	 * Since we are using sqlite, optional arrays will be stored as NULL in the database.
	 */
	optional(): Omit<OptionalValue<this>, 'optional'> {
		this._.optional = true;
		return this as Omit<OptionalValue<this>, 'optional'>;
	}

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/**
	 * Marks the field as readonly.
	 * If 'readonly' is called, the field cannot be updated after creation.
	 */
	readonly(): Omit<ReadOnly<this>, 'readonly'> {
		this._.readonly = true;
		return this as Omit<ReadOnly<this>, 'readonly'>;
	}
}

/** Helper objects used to generate fields of given types with given properties */
type _FieldGenerator =
	| PrimaryKeyGenerator<any>
	| StringFieldGenerator
	| NumberFieldGenerator
	| BooleanFieldGenerator
	| EnumFieldGenerator<string[]>
	| VectorFieldGenerator
	| ForeignKeyFieldGenerator
	| GeopointFieldGenerator
	| ObjectFieldGenerator<any>
	| ArrayFieldGenerator<any>;

type FieldGenerator = Partial<_FieldGenerator> & { readonly _: any };

/** Helper functions for defining database fields and their attributes/constraints */
class DatabaseGenerator {
	/**
	 * Marks the field as a database primary key.
	 * If the type is 'string', a random string will be generated for each new row (unless a value is provided).
	 * If the type is 'number', an auto-incrementing integer will be used as the primary key.
	 */
	primaryKey<const Type extends 'string' | 'number'>(options?: {
		type?: Type;
	}): ReadOnly<PrimaryKeyGenerator<Type>> {
		return new PrimaryKeyGenerator<Type>(options) as ReadOnly<PrimaryKeyGenerator<Type>>;
	}

	/** Returns a foreign key definition for a database table */
	foreignKey<
		ForeignKeyType extends 'string' | 'number',
		TableName extends string,
		ColumnName extends string,
		OnUpdate extends SqliteForeignKeyAction | undefined = undefined,
		OnDelete extends SqliteForeignKeyAction | undefined = undefined,
	>(options: {
		/** The type of the field that this foreign key references */
		type: ForeignKeyType;
		/** The name of the table this field references */
		table: TableName;
		/** The name of the column in the referenced table @example 'id' */
		column: ColumnName;
		/** The action to take when the referenced row is updated */
		on_update?: OnUpdate;
		/** The action to take when the referenced row is deleted */
		on_delete?: OnDelete;
	}): ForeignKey<
		ForeignKeyFieldGenerator,
		ForeignKeyType,
		TableName,
		ColumnName,
		OnUpdate,
		OnDelete
	> {
		return new ForeignKeyFieldGenerator(options) as ForeignKey<
			ForeignKeyFieldGenerator,
			ForeignKeyType,
			TableName,
			ColumnName,
			OnUpdate,
			OnDelete
		>;
	}

	/**
	 * Defines an object schema for a field within a database table.
	 * Note: since sqlite doesn't support objects, these will be stored as JSON strings in the 'json' column.
	 */
	object<
		Properties extends {
			[Key in keyof Properties]: IsIndexable<Properties[Key]> extends true
				? never
				: IsPrimaryKey<Properties[Key]> extends true
					? never
					: IsUnique<Properties[Key]> extends true
						? never
						: FieldGenerator;
		},
	>(properties: Properties): ObjectFieldGenerator<Properties> {
		return new ObjectFieldGenerator<Properties>(properties);
	}

	/**
	 * Defines an array schema for a field within a database table.
	 * Note: since sqlite doesn't support arrays, these will be stored as JSON strings in the 'json' column.
	 */
	array<
		Items extends IsIndexable<Items> extends true
			? never
			: IsPrimaryKey<Items> extends true
				? never
				: IsUnique<Items> extends true
					? never
					: FieldGenerator,
	>(itemType: Items): ArrayFieldGenerator<Items> {
		return new ArrayFieldGenerator<Items>(itemType);
	}

	/**
	 * Defines a string entry for a field within a database table.
	 * Strings can be indexed and made searchable for fuzzy search.
	 */
	string(): StringFieldGenerator {
		return new StringFieldGenerator();
	}

	/** Defines a number entry for a field within a database table. */
	number(): NumberFieldGenerator {
		return new NumberFieldGenerator();
	}

	/** Defines a boolean entry for a field within a database table. */
	boolean(): BooleanFieldGenerator {
		return new BooleanFieldGenerator();
	}

	/**
	 * Defines a vector entry for a field within a database table.
	 * A vector is an array of numbers with a fixed size (the size given by vectorSize).
	 * Vectors are used for vector search in orama.
	 */
	vector(vectorSize: number): VectorFieldGenerator {
		return new VectorFieldGenerator(vectorSize);
	}

	/** Defines a list of strings that this field can take */
	enum<const Values extends string[]>(values: Values): EnumFieldGenerator<Values> {
		return new EnumFieldGenerator<Values>(values);
	}

	/** Defines a geopoint type which can be used for location based searching */
	geopoint(): GeopointFieldGenerator {
		return new GeopointFieldGenerator();
	}
}

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
					// Mark readonly fields as readonly in the resulting type
					readonly [Key in keyof Table['_'] as IsReadOnly<Table['_'][Key]> extends true
						? Key
						: never]: FieldType<Table['_'][Key]> extends infer FieldTypeValue
						? IsOptional<Table['_'][Key]> extends true
							? FieldTypeValue | undefined | null
							: FieldTypeValue
						: never;
				} & {
					// Keep non-readonly fields as normal (not readonly) in the resulting type
					[Key in keyof Table['_'] as IsReadOnly<Table['_'][Key]> extends true
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

	/** Infers the type of the schema used to initialize the search library Orama */
	export type SearchSchema<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = Flatten<
		OmitNeverProperties<{
			[Key in keyof Table['_']]: OramaType<Table['_'][Key]>;
		}> & {
			/** Timestamps are stored as epoch numbers in the Orama search index */
			created_at: 'number';
			updated_at: 'number';
		}
	>;

	/** The type used to initialize the orama library using orama({...}) */
	export type SearchConfig<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = {
		/** The schema used to initialize the orama library */
		schema: SearchSchema<Table>;
		/** The configuration for sorting search results */
		sort: SorterConfig;
		/** Custom orama components (e.g., getDocumentIndexId for custom primary key fields) */
		components: {
			getDocumentIndexId: (doc: Record<string, any>) => string;
		};
	};

	/** Infers the shape of the documents returned by the search library */
	export type SearchEntity<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		OramaSchemaConfig extends AnySchema = SearchSchema<Table>,
		PrimaryKeyColumn extends keyof Table['_'] = {
			[Key in keyof Table['_']]: IsPrimaryKey<Table['_'][Key]> extends true ? Key : never;
		}[keyof Table['_']],
	> = Partial<TypedDocument<Orama<OramaSchemaConfig>>> & {
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
	 * This is the direct input of the `search` method in Orama.
	 */
	export type SearchQuery<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
		OramaSchemaConfig extends AnySchema = SearchSchema<Table>,
		OramaSchema extends AnyOrama = Orama<OramaSchemaConfig>,
	> = Pick<SearchParams<OramaSchema>, 'facets' | 'limit' | 'term' | 'where' | 'offset'> &
		Pick<
			SearchParamsFullText<OramaSchema>,
			'boost' | 'distinctOn' | 'exact' | 'properties' | 'threshold' | 'tolerance'
		> &
		Pick<SearchParamsVector<OramaSchema>, 'vector'> & {
			/**
			 * Whether only the sparse 'searchable' fields should be returned.
			 * If this is false, all fields from sqlite will be returned (including those stored in the 'json' column).
			 * If this is true, only fields indexed by orama will be returned.
			 * @default true
			 */
			sparse?: boolean;

			/**
			 * A cursor to continue fetching results from a previous query.
			 * If this is provided, all other query parameters (term, where, limit, order, etc.) will be ignored.
			 */
			cursor?: string;

			/** How the results should be ordered. Multiple orderings can be specified to determine the sorting precedence */
			order?: {
				/** The key (field) to sort by */
				key: string;
				/** The direction to sort by (ascending or descending) @default ASC */
				direction?: 'ASC' | 'DESC';
			}[];
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
		Data extends Query['sparse'] extends false
			? Entity<Table>
			: SearchEntity<Table> = Query['sparse'] extends false
			? Entity<Table>
			: SearchEntity<Table>,
	> = Pick<Results<Data>, 'count' | 'elapsed' | 'facets' | 'hits'> & {
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
					: FieldType<Table['_'][Key]> extends infer FieldTypeValue
						? FieldTypeValue extends string | boolean | number
							? FieldTypeValue
							: never
						: never;
		}>
	>;

	/**
	 * Infers the SQLite table definition for a database table (created via the `table` function)
	 * This is used to create or update the actual table columns in SQLite.
	 */
	export type SqlTableConfig<
		Table extends {
			readonly _: Record<string, FieldGenerator>;
		},
	> = SqliteTableDefinition<Table['_']>;

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

	/** The type returned by the `table` function */
	export type Table = ReturnType<typeof table>;

	/** Defines a database table schema using the provided callback function */
	export function table<
		TableName extends string,
		TableConfig extends Record<string, FieldGenerator>,
		Entity extends Database.Entity<{ readonly _: TableConfig }>,
		SearchEntity extends Database.SearchEntity<{ readonly _: TableConfig }>,
		OramaConfig extends Database.SearchConfig<{ readonly _: TableConfig }>,
		ForeignKeys extends Flatten<
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
		>,
		Table extends {
			/** @private A reference to the table's shape (used only for typescript types) */
			readonly _: TableConfig;

			/** The name of the table. Can only contain alphanumeric characters and underscores. */
			name: TableName;

			/**
			 * Parses & validates the given data against the table's shape
			 * @throws an error if the data is invalid
			 */
			parse(data: any): Entity;

			/** Converts the given entity data to a sparse search entity used by the orama search index */
			toSparse(data: Entity): SearchEntity;

			/** The form properties for the table used when editing a table record in an html form */
			form: {
				/** The form properties for each field that can be spread onto an html element for that field */
				field: FormFieldProps<TableConfig>;
			};

			/** The table's config used to setup sqlite and orama */
			config: {
				/** The primary key for the table */
				primary_key: PrimaryKeyColumn;
				/** The type of the primary key ('string' for TEXT, 'number' for INTEGER) */
				primary_key_type: 'string' | 'number';
				/** The list of fields that will have indexes created in sqlite */
				indexable_fields: IndexableColumn[];
				/** The list of fields that must be unique */
				unique_fields: UniqueColumn[];
				/** The list of fields that can be searched via orama */
				searchable_fields: SearchableColumn[];
				/** The list of fields that can be used for sorting results (via orama) */
				sortable_fields: SortableColumn[];
				/** A record of fields that are foreign keys and reference a different table */
				foreign_keys: ForeignKeys;
				/**
				 * The orama-specific configuration for the table. Sets up an index to fuzzy search the searchable fields.
				 * If no searchable fields are defined, this will be an empty object.
				 */
				orama: OramaConfig;
				/**
				 * The SQLite table schema definition for the generated table.
				 * Fields of type 'object' or 'array' are omitted since they are stored in the 'json' column.
				 * @example { id: 'TEXT PRIMARY KEY', name: 'TEXT', age: 'INTEGER' }
				 */
				table_definition: SqliteTableDefinition<TableConfig>;
				/** The list of indexes to create for the table */
				indexes: SqlIndexes;
			};
		},
		PrimaryKeyColumn extends keyof TableConfig & string = {
			[Key in keyof TableConfig & string]: IsPrimaryKey<TableConfig[Key]> extends true
				? Key
				: never;
		}[keyof TableConfig & string],
		IndexableColumn extends keyof TableConfig & string = {
			[Key in keyof TableConfig & string]: IsIndexable<TableConfig[Key]> extends true
				? Key
				: never;
		}[keyof TableConfig & string],
		SortableColumn extends keyof TableConfig & string = SortableField<{
			readonly _: TableConfig;
		}>,
		SearchableColumn extends keyof TableConfig & string = SearchableField<{
			readonly _: TableConfig;
		}>,
		UniqueColumn extends keyof TableConfig & string = {
			[Key in keyof TableConfig & string]: IsUnique<TableConfig[Key]> extends true
				? Key
				: never;
		}[keyof TableConfig & string],
	>(
		rawTableName: TableName,
		callback: (tableSchema: DatabaseGenerator) => TableConfig,
	): Table {
		const tableName = z
			.string()
			.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
				message:
					'Table name must only contain alphanumeric characters and underscores, and cannot start with a number',
			})
			.parse(rawTableName);

		let primary_key: PrimaryKeyColumn | undefined;
		let primary_key_type: 'string' | 'number' = 'string';
		let indexable_fields: IndexableColumn[] = [];
		let unique_fields: UniqueColumn[] = [];
		let searchable_fields: SearchableColumn[] = [];
		let sortable_fields: SortableColumn[] = [];
		let foreign_keys: ForeignKeys = {} as ForeignKeys;
		const indexes: Table['config']['indexes'] = [];
		const form_field = {} as FormFieldProps<TableConfig>;
		const table_definition = {} as SqliteTableDefinition<TableConfig>;
		const orama_schema = {} as OramaConfig['schema'];
		const orama_sort: OramaConfig['sort'] = {
			enabled: false,
			unsortableProperties: [],
		};

		const generator = new DatabaseGenerator();
		const table_config = callback(generator);

		if (
			typeof table_config !== 'object' ||
			!table_config ||
			!Object.keys(table_config).length ||
			Array.isArray(table_config)
		) {
			throw { message: 'Table schema callback must return a non-empty object' };
		}

		// Validate reserved field names
		if ('created_at' in table_config) {
			throw {
				message: `'created_at' is a reserved field name that is auto-managed by the database. Remove it from your table schema.`,
			};
		}
		if ('updated_at' in table_config) {
			throw {
				message: `'updated_at' is a reserved field name that is auto-managed by the database. Remove it from your table schema.`,
			};
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
				throw {
					message: `Field '${fieldName}' is not a valid field definition. Did you forget to call a field generator method?`,
				};
			}
			const field = fieldDef['_'] as DatabaseField;
			if (field.type === 'primary_key') {
				if (primary_key) {
					throw {
						message: `Table can only have one primary key defined. Fields ${fieldName} and ${primary_key} are both defined as primary keys.`,
					};
				}
			}

			// Handle primary key field
			if (field.type === 'primary_key') {
				primary_key = fieldName as PrimaryKeyColumn;
				primary_key_type = field.primary_key.type;
				(table_definition as any)[fieldName] =
					field.primary_key.type === 'string'
						? 'TEXT PRIMARY KEY'
						: 'INTEGER PRIMARY KEY AUTOINCREMENT';
				(orama_schema as any)[fieldName] =
					field.primary_key.type === 'number' ? 'number' : 'string';
				searchable_fields.push(fieldName as SearchableColumn);
				if ('sortable' in field && field.sortable) {
					sortable_fields.push(fieldName as SortableColumn);
					orama_sort.enabled = true;
				} else {
					orama_sort.unsortableProperties!.push(fieldName);
				}
				continue;
			}

			// Build the indexable fields for sqlite
			if ('indexable' in field && field.indexable) {
				indexable_fields.push(fieldName as IndexableColumn);
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
			let sqliteColumnDef: 'TEXT' | 'INTEGER' | 'NUMERIC' | 'BOOLEAN' = 'TEXT';
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
				unique_fields.push(fieldName as UniqueColumn);
				sqliteColumnDef += ' UNIQUE';
			} else if (!field.optional) {
				sqliteColumnDef += ' NOT NULL';
			}
			if (field.type === 'foreign_key') {
				// Do a sanity check for invalid table names (in the off chance someone puts a bad table name here)
				if (field.foreign_key.table.match(/[^a-zA-Z0-9_]/)) {
					throw {
						message: `Foreign key field '${fieldName}' has an invalid table name '${field.foreign_key.table}'. Table names can only contain alphanumeric characters and underscores.`,
					};
				}
				if (field.foreign_key.column.match(/[^a-zA-Z0-9_]/)) {
					throw {
						message: `Foreign key field '${fieldName}' has an invalid column name '${field.foreign_key.column}'. Column names can only contain alphanumeric characters and underscores.`,
					};
				}
				sqliteColumnDef += ` REFERENCES ${field.foreign_key.table}(${field.foreign_key.column})`;
				if (field.foreign_key.on_update) {
					sqliteColumnDef += ` ON UPDATE ${field.foreign_key.on_update}`;
				}
				if (field.foreign_key.on_delete) {
					sqliteColumnDef += ` ON DELETE ${field.foreign_key.on_delete}`;
				}
				(foreign_keys as any)[fieldName] = {
					type: field.foreign_key.type,
					table: field.foreign_key.table,
					column: field.foreign_key.column,
					on_update: field.foreign_key.on_update,
					on_delete: field.foreign_key.on_delete,
				};
			}
			(table_definition as any)[fieldName] = sqliteColumnDef;

			// Build the orama schema
			function recursivelyBuildOramaSchema(
				subfield: DatabaseField,
				path: string = '',
				force_searchable: boolean = false,
			): AnySchema | SearchableType | undefined {
				if (subfield.type === 'object') {
					const child = Object.entries(subfield.properties).reduce(
						(acc, [childFieldName, childFieldDef]) => {
							const childField = (childFieldDef as any)?.['_'] as DatabaseField;
							if (!childField) return acc;
							const childSchema = recursivelyBuildOramaSchema(
								childField,
								[path, childFieldName].filter(Boolean).join('.'),
								force_searchable || ('searchable' in childField && childField.searchable),
							);
							if (!childSchema) return acc;
							acc[childFieldName] = childSchema;
							return acc;
						},
						{} as Record<string, AnySchema | SearchableType>,
					);
					if (Object.keys(child).length === 0) return undefined;
					return child;
				}

				if (subfield.type === 'array') {
					if (!subfield.searchable || !('items' in subfield)) return;
					const itemType = subfield.items._;
					if (itemType.type === 'string') {
						return 'string[]';
					} else if (itemType.type === 'number') {
						return 'number[]';
					} else if (itemType.type === 'boolean') {
						return 'boolean[]';
					} else if (itemType.type === 'enum') {
						return 'enum[]';
					}
					return;
				}

				if (!subfield.searchable && !force_searchable) return;
				if (path) searchable_fields.push(path as SearchableColumn);
				if ('sortable' in subfield && subfield.sortable) {
					sortable_fields.push(path as SortableColumn);
					orama_sort.enabled = true;
				} else {
					orama_sort.unsortableProperties!.push(path);
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
			const built_schema = recursivelyBuildOramaSchema(field, fieldName);
			if (built_schema) {
				(orama_schema as any)[fieldName] = built_schema;
			}

			// Build the form field properties
			function recursivelyBuildFormFieldProps(subfield: DatabaseField, path: string) {
				if (subfield.type === 'object') {
					for (const [childFieldName, childFieldDef] of Object.entries(
						subfield.properties,
					)) {
						const childField = (childFieldDef as any)?.['_'] as DatabaseField;
						if (!childField) continue;
						recursivelyBuildFormFieldProps(
							childField,
							[path, childFieldName].filter(Boolean).join('.'),
						);
					}
					return;
				}
				if (subfield.type === 'array') {
					if (subfield.items && subfield.items._) {
						const itemField = subfield.items._ as DatabaseField;
						recursivelyBuildFormFieldProps(itemField, `${path}[]`);
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
				const field_props: GenericFormFieldProps = {
					name: path,
					type: 'text',
					readonly: subfield.readonly,
					required: !subfield.optional,
					label: 'label' in subfield ? (subfield as any).label : undefined,
					placeholder:
						'placeholder' in subfield ? (subfield as any).placeholder : undefined,
					parse: (value) => {
						if ('schema' in subfield && subfield.schema) {
							return subfield.schema.parse(value);
						}
						return value;
					},
				};
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
					if ('format' in subfield && typeof subfield.format === 'string') {
						if (subfield.textarea) {
							field_props.type = 'textarea';
						} else if (subfield.format === 'email') {
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
				}
				if (subfield.type === 'enum') {
					field_props.options = subfield.options;
				}
				(form_field as any)[path] = field_props;
			}
			recursivelyBuildFormFieldProps(field, fieldName);
		}

		// Add auto-managed timestamp columns to the SQLite table definition
		(table_definition as any)['created_at'] = 'INTEGER NOT NULL';
		(table_definition as any)['updated_at'] = 'INTEGER NOT NULL';

		// Add timestamps to the Orama search schema as sortable numbers (epoch ms)
		(orama_schema as any)['updated_at'] = 'number';
		(orama_schema as any)['created_at'] = 'number';
		orama_sort.enabled = true;
		// updated_at should be sortable (needed for sync/change detection)
		sortable_fields.push('updated_at' as SortableColumn);

		// At this point primary_key is guaranteed to be set (either user-defined or auto-injected)
		if (!primary_key) throw { message: 'Table must have a primary key defined' };

		/** Coerces a timestamp value to an epoch number (ms). Accepts numbers, ISO strings, or Date objects. */
		function toEpoch(value: unknown): number {
			if (typeof value === 'number') return value;
			if (typeof value === 'string') return new Date(value).getTime();
			if (value instanceof Date) return value.getTime();
			return 0;
		}

		/**
		 * The parse function to validate data against the table schema
		 * @throws an error if the data is invalid (with details about the validation errors)
		 */
		function parse(data: any): Entity {
			const parsedData = {} as any;
			const issues: Array<{ path: string[]; message: string }> = [];
			for (const [fieldName, fieldDef] of Object.entries(table_config)) {
				function recursivelyParseField(
					field: DatabaseField,
					value: any,
					path: string[],
				): any {
					let label = path.join('.');
					if ('label' in field && (field as any).label) {
						label = (field as any).label;
					} else if ('placeholder' in field && (field as any).placeholder) {
						label = (field as any).placeholder;
					}
					if (value === undefined || value === null) {
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
						for (const [childFieldName, childFieldDef] of Object.entries(
							field.properties,
						)) {
							const childField = (childFieldDef as any)?.['_'] as DatabaseField;
							if (!childField) continue;
							const childValue = value[childFieldName];
							parsedObject[childFieldName] = recursivelyParseField(
								childField,
								childValue,
								[...path, childFieldName],
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
						let message = '';
						if (
							'min' in itemField &&
							typeof itemField.min === 'number' &&
							'max' in itemField &&
							typeof itemField.max === 'number'
						) {
							message = `Field '${label}' must have between ${itemField.min} and ${itemField.max} items.`;
						}
						if ('min' in itemField && typeof itemField.min === 'number') {
							if (value.length < itemField.min) {
								issues.push({
									message:
										message ||
										`Field '${label}' must have at least ${itemField.min} items.`,
									path,
								});
							}
						}
						if ('max' in itemField && typeof itemField.max === 'number') {
							if (value.length > itemField.max) {
								issues.push({
									message:
										message ||
										`Field '${label}' must have at most ${itemField.max} items.`,
									path,
								});
							}
						}
						return value.map((itemValue, index) =>
							recursivelyParseField(itemField, itemValue, [...path, `[${index}]`]),
						);
					}

					// Parse/validate geopoint fields (used in orama for location based searching)
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

					// Parse/validate vector fields (used for vector search in orama)
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

					// Foreign key fields are either strings or numbers and have no zod schema
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

					// Primary fields are either strings or numbers and have no zod schema
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

					// Use the zod schema if provided (this should be provided in most cases)
					if ('schema' in field && field.schema) {
						try {
							return field.schema.parse(value);
						} catch (err) {
							issues.push({
								message: `Field '${label}' is invalid: ${(err as any)?.message || 'Unknown error'}`,
								path,
							});
							return;
						}
					}

					// Handle numbers without a schema (this should never happen, but just in case)
					if (field.type === 'number') {
						const parsedNumber = Number(value);
						if (isNaN(parsedNumber)) {
							issues.push({
								message: `Field '${label}' must be a number.`,
								path,
							});
							return;
						}
						return parsedNumber;
					}

					// Handle strings without a schema (this should never happen, but just in case)
					if (field.type === 'string') {
						return String(value);
					}

					return value;
				}
				parsedData[fieldName] = recursivelyParseField(fieldDef['_'], data[fieldName], [
					fieldName,
				]);
			}

			// Pass through auto-managed timestamp fields, coercing strings to epoch ms
			if (data.created_at !== undefined) parsedData.created_at = toEpoch(data.created_at);
			if (data.updated_at !== undefined) parsedData.updated_at = toEpoch(data.updated_at);

			// If there are any validation issues, throw an error with details
			if (issues.length) {
				throw {
					message: issues[0].message,
					issues,
				};
			}
			return parsedData as Entity;
		}

		/**
		 * Converts the given entity data to a sparse search entity used by the orama search index.
		 * This only includes the fields defined as 'searchable' in the table schema.
		 */
		function toSparse(data: Entity): SearchEntity {
			const root = {} as any;
			for (const field_dot_notation of searchable_fields) {
				const field_path = field_dot_notation.split('.');
				let current = data;
				let sparse_data = root;
				for (let i = 0; i < field_path.length; i++) {
					if (current === undefined || current === null) break;
					const field = field_path[i];
					if (i === field_path.length - 1) {
						sparse_data[field] = (current as any)[field] ?? undefined;
					} else {
						if (!(field in sparse_data)) {
							sparse_data[field] = {};
						}
						sparse_data = sparse_data[field];
						current = (current as any)[field];
					}
				}
			}

			// Always include timestamps for Orama sorting/filtering, coercing to epoch if needed
			const entity = data as any;
			if (entity.updated_at !== undefined) root.updated_at = toEpoch(entity.updated_at);
			if (entity.created_at !== undefined) root.created_at = toEpoch(entity.created_at);

			return root as SearchEntity;
		}

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
				foreign_keys,
				table_definition,
				indexes,
				orama: {
					schema: orama_schema,
					sort: orama_sort,
					components: {
						getDocumentIndexId: (doc: Record<string, any>): string => {
							return String(doc[primary_key]);
						},
					},
				},
			},
			form: {
				field: form_field,
			},
		} as Table;
	}
}
