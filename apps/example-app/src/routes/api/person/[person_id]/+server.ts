import { requireAuthScope } from '$lib/server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('person:read');
	const { person_id } = params;
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const person = await db.get('person', person_id);
	return json(person);
}

export async function PATCH({ locals, params, request }) {
	requireAuthScope(['person:edit', 'person:write']);
	const { person_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('person:edit')) {
		const person = await db.get('person', person_id);
		if (person.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to update people created by other users`,
			});
		}
	}
	const data = await request.json<any>().catch(() => undefined);
	const person = await db.update('person', person_id, data);
	return json(person);
}

export async function DELETE({ locals, params }) {
	requireAuthScope(['person:edit', 'person:write']);
	const { person_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('person:edit')) {
		const person = await db.get('person', person_id);
		if (person.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to delete people created by other users`,
			});
		}
	}
	await db.delete('person', person_id);
	return new Response(null, { status: 204 });
}
