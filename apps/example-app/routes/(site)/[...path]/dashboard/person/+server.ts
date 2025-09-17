import { apiError } from '@packages/lib';
import { Person } from '@packages/types';

export async function POST({ locals, request }) {
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const body = await request.json<Person>();
	const person = await db.create('person', body);
	return new Response(JSON.stringify(person));
}
