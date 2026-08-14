import { DelightError } from '@delightstack/utilities';
import {
	DEFAULT_PLACE_COUNT,
	DEFAULT_SEED,
	generateCorpus,
	type SeedOrganization,
} from '$lib/search-lab/seed';
import type { RequestHandler } from './$types';

/** How many places go into one transaction. Well under the 5,000-op ceiling. */
const WRITE_BATCH = 40;

/** Upper bound on a single reseed, so a typo in the UI cannot wedge the DO. */
const MAX_PLACES = 1000;

function requireDatabase(locals: App.Locals) {
	if (!locals.session) throw DelightError.unauthorized('Sign in to use the Search Lab');
	const db = locals.db;
	if (!db) throw DelightError.badRequest('No organization selected');
	return db;
}

/** Every id currently stored for `entity_type`, paged through the sparse list. */
async function collectIds(
	db: App.OrgDatabase,
	entity_type: 'place' | 'organization',
): Promise<string[]> {
	const ids: string[] = [];
	let offset = 0;
	for (;;) {
		const page = await db.list(entity_type, {
			limit: 200,
			offset,
			sparse: true,
			// updated_at is the only order field every table implicitly supports;
			// paging just needs a stable order (PK tie-break keeps it deterministic).
			order: [{ field: 'updated_at', direction: 'ASC' }],
		});
		const hits = page.hits ?? [];
		if (hits.length === 0) break;
		for (const hit of hits) {
			const id = hit.id ?? hit.document?.id;
			if (id) ids.push(id);
		}
		offset += hits.length;
		if (hits.length < 200) break;
	}
	return ids;
}

/** Current corpus size — drives the lab's "reseed" affordance. */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const db = requireDatabase(locals as App.Locals);
		const [places, organizations] = await Promise.all([
			db.list('place', { limit: 1, sparse: true }),
			db.list('organization', { limit: 1, sparse: true }),
		]);
		return Response.json({
			places: places.count ?? 0,
			organizations: organizations.count ?? 0,
		});
	} catch (error) {
		return DelightError.from(error).toResponse();
	}
};

/**
 * Wipe and regenerate the corpus. Places go first so their rows are gone before
 * the organizations they reference — the FK is `ON DELETE CASCADE`, and letting
 * the cascade do the work would leave the search index to guess.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		return await reseed(locals as App.Locals, request);
	} catch (error) {
		return DelightError.from(error).toResponse();
	}
};

async function reseed(locals: App.Locals, request: Request): Promise<Response> {
	const db = requireDatabase(locals);

	let body: { seed?: number; place_count?: number } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		body = {};
	}

	const seed = Number.isFinite(body.seed) ? Number(body.seed) : DEFAULT_SEED;
	const requested = Number.isFinite(body.place_count)
		? Number(body.place_count)
		: DEFAULT_PLACE_COUNT;
	const place_count = Math.max(1, Math.min(MAX_PLACES, Math.round(requested)));

	const started = Date.now();

	// 1. Clear whatever is there.
	const place_ids = await collectIds(db, 'place');
	for (let index = 0; index < place_ids.length; index += WRITE_BATCH) {
		await db.transaction(
			place_ids
				.slice(index, index + WRITE_BATCH)
				.map((id) => ({ delete: { type: 'place', id } })),
		);
	}
	const organization_ids = await collectIds(db, 'organization');
	for (let index = 0; index < organization_ids.length; index += WRITE_BATCH) {
		await db.transaction(
			organization_ids
				.slice(index, index + WRITE_BATCH)
				.map((id) => ({ delete: { type: 'organization', id } })),
		);
	}

	// 2. Organizations first — places carry a foreign key to them.
	const corpus = generateCorpus(seed, place_count);
	const organization_rows = (await db.transaction(
		corpus.organizations.map((organization: SeedOrganization) => ({
			create: { type: 'organization', data: organization },
		})),
	)) as { entity?: { id?: string } }[];

	const new_organization_ids = organization_rows
		.map((row) => row.entity?.id)
		.filter((id): id is string => typeof id === 'string');

	if (new_organization_ids.length !== corpus.organizations.length) {
		throw DelightError.badRequest('Seeding failed while writing organizations');
	}

	// 3. Places, in batches.
	for (let index = 0; index < corpus.places.length; index += WRITE_BATCH) {
		await db.transaction(
			corpus.places.slice(index, index + WRITE_BATCH).map((place) => {
				const { organization_index, ...rest } = place;
				return {
					create: {
						type: 'place',
						data: {
							...rest,
							organization_id: new_organization_ids[organization_index],
						},
					},
				};
			}),
		);
	}

	return Response.json({
		seed,
		places: corpus.places.length,
		organizations: corpus.organizations.length,
		elapsed_ms: Date.now() - started,
	});
}
