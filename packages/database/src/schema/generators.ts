import type {
	ArrayField,
	BooleanField,
	DatabaseFieldType,
	DefaultedValue,
	DerivedValue,
	Description,
	EnumField,
	FieldCheck,
	ForeignKey,
	ForeignKeyField,
	FormattedString,
	GeopointField,
	Indexable,
	IndexableField,
	IndexOptions,
	IntegerValue,
	IsIndexable,
	IsPrimaryKey,
	IsUnique,
	Label,
	NumberField,
	ObjectField,
	OptionalValue,
	Placeholder,
	PrimaryKeyField,
	ReadOnly,
	Searchable,
	Sortable,
	SqliteForeignKeyAction,
	StringField,
	StringFieldFormat,
	TextareaString,
	Unique,
	VectorField,
} from './field-types';
import { FieldValidator } from './validation';

/**
 * The loose runtime shape of a field definition that the shared builder
 * methods mutate. Subclasses narrow `_` to their concrete field interface.
 */
interface AnyFieldState {
	type: DatabaseFieldType;
	[key: string]: any;
}

/**
 * Builder methods shared by every field generator (optional/readonly).
 *
 * The methods are written generically over `this`, so each subclass keeps its
 * exact per-class return types (e.g. `Omit<Searchable<this>, 'searchable'>`).
 */
abstract class BaseFieldGenerator {
	declare readonly _: AnyFieldState;

	/**
	 * Marks the field as optional - meaning it can be undefined or null.
	 * Since we are using sqlite, optional fields will be stored as NULL in the database.
	 * Thus, there is no 'nullable' method since optional fields already cover that case.
	 */
	optional(): Omit<OptionalValue<this>, 'optional' | 'unique'> {
		this._.optional = true;
		return this as Omit<OptionalValue<this>, 'optional' | 'unique'>;
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

/** Adds the search-engine flags (searchable/sortable) shared by searchable field generators */
abstract class SearchableFieldGenerator extends BaseFieldGenerator {
	/** Whether the field can be fuzzy searched and indexed by the search engine. If 'primary' is true, this is ignored */
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
}

/**
 * Builder methods shared by the scalar field generators
 * (string/number/boolean/enum): form metadata, defaults, custom checks, and
 * derived (search-only) values.
 */
abstract class ScalarFieldGenerator<Value> extends SearchableFieldGenerator {
	/** Adds a human-readable label for the field (usually shown above input elements) */
	label<LabelText extends string>(
		text: LabelText,
	): Omit<Label<this, LabelText>, 'label'> {
		if (text) {
			(this as Label<this, LabelText>)._.label = text;
		}
		return this as Omit<Label<this, LabelText>, 'label'>;
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

	/** Adds description text for the field (usually shown below the input) */
	description<DescriptionText extends string>(
		text: DescriptionText,
	): Omit<Description<this, DescriptionText>, 'description'> {
		if (text) {
			(this as Description<this, DescriptionText>)._.description = text;
		}
		return this as Omit<Description<this, DescriptionText>, 'description'>;
	}

	/** Sets the default value for the field - applied when the value is undefined/omitted */
	default(def: Exclude<Value, undefined>): Omit<DefaultedValue<this>, 'default'>;
	default(def: () => Exclude<Value, undefined>): Omit<DefaultedValue<this>, 'default'>;
	default(def: any): Omit<DefaultedValue<this>, 'default'> {
		this._.default_value = def;
		this._.has_default = true;
		return this as Omit<DefaultedValue<this>, 'default'>;
	}

	/**
	 * Adds a custom validation function that runs after the built-in checks.
	 * Returning a string makes parse() fail with that message.
	 */
	check(fn: (value: Value) => string | undefined | void): this {
		(this._.checks ??= []).push(fn as FieldCheck);
		return this;
	}

	/**
	 * Marks this field as derived (computed from other fields).
	 * Derived fields are search-only: NOT stored in SQLite or included in Entity,
	 * but computed in toSparse() for search indexing and included in SearchEntity.
	 * Can optionally depend on foreign key fields for cross-table derived values.
	 */
	derived(
		fn: (data: Record<string, any>) => Value,
	): Omit<
		ReadOnly<Searchable<DerivedValue<this>>>,
		'derived' | 'searchable' | 'readonly'
	>;
	derived(
		foreign_keys: string[],
		fn: (
			data: Record<string, any>,
			refs: Record<string, Record<string, any> | undefined>,
		) => Value,
	): Omit<
		ReadOnly<Searchable<DerivedValue<this>>>,
		'derived' | 'searchable' | 'readonly'
	>;
	derived(
		fn_or_fks: any,
		fn?: any,
	): Omit<
		ReadOnly<Searchable<DerivedValue<this>>>,
		'derived' | 'searchable' | 'readonly'
	> {
		this._.derived = true;
		this._.searchable = true;
		this._.readonly = true;
		if (Array.isArray(fn_or_fks)) {
			this._.derived_foreign_keys = fn_or_fks;
			this._.derived_fn = fn;
		} else {
			this._.derived_fn = fn_or_fks;
		}
		return this as Omit<
			ReadOnly<Searchable<DerivedValue<this>>>,
			'derived' | 'searchable' | 'readonly'
		>;
	}
}

/**
 * Builder methods for scalar fields that get their own SQLite column and can
 * therefore be indexed / made unique (string and number fields).
 */
abstract class ColumnFieldGenerator<Value> extends ScalarFieldGenerator<Value> {
	/** Whether the field should be indexed by sqlite. If 'primary' is true, this is ignored */
	indexable(indexOptions?: IndexOptions): Omit<Indexable<this>, 'indexable'> {
		this._.indexable = true;
		(this._ as IndexableField).index = indexOptions;
		return this as Omit<Indexable<this>, 'indexable'>;
	}

	/** Whether the field must be unique in the table. This is ignored if 'primary' is true */
	unique(): Omit<Unique<this>, 'unique'> {
		this._.unique = true;
		return this as Omit<Unique<this>, 'unique'>;
	}
}

/** Helper functions for defining attributes & validators for string fields */
export class StringFieldGenerator extends ColumnFieldGenerator<string> {
	declare readonly _: StringField;

	constructor() {
		super();
		const field: StringField = { type: 'string' } as StringField;
		field.schema = new FieldValidator(field);
		(this as { _: StringField })._ = field;
	}

	/** Sets the minimum length of the string */
	min(length: number): Omit<this, 'min'> {
		if (length >= 0) {
			this._.minlength = Math.max(this._.minlength ?? 0, length);
		}
		return this as Omit<this, 'min'>;
	}

	/** Sets the maximum length of the string */
	max(length: number): Omit<this, 'max'> {
		if (length >= 0) {
			this._.maxlength = Math.min(this._.maxlength ?? Infinity, length);
		}
		return this as Omit<this, 'max'>;
	}

	/** Validates the string against the given regular expression */
	regex(pattern: RegExp): Omit<this, 'regex'> {
		(this._.patterns ??= []).push(pattern);
		this._.pattern = pattern.source;
		return this as Omit<this, 'regex'>;
	}

	/** Validates that the string starts with the given substring */
	startsWith(prefix: string): Omit<this, 'startsWith'> {
		this._.starts_with = prefix;
		return this as Omit<this, 'startsWith'>;
	}

	/** Validates that the string ends with the given substring */
	endsWith(suffix: string): Omit<this, 'endsWith'> {
		this._.ends_with = suffix;
		return this as Omit<this, 'endsWith'>;
	}

	/** Validates that the string includes the given substring */
	includes(substring: string): Omit<this, 'includes'> {
		this._.includes = substring;
		return this as Omit<this, 'includes'>;
	}

	/** Transforms the string by trimming whitespace during parse (before validation) */
	trim(): Omit<this, 'trim'> {
		(this._.transforms ??= []).push({ type: 'trim' });
		return this as Omit<this, 'trim'>;
	}

	/** Transforms the string to lowercase during parse (before validation) */
	toLowerCase(): Omit<this, 'toLowerCase' | 'toUpperCase'> {
		(this._.transforms ??= []).push({ type: 'lowercase' });
		return this as Omit<this, 'toLowerCase' | 'toUpperCase'>;
	}

	/** Transforms the string to uppercase during parse (before validation) */
	toUpperCase(): Omit<this, 'toLowerCase' | 'toUpperCase'> {
		(this._.transforms ??= []).push({ type: 'uppercase' });
		return this as Omit<this, 'toLowerCase' | 'toUpperCase'>;
	}

	/** Transforms the string to the given Unicode normalization form during parse (default NFC) */
	normalize(form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' = 'NFC'): Omit<this, 'normalize'> {
		(this._.transforms ??= []).push({ type: 'normalize', form });
		return this as Omit<this, 'normalize'>;
	}

	/** Validates that the string is a valid base64 encoded string */
	base64(): Omit<FormattedString<this, 'base64'>, StringFieldFormat> {
		this._.format = 'base64';
		return this as Omit<FormattedString<this, 'base64'>, StringFieldFormat>;
	}

	/**
	 * Validates that the string represents a color string with a #hex format
	 * This also marks the field as a color picker in the UI.
	 */
	color(): Omit<FormattedString<this, 'color'>, StringFieldFormat> {
		this._.format = 'color';
		return this as Omit<FormattedString<this, 'color'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid ISO 8601 datetime string */
	datetime(): Omit<FormattedString<this, 'datetime'>, StringFieldFormat> {
		this._.format = 'datetime';
		return this as Omit<FormattedString<this, 'datetime'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid ISO date string (YYYY-MM-DD) */
	date(): Omit<FormattedString<this, 'date'>, StringFieldFormat> {
		this._.format = 'date';
		return this as Omit<FormattedString<this, 'date'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid ISO time string (HH:MM[:SS[.s+]]) */
	time(): Omit<FormattedString<this, 'time'>, StringFieldFormat> {
		this._.format = 'time';
		return this as Omit<FormattedString<this, 'time'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid email address */
	email(): Omit<FormattedString<this, 'email'>, StringFieldFormat> {
		this._.format = 'email';
		return this as Omit<FormattedString<this, 'email'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid IPv4 address */
	ipv4(): Omit<FormattedString<this, 'ipv4'>, StringFieldFormat> {
		this._.format = 'ipv4';
		return this as Omit<FormattedString<this, 'ipv4'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid IPv6 address */
	ipv6(): Omit<FormattedString<this, 'ipv6'>, StringFieldFormat> {
		this._.format = 'ipv6';
		return this as Omit<FormattedString<this, 'ipv6'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid UUID */
	uuid(): Omit<FormattedString<this, 'uuid'>, StringFieldFormat> {
		this._.format = 'uuid';
		return this as Omit<FormattedString<this, 'uuid'>, StringFieldFormat>;
	}

	/** Validates that the string is a valid URL */
	url(): Omit<FormattedString<this, 'url'>, StringFieldFormat> {
		this._.format = 'url';
		return this as Omit<FormattedString<this, 'url'>, StringFieldFormat>;
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

	/** Marks the field as a textarea input instead of a regular text input. This doesn't affect validation. */
	textarea(): Omit<TextareaString<this>, 'textarea'> {
		this._.textarea = true;
		return this as Omit<TextareaString<this>, 'textarea'>;
	}
}

/** Helper functions for defining attributes & validators for number fields */
export class NumberFieldGenerator extends ColumnFieldGenerator<number> {
	declare readonly _: NumberField;

	constructor() {
		super();
		const field: NumberField = { type: 'number' } as NumberField;
		field.schema = new FieldValidator(field);
		(this as { _: NumberField })._ = field;
	}

	/** Requires the number to be an integer */
	int(): Omit<IntegerValue<this>, 'int'> {
		this._.integer = true;
		return this as Omit<IntegerValue<this>, 'int'>;
	}

	/** Requires the number to be greater than or equal to the given value */
	min(minimum: number): Omit<this, 'min'> {
		this._.min = Math.max(this._.min ?? -Infinity, minimum);
		return this as Omit<this, 'min'>;
	}

	/** Requires the number to be less than or equal to the given value */
	max(maximum: number): Omit<this, 'max'> {
		this._.max = Math.min(this._.max ?? Infinity, maximum);
		return this as Omit<this, 'max'>;
	}

	/** Requires the number to be strictly greater than the given value (exclusive bound) */
	gt(bound: number): Omit<this, 'gt'> {
		this._.exclusive_min = Math.max(this._.exclusive_min ?? -Infinity, bound);
		return this as Omit<this, 'gt'>;
	}

	/** Requires the number to be strictly less than the given value (exclusive bound) */
	lt(bound: number): Omit<this, 'lt'> {
		this._.exclusive_max = Math.min(this._.exclusive_max ?? Infinity, bound);
		return this as Omit<this, 'lt'>;
	}

	/**
	 * Sets the amount the number should be increased/decreased with each 'step' in
	 * form inputs, and requires the value to be a multiple of it (float-tolerant,
	 * so `.step(0.01)` works for currency).
	 */
	step(amount: number): Omit<this, 'step'> {
		this._.step = amount;
		return this as Omit<this, 'step'>;
	}
}

/** Helper functions for defining attributes & validators for boolean fields */
export class BooleanFieldGenerator extends ScalarFieldGenerator<boolean> {
	declare readonly _: BooleanField;

	constructor() {
		super();
		const field: BooleanField = { type: 'boolean' } as BooleanField;
		field.schema = new FieldValidator(field);
		(this as { _: BooleanField })._ = field;
	}
}

/** Helper functions for defining attributes & validators for enum fields */
export class EnumFieldGenerator<Options extends string[]> extends ScalarFieldGenerator<
	Options[number]
> {
	declare readonly _: EnumField<Options>;

	constructor(options: Options | { value: string; label: string }[]) {
		super();
		if (!options.length) {
			throw new Error('schema.enum() requires at least one option');
		}
		let values: Options;
		let option_labels: Record<string, string> | undefined;
		if (typeof options[0] === 'object') {
			const pairs = options as { value: string; label: string }[];
			values = pairs.map((pair) => pair.value) as Options;
			option_labels = Object.fromEntries(pairs.map((pair) => [pair.value, pair.label]));
		} else {
			values = options as Options;
		}
		const field: EnumField<Options> = {
			type: 'enum',
			options: values,
		} as EnumField<Options>;
		field.schema = new FieldValidator(field);
		if (option_labels) field.option_labels = option_labels;
		(this as { _: EnumField<Options> })._ = field;
	}
}

/** Helper functions for defining attributes & validators for vector fields */
export class VectorFieldGenerator extends BaseFieldGenerator {
	declare readonly _: VectorField;

	constructor(size?: number) {
		super();
		const field: VectorField = {
			type: 'vector',
			dimensions: size ?? 0,
			searchable: true,
		} as VectorField;
		field.schema = new FieldValidator(field);
		(this as { _: VectorField })._ = field;
	}

	/** Sets the size (number of dimensions) of the vector */
	size(dimensions: number): Omit<this, 'size'> {
		this._.dimensions = dimensions;
		return this as Omit<this, 'size'>;
	}
}

/** Helper functions for defining attributes & validators for geopoint fields */
export class GeopointFieldGenerator extends BaseFieldGenerator {
	declare readonly _: GeopointField;

	constructor() {
		super();
		const field: GeopointField = { type: 'geopoint', searchable: true } as GeopointField;
		field.schema = new FieldValidator(field);
		(this as { _: GeopointField })._ = field;
	}
}

/**
 * Marks the field as a database primary key.
 * If the type is 'string', a random string will be generated for each new row (unless a value is provided).
 * If the type is 'number', an auto-incrementing integer will be used as the primary key.
 */
export class PrimaryKeyGenerator<Type extends 'string' | 'number' = 'string'> {
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
		return this as Omit<Sortable<this>, 'sortable'>;
	}
}

/** Helper functions for defining attributes for foreign key fields */
export class ForeignKeyFieldGenerator extends SearchableFieldGenerator {
	declare readonly _: ForeignKeyField;

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
		super();
		(this as { _: ForeignKeyField })._ = {
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

/** Helper functions for defining attributes for nested object fields */
export class ObjectFieldGenerator<
	Properties extends Record<string, FieldGenerator>,
> extends BaseFieldGenerator {
	declare readonly _: ObjectField<Properties>;

	constructor(properties: Properties) {
		super();
		(this as { _: ObjectField<Properties> })._ = {
			type: 'object',
			properties,
		};
	}
}

/** Helper functions for defining attributes for array fields */
export class ArrayFieldGenerator<
	Items extends FieldGenerator,
> extends BaseFieldGenerator {
	declare readonly _: ArrayField<Items>;

	constructor(itemType: Items) {
		super();
		(this as { _: ArrayField<Items> })._ = {
			type: 'array',
			items: itemType,
		};
	}

	/**
	 * Marks the field as searchable in the search index.
	 * Only simple arrays like string[], number[], boolean[], and enum[] can be
	 * made searchable. An enum[] field is indexed as a list of exact tokens —
	 * it is filterable (`contains_all` / `contains_any`) and facetable, but it
	 * never participates in full-text term matching.
	 */
	searchable(): Omit<Searchable<this>, 'searchable'> {
		const searchableTypes = ['string', 'number', 'boolean', 'enum'];
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

	/** Adds a human-readable placeholder text for the field (usually shown when the input is empty) */
	placeholder<PlaceholderText extends string>(
		text: PlaceholderText,
	): Omit<Placeholder<this, PlaceholderText>, 'placeholder'> {
		if (text) {
			(this as Placeholder<this, PlaceholderText>)._.placeholder = text;
		}
		return this as Omit<Placeholder<this, PlaceholderText>, 'placeholder'>;
	}

	/** Adds description text for the field (usually shown below the input) */
	description<DescriptionText extends string>(
		text: DescriptionText,
	): Omit<Description<this, DescriptionText>, 'description'> {
		if (text) {
			(this as Description<this, DescriptionText>)._.description = text;
		}
		return this as Omit<Description<this, DescriptionText>, 'description'>;
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

export type FieldGenerator = Partial<_FieldGenerator> & { readonly _: any };

/** Helper functions for defining database fields and their attributes/constraints */
export class DatabaseGenerator {
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
	 * Vectors are used for vector search.
	 */
	vector(vectorSize: number): VectorFieldGenerator {
		return new VectorFieldGenerator(vectorSize);
	}

	/**
	 * Defines a list of strings that this field can take.
	 * Options may be plain strings or { value, label } pairs — the labels are
	 * used for the form Select options (otherwise labels are auto-derived).
	 */
	enum<const Values extends string[]>(values: Values): EnumFieldGenerator<Values>;
	enum<const Pairs extends { value: string; label: string }[]>(
		values: Pairs,
	): EnumFieldGenerator<{ -readonly [K in keyof Pairs]: Pairs[K]['value'] }>;
	enum(values: any): any {
		return new EnumFieldGenerator(values);
	}

	/** Defines a geopoint type which can be used for location based searching */
	geopoint(): GeopointFieldGenerator {
		return new GeopointFieldGenerator();
	}
}
