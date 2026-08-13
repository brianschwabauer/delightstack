import type { PageLoad } from './$types';

/**
 * The lab is useless without a corpus, so the page needs to know up front
 * whether one exists — that decides between the empty state and the panels.
 */
export const load: PageLoad = async ({ parent, fetch }) => {
	await parent();

	let counts = { places: 0, organizations: 0 };
	try {
		const response = await fetch('/api/search-lab/seed');
		if (response.ok) {
			counts = (await response.json()) as typeof counts;
		}
	} catch {
		// A failure here is not fatal — the Data panel reports it properly when
		// the user tries to seed.
	}

	return { counts };
};
