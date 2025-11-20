import { requireAuthScope } from '$lib/server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	requireAuthScope('content:comment');
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	return json([]);
}

export async function POST({ locals }) {
	requireAuthScope('content:comment');
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	return json(undefined);
}
