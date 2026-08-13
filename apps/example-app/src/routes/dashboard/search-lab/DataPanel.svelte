<script lang="ts">
	import {
		Button,
		Callout,
		Checkbox,
		Form,
		Input,
		Select,
		Stat,
		toast,
	} from '@delightstack/components';
	import { confetti } from '@delightstack/components/feedback';
	import type { DatabaseClient } from '@delightstack/database/client';
	import { DelightError } from '@delightstack/utilities';
	import type { tables } from '$lib/schema';
	import { DEFAULT_PLACE_COUNT, DEFAULT_SEED } from '$lib/search-lab/seed';
	import Panel from './Panel.svelte';
	import PlaceForm from './PlaceForm.svelte';

	interface Props {
		db: DatabaseClient<typeof tables>;
		/** Corpus sizes from the page load, kept current after a reseed. */
		counts: { places: number; organizations: number };
	}

	let { db, counts = $bindable() }: Props = $props();

	let seed = $state(DEFAULT_SEED);
	let place_count = $state(DEFAULT_PLACE_COUNT);
	let seeding = $state(false);
	let seed_error = $state<string | null>(null);

	let organization_id = $state<string | null>(null);
	let organization_key = $state(0);

	let place_query = $state('');
	let selected_place_id = $state<string | null>(null);
	let editing_place = $state(false);

	const organizations = $derived(
		db.search('organization', () => ({
			limit: 50,
			order: [{ field: 'name', direction: 'ASC' as const }],
		})),
	);

	const places = $derived(db.search('place', () => ({ term: place_query, limit: 12 })));

	const organization_options = $derived(
		organizations.results.map((hit) => ({
			value: hit.id,
			label: String(hit.document.name ?? hit.id),
		})),
	);

	async function reseed(event: MouseEvent) {
		seeding = true;
		seed_error = null;
		const was_empty = counts.places === 0;
		try {
			const response = await fetch('/api/search-lab/seed', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ seed, place_count }),
			});
			const body = (await response.json()) as {
				places?: number;
				organizations?: number;
				elapsed_ms?: number;
				message?: string;
			};
			if (!response.ok) throw new DelightError(body.message ?? 'Seeding failed');
			counts = {
				places: body.places ?? 0,
				organizations: body.organizations ?? 0,
			};
			selected_place_id = null;
			editing_place = false;
			toast.success(
				`Wrote ${body.places} places and ${body.organizations} organizations in ${body.elapsed_ms} ms.`,
			);
			// The lab only becomes usable once, and this is the moment.
			if (was_empty) confetti.burst({ target: event });
		} catch (error) {
			seed_error = DelightError.from(error).message;
		} finally {
			seeding = false;
		}
	}

	function newOrganization() {
		organization_id = null;
		organization_key += 1;
	}

	async function deleteOrganization(id: string) {
		try {
			await db.delete('organization', id);
			if (organization_id === id) newOrganization();
			toast.success('Deleted. Its places cascaded out with it.');
		} catch (error) {
			toast.error(DelightError.from(error).message);
		}
	}
</script>

<Panel
	title="Data"
	blurb="create · update · delete · validation · foreign keys · optimistic writes">
	{#snippet controls()}
		<div class="stats">
			<Stat label="Places" value={counts.places} size="0" />
			<Stat label="Organizations" value={counts.organizations} size="0" />
		</div>

		<div class="group">
			<h5>Reseed</h5>
			<Input
				type="number"
				label="Seed"
				description="Same seed, same corpus — including every vector."
				bind:value={() => seed, (next) => (seed = Number(next) || DEFAULT_SEED)} />
			<Input
				type="number"
				label="Places"
				min={1}
				max={1000}
				bind:value={
					() => place_count,
					(next) => (place_count = Math.max(1, Math.min(1000, Number(next) || 1)))
				} />
			<Button onclick={reseed} loading={seeding}>
				{counts.places > 0 ? 'Wipe and regenerate' : 'Generate the corpus'}
			</Button>
			{#if seed_error}
				<p class="error" role="alert">{seed_error}</p>
			{/if}
		</div>

		<Callout warning title="Reseeding deletes everything">
			Places go first, then organizations, so nothing leaves the search index through a
			cascade. On a fresh org this takes a few seconds.
		</Callout>
	{/snippet}

	<section>
		<header>
			<h4>Organizations</h4>
			<Button dense outline onclick={newOrganization}>New organization</Button>
		</header>

		<ul>
			{#each organizations.results as organization (organization.id)}
				<li class:selected={organization_id === organization.id}>
					<button
						type="button"
						onclick={() => {
							organization_id = organization.id;
							organization_key += 1;
						}}>
						{String(organization.document.name ?? organization.id)}
					</button>
					<span class="kind">{String(organization.document.kind ?? '')}</span>
					<Button
						dense
						transparent
						error
						onclick={() => deleteOrganization(organization.id)}
						tooltip="Cascades to every place it owns">
						Delete
					</Button>
				</li>
			{/each}
		</ul>

		{#key organization_key}
			{@const organization = db.entity('organization', organization_id ?? undefined)}
			<Form
				entity={organization}
				onsaved={() => toast.success('Saved — every place under it was reindexed.')}>
				<div class="row">
					<Input {...organization.form.field.name} />
					<Select {...organization.form.field.kind} />
				</div>
				<div class="row">
					<Input {...organization.form.field.founded_year} />
					<Input {...organization.form.field.contact_email} />
				</div>
				<Checkbox {...organization.form.field.verified} />
				<footer>
					<Button type="submit">
						{organization_id ? 'Save organization' : 'Create organization'}
					</Button>
					{#if organization.has_changes}
						<Button transparent onclick={() => organization.reset()}>Discard</Button>
					{/if}
				</footer>
			</Form>
		{/key}
	</section>

	<section>
		<header>
			<h4>Places</h4>
			<Button
				dense
				outline
				onclick={() => {
					selected_place_id = null;
					editing_place = true;
				}}>
				New place
			</Button>
		</header>

		<Input
			type="search"
			label="Find a place to edit"
			placeholder="Search by name or description"
			clearable
			bind:value={() => place_query, (next) => (place_query = String(next ?? ''))} />

		<ul>
			{#each places.results as place (place.id)}
				<li class:selected={selected_place_id === place.id}>
					<button
						type="button"
						onclick={() => {
							selected_place_id = place.id;
							editing_place = true;
						}}>
						{String(place.document.name ?? place.id)}
					</button>
					<span class="kind">
						{String(place.document.category ?? '')} ·
						{String(
							(place.document.address as { city?: string } | undefined)?.city ?? '',
						)}
					</span>
				</li>
			{/each}
		</ul>

		{#if editing_place}
			{#key selected_place_id}
				<PlaceForm
					{db}
					place_id={selected_place_id}
					organizations={organization_options}
					onsaved={(id) => {
						selected_place_id = id;
					}}
					ondeleted={() => {
						selected_place_id = null;
						editing_place = false;
					}}
					oncancel={() => (editing_place = false)} />
			{/key}
		{/if}
	</section>
</Panel>

<style>
	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h5 {
			font-size: var(--font-size-00);
			font-weight: 600;
			color: var(--color-text-muted);
		}
	}

	.error {
		font-size: var(--font-size-00);
		color: var(--color-error-text);
		background: var(--color-error-bg);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--color-border);

		h4 {
			font-size: var(--font-size-1);
			font-family: var(--font-serif);
		}
	}

	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		max-height: 16rem;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		border-bottom: 1px solid var(--color-border);
		transition: background-color 280ms;

		&:hover {
			background-color: oklch(from var(--color-action) l c h / 0.08);
			transition: none;
		}
		&.selected {
			background-color: oklch(from var(--color-action) l c h / 0.14);
		}
		&:last-child {
			border-bottom: none;
		}

		button {
			flex: 1;
			text-align: left;
			padding: var(--space-2) var(--space-2);
			cursor: pointer;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.kind {
		font-size: var(--font-size-00);
		color: var(--color-text-disabled);
		white-space: nowrap;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);

		@media (max-width: 560px) {
			grid-template-columns: 1fr;
		}
	}

	footer {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}
</style>
