import { requireAuthScope } from '$lib/server';
import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	requireAuthScope('content:comment');
	const { authState, db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	return json([]);
}

export async function POST({ locals }) {
	requireAuthScope('content:comment');
	const { authState, db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	return json(undefined);
}
