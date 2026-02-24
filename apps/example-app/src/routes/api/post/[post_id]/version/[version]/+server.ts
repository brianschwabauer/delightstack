import { requireAuthScope } from '$lib/server';
import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('content:read');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });

	// TODO: Return the post revision with the given post_id and version (if it exists)
	const { post_id, version } = params;

	return json([]);
}

export async function PUT({ locals, request, params }) {
	requireAuthScope('content:write');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });

	// TODO: Check if the "version" is a valid version of a post revision
	// TODO: If the version is valid, make that version the current version of the post
	const { post_id, version } = params;

	return json(undefined);
}
