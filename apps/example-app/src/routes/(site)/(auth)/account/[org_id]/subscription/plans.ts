export const PLANS = [
	{
		id: 'monthly',
		name: 'Monthly',
		price_per_month: 9.99,
		price_ids: ['price_1QwPv5EcZgHXoWiHux7fbyWr'],
		description: `Write unlimited stories, invite unlimited collaborators, and upload up to 200GB of photos & videos. Additional storage is $1 per 100GB`,
		archived: false,
	},
	{
		id: 'yearly',
		name: 'Yearly',
		price_per_year: 99.99,
		price_ids: ['price_1QwPvKEcZgHXoWiHTV00Arvt'],
		description: `Write unlimited stories, invite unlimited collaborators, and upload up to 200GB of photos & videos. Additional storage is $1 per 100GB`,
		archived: false,
	},
] as const;
