import { DelightError } from '@packages/lib';
import { Person } from '@packages/types';

export async function POST({ locals, request }) {
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const body = await request.json<Person>();
	const person = await db.create('person', body);
	return new Response(JSON.stringify(person));
}
