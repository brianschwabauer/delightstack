<script lang="ts">
	import { Button, Callout, Code, Input, Stat, toast } from '@delightstack/components';
	import { DelightError } from '@delightstack/utilities';
	import type { AppDatabase } from '$lib/clients';
	import Panel from './Panel.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery, type LabHit } from './lab.svelte';

	interface Props {
		db: AppDatabase;
	}

	let { db }: Props = $props();

	const OVERRIDE_SNIPPET = `// apps/example-app/src/routes/dashboard/+layout.ts
const clients = await createClients({
  auth,
  fetch,
  dev,
  entities: {
    place: { search_mode: 'server' },  // never answer locally
    // place: { search_mode: 'client' }, // answer locally mid-backfill
  },
});`;

	let term = $state('coffee');
	let renaming = $state<string | null>(null);
	let draft_name = $state('');

	// The routed path: the coverage policy decides where this is answered, and
	// `search.mode` reports the decision per query.
	const search = $derived(db.list('place', () => ({ term, limit: 20 })));
	const organizations = $derived(
		db.list('organization', () => ({
			limit: 20,
			order: [{ field: 'name', direction: 'ASC' as const }],
		})),
	);

	// The same query, forced through the server endpoint, for comparison.
	const server = new LabRunner('place');

	$effect(() => {
		server.schedule(pruneQuery({ term, limit: 20, sparse: true }));
	});

	const client_hits = $derived(
		search.hits.map(
			(hit): LabHit => ({
				id: hit.id,
				score: hit.score,
				document: hit.document as unknown as Record<string, unknown>,
			}),
		),
	);

	const counts_agree = $derived(
		server.result !== null && search.status === 'ready' && search.count === server.result.count,
	);

	function startRename(id: string, name: string) {
		renaming = id;
		draft_name = name;
	}

	async function saveRename() {
		if (!renaming) return;
		const id = renaming;
		const name = draft_name.trim();
		if (!name) return;
		try {
			await db.update('organization', id, { name });
			renaming = null;
			// The place rows never stored this name — the server recomputed every
			// dependent `organization_name` and reindexed each place.
			await server.run(pruneQuery({ term, limit: 20, sparse: true }));
			toast.success(`Renamed to “${name}” — every place reindexed.`);
		} catch (error) {
			toast.error(DelightError.from(error).message);
		}
	}

	async function deleteFirstHit() {
		const first = search.hits[0];
		if (!first) return;
		const name = String(
			(first.document as unknown as Record<string, unknown>).name ?? first.id,
		);
		try {
			await db.delete('place', first.id);
			await server.run(pruneQuery({ term, limit: 20, sparse: true }));
			toast.success(`Deleted “${name}”. Reseed on the Data tab to bring it back.`);
		} catch (error) {
			toast.error(DelightError.from(error).message);
		}
	}
</script>

<Panel
	title="Routing &amp; live updates"
	blurb="db.list() coverage routing · search_mode · derived-field cascade · tombstones">
	{#snippet controls()}
		<Input
			type="search"
			label="Term (both sides)"
			clearable
			bind:value={() => term, (next) => (term = String(next ?? ''))} />

		<div class="stats">
			<Stat label="Answered by" value={search.mode} size="0" />
			<Stat
				label="Initial sync"
				value={db.synced ? 'complete' : db.syncing ? 'running' : 'idle'}
				size="0" />
		</div>

		<Callout tip title="How the decision is made">
			A query carrying <code>vector</code>
			always goes to the server. Otherwise the local index answers only once its synced window
			covers the whole table; until then the server has the corpus statistics that make relevance
			correct.
		</Callout>

		<div class="group">
			<h5>Forcing the decision</h5>
			<p class="muted">
				There is no per-query override by design — it is a per-entity choice made where
				the client is constructed:
			</p>
			<Code
				code={OVERRIDE_SNIPPET}
				language="typescript"
				show_line_numbers={false}
				wrap />
		</div>
	{/snippet}

	<section class="compare">
		<div>
			<h4>
				Client — <code>db.list()</code>
				<span>{search.count.toLocaleString()} matches · {search.mode}</span>
			</h4>
			<ResultList
				hits={client_hits.slice(0, 8)}
				loading={search.status === 'loading'}
				error={search.error ? DelightError.from(search.error).message : null}
				empty_hint="Nothing matched locally." />
		</div>
		<div>
			<h4>
				Server — <code>db.list(&lcub; source: 'server' &rcub;)</code>
				<span>{(server.result?.count ?? 0).toLocaleString()} matches · server</span>
			</h4>
			<ResultList
				hits={(server.result?.hits ?? []).slice(0, 8)}
				loading={server.loading}
				error={server.error}
				empty_hint="Nothing matched on the server." />
		</div>
	</section>

	<p class="verdict" class:agree={counts_agree}>
		{#if search.status === 'loading' || server.loading}
			Comparing…
		{:else if counts_agree}
			Both corpora agree — {search.count.toLocaleString()} matches either way.
		{:else}
			Counts differ ({search.count.toLocaleString()} local vs
			{(server.result?.count ?? 0).toLocaleString()} server). That is expected mid-backfill:
			a partial local window is a different corpus, and the server's answer is the authoritative
			one.
		{/if}
	</p>

	<section class="live">
		<h4>Watch a write propagate</h4>
		<p class="muted">
			<code>organization_name</code>
			is never stored on a place row. Rename an organization and the server recomputes it for
			every place that references it, reindexes them, and pushes the change to both panes above.
		</p>

		<ul>
			{#each organizations.hits as organization (organization.id)}
				{@const name = String(organization.document.name ?? '')}
				<li>
					{#if renaming === organization.id}
						<Input
							label="New name"
							bind:value={
								() => draft_name, (next) => (draft_name = String(next ?? ''))
							} />
						<Button onclick={saveRename}>Save</Button>
						<Button transparent onclick={() => (renaming = null)}>Cancel</Button>
					{:else}
						<span class="name">{name}</span>
						<Button dense outline onclick={() => startRename(organization.id, name)}>
							Rename
						</Button>
					{/if}
				</li>
			{/each}
		</ul>

		<Button
			outline
			error
			onclick={deleteFirstHit}
			disabled={search.hits.length === 0}
			tooltip="Deletes the top client-side hit and re-runs both panes">
			Delete the top match
		</Button>
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
		gap: var(--space-2);

		h5 {
			font-size: var(--font-size-00);
			font-weight: 600;
			color: var(--color-text-muted);
		}
	}

	.muted {
		font-size: var(--font-size-00);
		color: var(--color-text-muted);
	}

	.compare {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: var(--space-6);

		div {
			min-width: 0;
		}
	}

	h4 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--font-size-0);
		font-weight: 600;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--color-border);

		span {
			font-size: var(--font-size-00);
			font-weight: 400;
			color: var(--color-text-disabled);
		}
	}

	.verdict {
		font-size: var(--font-size-00);
		color: var(--color-text-muted);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-bg-1);

		&.agree {
			color: var(--color-success-text);
			background: var(--color-success-bg);
		}
	}
	@supports (corner-shape: squircle) {
		.verdict {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md) * 2);
		}
	}

	.live {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: start;

		ul {
			list-style: none;
			width: 100%;
			display: flex;
			flex-direction: column;
		}

		li {
			display: flex;
			align-items: center;
			gap: var(--space-3);
			padding: var(--space-2) 0;
			border-bottom: 1px solid var(--color-border);

			&:last-child {
				border-bottom: none;
			}
		}
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
