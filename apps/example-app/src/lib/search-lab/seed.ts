/**
 * The Search Lab's demo corpus.
 *
 * Everything here is a pure function of a numeric seed — no `Math.random`, no
 * `Date.now()` — so the same seed always produces byte-identical organizations
 * and places. That matters twice over: the reseed button has to be repeatable,
 * and the vector panel's similarity scores only mean something if the corpus
 * they were computed against is stable.
 *
 * The data is shaped to make engine behaviour *visible*:
 *
 * - Six geographic clusters, so a radius or polygon boundary actually cuts
 *   through results instead of matching everything or nothing.
 * - Prose with emails, acronyms, camelCase joins, numbers and diacritics, so
 *   tokenizer rules show up in search results.
 * - Deliberate nulls in `rating` and `price`, so nulls-last sorting is obvious.
 * - Categories that line up with the embedding's concept lexicon, so vector
 *   search clusters the way a reader expects.
 */

import { embed } from './embedding';

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, fast, and identical on every engine. */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Pick one item from a list. */
function pick<T>(random: () => number, items: readonly T[]): T {
	return items[Math.floor(random() * items.length)];
}

/** Pick `count` distinct items, preserving the source order. */
function pickSome<T>(random: () => number, items: readonly T[], count: number): T[] {
	const pool = [...items];
	const chosen: T[] = [];
	for (let index = 0; index < count && pool.length > 0; index++) {
		chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
	}
	return chosen;
}

/** A number in [min, max], rounded to `decimals` places. */
function range(random: () => number, min: number, max: number, decimals = 0): number {
	const value = min + random() * (max - min);
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** The default seed. Change it in the UI to get a different (stable) corpus. */
export const DEFAULT_SEED = 20260812;

/** How many places a default reseed writes. */
export const DEFAULT_PLACE_COUNT = 324;

export const PLACE_CATEGORIES = [
	'cafe',
	'restaurant',
	'bakery',
	'bar',
	'bookstore',
	'gym',
	'park',
	'museum',
	'venue',
	'coworking',
	'hotel',
	'market',
] as const;

export const PLACE_STATUSES = ['open', 'seasonal', 'closed', 'renovating'] as const;

export const PLACE_AMENITIES = [
	'wifi',
	'parking',
	'outdoor_seating',
	'wheelchair_access',
	'pet_friendly',
	'late_night',
	'card_only',
	'ev_charging',
] as const;

export const ORGANIZATION_KINDS = [
	'hospitality',
	'retail',
	'civic',
	'collective',
] as const;

export const COUNTRIES = ['US', 'PT', 'JP', 'IS', 'CA'] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];
export type PlaceStatus = (typeof PLACE_STATUSES)[number];
export type PlaceAmenity = (typeof PLACE_AMENITIES)[number];
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
export type Country = (typeof COUNTRIES)[number];

/** The six geographic clusters. `spread` is in degrees of lat/lon. */
export const CITIES = [
	{ city: 'Portland', country: 'US', lat: 45.5152, lon: -122.6784, spread: 0.075 },
	{ city: 'Austin', country: 'US', lat: 30.2672, lon: -97.7431, spread: 0.09 },
	{ city: 'Lisboa', country: 'PT', lat: 38.7223, lon: -9.1393, spread: 0.055 },
	{ city: 'Kyōto', country: 'JP', lat: 35.0116, lon: 135.7681, spread: 0.06 },
	{ city: 'Reykjavík', country: 'IS', lat: 64.1466, lon: -21.9426, spread: 0.045 },
	{ city: 'Montréal', country: 'CA', lat: 45.5019, lon: -73.5674, spread: 0.08 },
] as const satisfies readonly {
	city: string;
	country: Country;
	lat: number;
	lon: number;
	spread: number;
}[];

const NAME_PREFIXES: Record<PlaceCategory, readonly string[]> = {
	cafe: ['Northwind', 'Slow Pour', 'Ember', 'Meridian', 'Café Zoë', 'Bright Angle'],
	restaurant: ['Ñandú', 'Copper Fork', 'Kyōto', 'Two Rivers', 'Saltbox', 'Verde'],
	bakery: ['Bäckerei Süß', 'Flourish', 'Morning Proof', 'Golden Crust', 'Levain'],
	bar: ['Þórs', 'Blue Hour', 'The Lantern', 'Ironwood', 'Half Moon'],
	bookstore: ['Marginalia', 'Dog-Eared', 'Second Chapter', 'Foxglove', 'Codex'],
	gym: ['Basecamp', 'Iron & Oak', 'Ascend', 'Kettle House', 'Northline'],
	park: ['Cedar Hollow', 'Riverbend', 'Fern Gully', 'Quarry', 'Willowbank'],
	museum: ['Atheneum', 'Glasshouse', 'The Foundry', 'Vestige', 'Lumen'],
	venue: ['The Vinyl Room', 'Static Hall', 'Echo Chamber', 'Bandstand', 'Reverb'],
	coworking: ['DataOps Loft', 'The Commons', 'Deskwell', 'Studio 9', 'Longform'],
	hotel: ['The Kestrel', 'Hôtel Bellevue', 'Anchorage', 'Wayfarer', 'Rookery'],
	market: ['Provision', 'The Grocer', 'Harvest Row', 'Sundry', 'Fieldnote'],
};

const NAME_SUFFIXES: Record<PlaceCategory, readonly string[]> = {
	cafe: ['Coffee', 'Espresso Bar', 'Roasters', 'Coffeehouse'],
	restaurant: ['Kitchen', 'Bistro', 'Dining Room', 'Ramen', 'Taqueria'],
	bakery: ['Bakery', 'Patisserie', 'Bread Co.', 'Bakehouse'],
	bar: ['Taproom', 'Cocktail Bar', 'Brewery', 'Wine Bar'],
	bookstore: ['Books', 'Bookstore', 'Reading Room', 'Zine Shop'],
	gym: ['Fitness', 'Bouldering Gym', 'Yoga Studio', 'Strength Club'],
	park: ['Park', 'Trailhead', 'Botanical Garden', 'Riverside Walk'],
	museum: ['Museum', 'Exhibit Hall', 'Sculpture Garden', 'Archive'],
	venue: ['Music Venue', 'Concert Hall', 'Records & Stage', 'Live Room'],
	coworking: ['Coworking', 'Workspace', 'Meeting Rooms', 'Desk Club'],
	hotel: ['Hotel', 'Guesthouse', 'Inn', 'Lodge'],
	market: ['Market', 'Grocer', 'Provisions', 'Produce Hall'],
};

const TAG_POOL = [
	'cozy',
	'quiet',
	'family-friendly',
	'late-night',
	'seasonal',
	'local-favourite',
	'award-winning',
	'budget',
	'romantic',
	'group-friendly',
	'historic',
	'newly-opened',
	'vegan-options',
	'live-music',
	'study-spot',
	'walk-in-only',
] as const;

const CONTACT_DOMAINS = [
	'northwind.example',
	'meridian.example',
	'fieldnote.example',
	'lumen.example',
] as const;

/** Descriptions are built from these — one per category, `{}` slots filled in. */
const DESCRIPTION_TEMPLATES: Record<PlaceCategory, readonly string[]> = {
	cafe: [
		'A slow-pour coffeehouse where the barista pulls single-origin espresso to order. Seats {seats}, free Wi-Fi, and a DataOps meetup on the first Tuesday. Reach the roaster at {email}.',
		'Neighbourhood café with a bright patio and a rotating latte menu. The brew bar opens at 6:30 and the pastry case is usually empty by 11. Questions to {email}.',
	],
	restaurant: [
		'A {seats}-seat restaurant whose kitchen leans on the market two blocks over. The chef changes the menu every 6 weeks; the HVAC hums but the food is worth it. Bookings: {email}.',
		'Small dining room serving regional cuisine at a counter for {seats}. No reservations, cash and card, open until 23:00. Press enquiries to {email}.',
	],
	bakery: [
		'Sourdough bakery running a 36-hour ferment. Croissants and pastry from 07:00, bread from 09:00, sold out by {seats}:00 most days. Wholesale via {email}.',
		'A patisserie with a glass-fronted bakehouse and one long communal table seating {seats}. The baker answers {email} between deliveries.',
	],
	bar: [
		'Cocktail bar and taproom with {seats} stools and a wall of local beer. Live band most Fridays; ATM inside, card-only at the bar. Bookings: {email}.',
		'A wine bar built into a former hardware shop. {seats} seats, no TVs, and a brewery collaboration on tap every season. Reach the team at {email}.',
	],
	bookstore: [
		'Independent bookstore with a {seats}-seat reading room and a literature section that runs deep. Zines by the till, novel launches monthly. Orders: {email}.',
		'Second-hand books across two floors, plus a library-quiet study spot for {seats}. Trade-ins accepted 7 days. Email {email} for stock requests.',
	],
	gym: [
		'Bouldering gym with {seats} problems reset weekly, plus yoga and pilates in the back studio. Wheelchair-accessible changing rooms. Memberships via {email}.',
		'Strength-focused fitness club, {seats} platforms, open 05:00–23:00. Free workout intro for members; ask at the desk or email {email}.',
	],
	park: [
		'A riverside park with a {seats}-hectare garden, forest trail, and outdoor stage in summer. Dogs welcome on lead. Volunteer programme: {email}.',
		'Trailhead park with a botanical garden and {seats} km of hiking paths. Parking fills by 09:00 on weekends. Ranger office: {email}.',
	],
	museum: [
		'A museum of regional craft with {seats} objects on permanent exhibit and a sculpture garden out back. Curator talks weekly. Archive access via {email}.',
		'Exhibit hall in a converted foundry — {seats} works, rotating art shows, free on the first Sunday. School bookings: {email}.',
	],
	venue: [
		'Live music venue holding {seats}, with a vinyl shop in the lobby and a stage the local bands fought for. Amplifier hire included. Bookings: {email}.',
		'Concert hall seating {seats}, records and stage under one roof, late-night sets on weekends. Promoter contact: {email}.',
	],
	coworking: [
		'Coworking loft with {seats} desks, four meeting rooms, and a startup community that skews DataOps and design. Day passes at the door. Tours: {email}.',
		'A quiet workspace for {seats}, floor-to-ceiling windows, and an office kitchen stocked with the good coffee. Enquiries to {email}.',
	],
	hotel: [
		'A {seats}-room hotel in a restored townhouse, with a guesthouse annexe and a dining room open to non-residents. Reservations: {email}.',
		'Small inn with {seats} suites, EV charging in the courtyard, and a lodge feel without the kitsch. Contact {email}.',
	],
	market: [
		'Covered market with {seats} stalls — grocer, produce, cheese, and a boutique retail row along the north wall. Trader applications: {email}.',
		'Neighbourhood provisions store and produce hall, {seats} vendors, open daily. Wholesale and retail. Enquiries to {email}.',
	],
};

const ORGANIZATION_NAMES = [
	'Northwind Hospitality',
	'Meridian Collective',
	'Fieldnote Provisions',
	'Lumen Cultural Trust',
	'Ironwood Group',
	'Riverbend Parks Authority',
	'Codex & Co.',
	'Basecamp Athletics',
	'Hôtel Bellevue Gruppe',
	'Kyōto Machiya Union',
] as const;

/* -------------------------------------------------------------------------- */
/* Generated shapes                                                            */
/* -------------------------------------------------------------------------- */

/** An organization as written to the database (no id / timestamps). */
export interface SeedOrganization {
	name: string;
	kind: OrganizationKind;
	founded_year: number;
	verified: boolean;
	contact_email: string;
}

/** A place as written to the database (no id / timestamps). */
export interface SeedPlace {
	name: string;
	description: string;
	category: PlaceCategory;
	status: PlaceStatus;
	price: number | null;
	rating: number | null;
	open_late: boolean;
	tags: string[];
	amenities: PlaceAmenity[];
	address: { city: string; country: Country };
	location: { lat: number; lon: number };
	embedding: number[];
	/** Index into the generated organization list — resolved to a real id on write. */
	organization_index: number;
}

export interface SeedCorpus {
	seed: number;
	organizations: SeedOrganization[];
	places: SeedPlace[];
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

function slugify(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function buildOrganizations(random: () => number): SeedOrganization[] {
	return ORGANIZATION_NAMES.map((name, index) => ({
		name,
		kind: ORGANIZATION_KINDS[index % ORGANIZATION_KINDS.length],
		founded_year: Math.round(range(random, 1948, 2021)),
		verified: random() > 0.35,
		contact_email: `hello@${slugify(name).slice(0, 18)}.example`,
	}));
}

function buildPlace(
	random: () => number,
	index: number,
	organization_count: number,
): SeedPlace {
	const cluster = CITIES[index % CITIES.length];
	const category = PLACE_CATEGORIES[
		Math.floor(random() * PLACE_CATEGORIES.length)
	] as PlaceCategory;

	const name = `${pick(random, NAME_PREFIXES[category])} ${pick(random, NAME_SUFFIXES[category])}`;
	const seats = Math.round(range(random, 8, 240));
	const email = `${slugify(name).slice(0, 20)}@${pick(random, CONTACT_DOMAINS)}`;
	const description = pick(random, DESCRIPTION_TEMPLATES[category])
		.replace('{seats}', String(seats))
		.replace('{email}', email);

	// Two-lobed jitter so each city reads as a dense core plus a looser ring —
	// a radius slider then has somewhere interesting to land.
	const in_core = random() > 0.4;
	const spread = in_core ? cluster.spread * 0.35 : cluster.spread;
	const angle = random() * Math.PI * 2;
	const distance = Math.sqrt(random()) * spread;

	// ~12% of places have no rating and ~9% no price, so nulls-last sorting and
	// `sparse` responses have something real to show.
	const rating = random() < 0.12 ? null : range(random, 2.4, 5, 1);
	const price = random() < 0.09 ? null : Math.round(range(random, 4, 180));

	const description_for_vector = `${name} ${category} ${description}`;

	return {
		name,
		description,
		category,
		status: pick(random, PLACE_STATUSES),
		price,
		rating,
		open_late: random() > 0.62,
		tags: pickSome(random, TAG_POOL, 1 + Math.floor(random() * 4)),
		amenities: pickSome(random, PLACE_AMENITIES, 1 + Math.floor(random() * 4)),
		address: { city: cluster.city, country: cluster.country },
		location: {
			lat: Math.round((cluster.lat + Math.cos(angle) * distance) * 1e6) / 1e6,
			lon: Math.round((cluster.lon + Math.sin(angle) * distance * 1.4) * 1e6) / 1e6,
		},
		embedding: embed(description_for_vector),
		organization_index: Math.floor(random() * organization_count),
	};
}

/**
 * Build the whole corpus. Deterministic in `seed` and `place_count` — the same
 * arguments always produce the same organizations, places, and vectors.
 */
export function generateCorpus(
	seed: number = DEFAULT_SEED,
	place_count: number = DEFAULT_PLACE_COUNT,
): SeedCorpus {
	const random = createRandom(seed);
	const organizations = buildOrganizations(random);
	const places: SeedPlace[] = [];
	for (let index = 0; index < place_count; index++) {
		places.push(buildPlace(random, index, organizations.length));
	}
	return { seed, organizations, places };
}
