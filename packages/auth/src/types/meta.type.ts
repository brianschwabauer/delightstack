import { z } from 'zod/v4';
import { generateID } from '@delightstack/utilities';

/** A timestamp based on the epoch ms */
export const MetaDate = z.number().int().positive();
export type MetaDate = z.infer<typeof MetaDate>;

/** A globally unique ID in the database that encodes a timestamp in it for chronological ordering */
export const MetaId = z.string().regex(/^[A-Za-z0-9]{20}$/);
export type MetaId = z.infer<typeof MetaId>;

/** Metadata added to most entities */
export const Meta = z.object({
	/** The globally unique ID of the entity */
	id: MetaId.default(() => generateID()),
	/** The ID of the user that created the entity */
	creator_id: z.string().optional(),
	/** The timestamp when the entity was created */
	created_at: MetaDate.default(0),
	/** The ID of the user that laste updated the entity */
	updator_id: z.string().optional(),
	/** The timestamp when the entity was last updated */
	updated_at: MetaDate.default(0),
});
