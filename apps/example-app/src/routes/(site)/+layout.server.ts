export async function load({ locals }) {
	return { authState: locals.authState.toJSON() };
}
