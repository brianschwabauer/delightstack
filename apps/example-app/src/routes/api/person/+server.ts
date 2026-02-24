import { requireAuthScope } from '$lib/server';
import { DelightError } from '@delightstack/utilities';
import { decodeSearchQuery } from '@delightstack/database';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	requireAuthScope('person:read');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const query = decodeSearchQuery(url.searchParams);
	const persons = await db.list('person', query);
	return json(persons);
}

export async function POST({ locals, request }) {
	requireAuthScope('person:write');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const data = await request.json<any>().catch(() => undefined);
	const person = await db.create('person', data);
	return json(person);
}
