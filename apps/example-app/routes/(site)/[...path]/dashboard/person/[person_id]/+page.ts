export async function load({ parent, params }) {
	const { entities } = await parent();
	const person = entities.get('person', params.person_id);
	await person.load();
	return { person };
}
