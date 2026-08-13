import { Database } from '@delightstack/database';

// ---------------------------------------------------------------------------
// Search Lab — the two tables behind /dashboard/search-lab.
//
// Between them they cover every field type the search engine understands, so
// the lab can exercise the whole query DSL against real data: string, number,
// boolean, enum, string[], enum[], a nested object (child-path filters and
// sorts), a geopoint, a vector, a foreign key, and a field derived *through*
// that foreign key so an organization rename cascades into every place's
// search index.
// ---------------------------------------------------------------------------

export const organizationTable = Database.table('organization', (s) => ({
	id: s.primaryKey(),
	name: s
		.string()
		.min(1)
		.max(120)
		.label('Name')
		.placeholder('Northwind Hospitality')
		.sortable(),
	kind: s
		.enum([
			{ value: 'hospitality', label: 'Hospitality' },
			{ value: 'retail', label: 'Retail' },
			{ value: 'civic', label: 'Civic' },
			{ value: 'collective', label: 'Collective' },
		])
		.label('Kind')
		.default('hospitality')
		.searchable(),
	founded_year: s
		.number()
		.int()
		.min(1800)
		.max(2100)
		.label('Founded')
		.placeholder('1984')
		.optional()
		.sortable(),
	verified: s.boolean().default(false).label('Verified').searchable(),
	contact_email: s.string().email().label('Contact email').optional().searchable(),
}));

export const placeTable = Database.table('place', (s) => ({
	id: s.primaryKey(),

	// -- text --
	name: s
		.string()
		.min(1)
		.max(140)
		.label('Name')
		.placeholder('Northwind Coffee')
		.sortable(),
	description: s
		.string()
		.max(1200)
		.textarea()
		.label('Description')
		.placeholder('What is this place like?')
		.searchable(),

	// -- enums --
	category: s
		.enum([
			{ value: 'cafe', label: 'Café' },
			{ value: 'restaurant', label: 'Restaurant' },
			{ value: 'bakery', label: 'Bakery' },
			{ value: 'bar', label: 'Bar' },
			{ value: 'bookstore', label: 'Bookstore' },
			{ value: 'gym', label: 'Gym' },
			{ value: 'park', label: 'Park' },
			{ value: 'museum', label: 'Museum' },
			{ value: 'venue', label: 'Venue' },
			{ value: 'coworking', label: 'Coworking' },
			{ value: 'hotel', label: 'Hotel' },
			{ value: 'market', label: 'Market' },
		])
		.label('Category')
		.default('cafe')
		.searchable(),
	status: s
		.enum([
			{ value: 'open', label: 'Open' },
			{ value: 'seasonal', label: 'Seasonal' },
			{ value: 'closed', label: 'Closed' },
			{ value: 'renovating', label: 'Renovating' },
		])
		.label('Status')
		.default('open')
		.searchable(),

	// -- numbers (both nullable, so nulls-last sorting is visible) --
	price: s
		.number()
		.int()
		.min(0)
		.max(1000)
		.label('Typical spend')
		.placeholder('24')
		.optional()
		.sortable(),
	rating: s
		.number()
		.min(0)
		.max(5)
		.label('Rating')
		.placeholder('4.2')
		.optional()
		.sortable(),

	// -- boolean --
	open_late: s.boolean().default(false).label('Open late').searchable(),

	// -- string[] and enum[] --
	tags: s.array(s.string()).label('Tags').optional().searchable(),
	amenities: s
		.array(
			s.enum([
				{ value: 'wifi', label: 'Wi-Fi' },
				{ value: 'parking', label: 'Parking' },
				{ value: 'outdoor_seating', label: 'Outdoor seating' },
				{ value: 'wheelchair_access', label: 'Wheelchair access' },
				{ value: 'pet_friendly', label: 'Pet friendly' },
				{ value: 'late_night', label: 'Late night' },
				{ value: 'card_only', label: 'Card only' },
				{ value: 'ev_charging', label: 'EV charging' },
			]),
		)
		.label('Amenities')
		.optional()
		.searchable(),

	// -- nested object: child-path filters (`address.city`) and sorts --
	address: s.object({
		city: s.string().max(80).label('City').sortable(),
		country: s
			.enum([
				{ value: 'US', label: 'United States' },
				{ value: 'PT', label: 'Portugal' },
				{ value: 'JP', label: 'Japan' },
				{ value: 'IS', label: 'Iceland' },
				{ value: 'CA', label: 'Canada' },
			])
			.label('Country')
			.default('US')
			.searchable(),
	}),

	// -- geopoint and vector: always searchable, never optional here --
	location: s.geopoint(),
	embedding: s.vector(64),

	// -- foreign key + a field derived through it --
	organization_id: s
		.foreignKey({
			type: 'string',
			table: 'organization',
			column: 'id',
			on_delete: 'CASCADE',
		})
		.searchable(),
	/**
	 * Search-only: never stored on the place row, recomputed whenever the place
	 * *or* the referenced organization changes. Rename an organization and every
	 * one of its places is reindexed under the new name.
	 */
	organization_name: s
		.string()
		.derived(['organization_id'], (_data, refs) =>
			typeof refs.organization_id?.name === 'string' ? refs.organization_id.name : '',
		),
}));
