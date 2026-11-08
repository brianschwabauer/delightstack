import { describe, expect, it } from 'vitest';
import { Database } from './schema.js';

describe('.keyword()', () => {
	it('indexes a string, or a string array, as exact values', () => {
		const table = Database.table('listing', (s) => ({
			thumbnail_key: s.string().keyword().optional(),
			label_ids: s.array(s.string()).keyword().optional(),
			title: s.string().searchable(),
		}));
		expect(table.config.index_schema).toMatchObject({
			thumbnail_key: 'enum',
			label_ids: 'enum[]',
			title: 'string',
		});
		expect(table.config.searchable_fields).toEqual(
			expect.arrayContaining(['thumbnail_key', 'label_ids']),
		);
	});

	it('is implied by the datetime, date, time, uuid and url formats', () => {
		const table = Database.table('event', (s) => ({
			starts: s.string().datetime().searchable(),
			day: s.string().date().searchable(),
			link: s.string().url().searchable(),
			external: s.string().uuid().searchable(),
			body_updated_at: s.string().datetime().searchable().sortable(),
		}));
		expect(table.config.index_schema).toMatchObject({
			starts: 'enum',
			day: 'enum',
			link: 'enum',
			external: 'enum',
			body_updated_at: 'enum',
		});
	});
});

describe('the identifier-name guard', () => {
	it('throws for a full-text field named like an id, key, url, hash, token or timestamp', () => {
		for (const name of [
			'author_id',
			'person_ids',
			'thumbnail_key',
			'photo_url',
			'file_hash',
			'invite_token',
			'synced_at',
		]) {
			expect(
				() => Database.table('t', (s) => ({ [name]: s.string().searchable() })),
				name,
			).toThrow(/looks like an identifier.*\.keyword\(\)/);
		}
		expect(() =>
			Database.table('t', (s) => ({ person_ids: s.array(s.string()).searchable() })),
		).toThrow(/looks like an identifier/);
		expect(() =>
			Database.table('t', (s) => ({
				address: s.object({ zip_key: s.string().searchable() }),
			})),
		).toThrow(/address\.zip_key/);
	});

	it('leaves ordinary names, keywords and an explicit text opt-in alone', () => {
		expect(() =>
			Database.table('t', (s) => ({
				name: s.string().searchable(),
				keyboard: s.string().searchable(),
				author_id: s.string().keyword(),
				api_key_notes: s.string().searchable(),
				search_tokens: s.string().searchable({ text: true }),
			})),
		).not.toThrow();
	});
});

describe('.searchable({ weight, max_tokens })', () => {
	it('records the options under the field path', () => {
		const table = Database.table('note', (s) => ({
			title: s.string().searchable({ weight: 3 }),
			body: s.string().searchable({ max_tokens: 200 }),
			everything: s.string().searchable({ max_tokens: Infinity }),
			plain: s.string().searchable(),
		}));
		expect(table.config.search_options).toEqual({
			title: { weight: 3 },
			body: { max_tokens: 200 },
			everything: { max_tokens: Infinity },
		});
	});

	it('rejects nonsense values', () => {
		expect(() =>
			Database.table('t', (s) => ({ title: s.string().searchable({ weight: 0 }) })),
		).toThrow(/weight/);
		expect(() =>
			Database.table('t', (s) => ({ title: s.string().searchable({ max_tokens: 2.5 }) })),
		).toThrow(/max_tokens/);
	});
});
