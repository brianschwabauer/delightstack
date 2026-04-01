import { Database } from '@delightstack/database';
import { defineImageTable } from '@delightstack/images';

export const personTable = Database.table('person', (s) => ({
	id: s.primaryKey(),
	name: s.string().min(1).max(100).searchable(),
	email: s.string().email().optional().searchable(),
	phone: s.string().optional(),
	birthday: s.string().optional(),
	relationship: s
		.enum([
			'parent',
			'child',
			'sibling',
			'spouse',
			'grandparent',
			'grandchild',
			'aunt-uncle',
			'cousin',
			'friend',
			'other',
		])
		.optional()
		.searchable(),
	avatar_image_id: s.string().optional(),
	notes: s.string().optional(),
}));

export const postTable = Database.table('post', (s) => ({
	id: s.primaryKey(),
	title: s.string().min(1).max(200).searchable(),
	content: s.string().searchable(),
	summary: s.string().max(500).optional(),
	author_id: s.string(),
	is_public: s.boolean().default(false),
	cover_image_id: s.string().optional(),
	tags: s.array(s.string()).optional().searchable(),
}));

export const imageTable = defineImageTable((s) => ({
	uploader_id: s.string(),
	caption: s.string().optional(),
}));

export const tables = { person: personTable, post: postTable, image: imageTable };
