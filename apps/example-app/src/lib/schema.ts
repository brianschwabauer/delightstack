import { Database } from '@delightstack/database';
import { defineImageTable } from '@delightstack/images';
import { organizationTable, placeTable } from './search-lab/tables';

// `id` (string primary key), `created_at`, and `updated_at` are auto-managed —
// tables don't declare them. Timestamps are epoch-millisecond numbers.
export const personTable = Database.table('person', (s) => ({
	name: s.string().min(1).max(100).label('Name').placeholder('Full name').searchable(),
	email: s.string().email().label('Email').optional().searchable(),
	phone: s.string().phone().label('Phone').optional(),
	birthday: s.string().date().label('Birthday').optional(),
	relationship: s
		.enum([
			{ value: 'parent', label: 'Parent' },
			{ value: 'child', label: 'Child' },
			{ value: 'sibling', label: 'Sibling' },
			{ value: 'spouse', label: 'Spouse' },
			{ value: 'grandparent', label: 'Grandparent' },
			{ value: 'grandchild', label: 'Grandchild' },
			{ value: 'aunt-uncle', label: 'Aunt/Uncle' },
			{ value: 'cousin', label: 'Cousin' },
			{ value: 'friend', label: 'Friend' },
			{ value: 'other', label: 'Other' },
		])
		.label('Relationship')
		.optional()
		.searchable(),
	avatar_image_id: s.string().optional(),
	notes: s.string().label('Notes').placeholder('Notes about this person...').optional(),
}));

export const postTable = Database.table('post', (s) => ({
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

export { organizationTable, placeTable };

export const tables = {
	person: personTable,
	post: postTable,
	image: imageTable,
	organization: organizationTable,
	place: placeTable,
};
