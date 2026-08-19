import type { FileReference } from './field-types';

/**
 * The one method of an object store this module needs.
 *
 * Structural on purpose: a Cloudflare `R2Bucket` satisfies it without a cast,
 * and so does any S3/GCS/filesystem wrapper you write. `@cloudflare/workers-types`
 * is only a dev dependency here, and nothing in this package should require it.
 */
export interface FileStore<Body = unknown> {
	get(key: string): Promise<Body | null>;
}

/**
 * Reads the object a `schema.file()` reference points at out of a bound store.
 *
 * The reference in the row is the whole record the database keeps — the bytes
 * live in the store and are fetched only when something actually needs them.
 * Returns `null` for a missing reference or a missing object, so a deleted
 * object reads the same way as a never-set field.
 *
 * ```ts
 * const page = db.get('page', id);
 * const object = await resolveFile(page.snapshot, env.MEDIA);
 * const bytes = object ? await object.arrayBuffer() : undefined;
 * ```
 *
 * The binding is the caller's to choose, and the reference does not always live
 * where the schema says: `store` on the reference overrides the field's `store`
 * for that row. Pick the binding from the **effective** store —
 * `reference.store ?? field_default` — or a row migrated to another bucket will
 * be looked up in the old one and read as `null`:
 *
 * ```ts
 * const store_name = page.snapshot?.store ?? 'MEDIA';
 * const object = await resolveFile(page.snapshot, env[store_name]);
 * ```
 *
 * This function deliberately does not do that lookup itself: it would need the
 * whole `env` and the schema, and both belong to the caller.
 *
 * A store binding cannot cross a Durable Object RPC boundary, so call this from
 * the Worker (or SvelteKit endpoint) that holds the binding, not from inside
 * the Durable Object.
 *
 * This does **not** verify `sha256`, `size` or `mime` against the bytes it
 * returns — those are validated on write. Verify on read yourself if the store
 * is not trusted.
 */
export async function resolveFile<Body>(
	reference: FileReference | null | undefined,
	store: FileStore<Body>,
): Promise<Body | null> {
	if (!reference?.key) return null;
	return (await store.get(reference.key)) ?? null;
}
