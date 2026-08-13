<script lang="ts">
	import {
		Button,
		Fieldset,
		Input,
		Range,
		Select,
		Toggle,
		toast,
	} from '@delightstack/components';
	import type { DatabaseClient } from '@delightstack/database/client';
	import { DelightError } from '@delightstack/utilities';
	import type { tables } from '$lib/schema';
	import { embed } from '$lib/search-lab/embedding';
	import {
		CITIES,
		COUNTRIES,
		PLACE_AMENITIES,
		PLACE_CATEGORIES,
		PLACE_STATUSES,
		type Country,
		type PlaceAmenity,
		type PlaceCategory,
		type PlaceStatus,
	} from '$lib/search-lab/seed';

	interface PlaceDraft {
		name: string;
		description: string;
		category: PlaceCategory;
		status: PlaceStatus;
		price: number | null;
		rating: number | null;
		open_late: boolean;
		tags: string[];
		amenities: PlaceAmenity[];
		address: { city: string; country: Country };
		location: { lat: number; lon: number };
		organization_id: string;
	}

	interface Props {
		db: DatabaseClient<typeof tables>;
		/** The place being edited, or `null` to create a new one. */
		place_id: string | null;
		organizations: { value: string; label: string }[];
		onsaved?: (id: string) => void;
		ondeleted?: () => void;
		oncancel?: () => void;
	}

	let { db, place_id, organizations, onsaved, ondeleted, oncancel }: Props = $props();

	const CATEGORY_OPTIONS = PLACE_CATEGORIES.map((value) => ({ value, label: value }));
	const STATUS_OPTIONS = PLACE_STATUSES.map((value) => ({ value, label: value }));
	const AMENITY_OPTIONS = PLACE_AMENITIES.map((value) => ({
		value,
		label: value.replace(/_/g, ' '),
	}));
	const COUNTRY_OPTIONS = COUNTRIES.map((value) => ({ value, label: value }));

	function emptyDraft(): PlaceDraft {
		const city = CITIES[0];
		return {
			name: '',
			description: '',
			category: 'cafe',
			status: 'open',
			price: 20,
			rating: 4,
			open_late: false,
			tags: [],
			amenities: [],
			address: { city: city.city, country: city.country },
			location: { lat: city.lat, lon: city.lon },
			organization_id: organizations[0]?.value ?? '',
		};
	}

	let draft = $state<PlaceDraft>(emptyDraft());
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Load whenever the selection changes. `db.get` reads the IDB cache after
	// hydration, so switching between places is instant on the second visit.
	$effect(() => {
		const id = place_id;
		if (!id) {
			draft = emptyDraft();
			error = null;
			return;
		}
		let cancelled = false;
		loading = true;
		db.get('place', id)
			.then((entity) => {
				if (cancelled) return;
				const record = entity as unknown as Partial<PlaceDraft>;
				draft = {
					...emptyDraft(),
					...record,
					address: { ...emptyDraft().address, ...record.address },
					location: { ...emptyDraft().location, ...record.location },
					tags: record.tags ?? [],
					amenities: record.amenities ?? [],
				};
				error = null;
			})
			.catch((cause: unknown) => {
				if (!cancelled) error = DelightError.from(cause).message;
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	/**
	 * The embedding is a pure function of the same three fields the seeder used,
	 * so a hand-edited place lands in the same vector space as a generated one.
	 */
	function embedDraft(place: PlaceDraft): number[] {
		return embed(`${place.name} ${place.category} ${place.description}`);
	}

	async function save() {
		error = null;
		const payload = { ...$state.snapshot(draft), embedding: embedDraft(draft) };
		try {
			if (place_id) {
				await db.update('place', place_id, payload);
				toast.success('Saved — search results and facets are already updated.');
				onsaved?.(place_id);
			} else {
				const created = (await db.create('place', payload)) as { id: string };
				toast.success('Created — it is in the index before the echo lands.');
				onsaved?.(created.id);
			}
		} catch (cause) {
			// Validation failures come back as a DelightError with the offending
			// field named, which is exactly what belongs next to the form.
			error = DelightError.from(cause).message;
		}
	}

	async function remove() {
		if (!place_id) return;
		try {
			await db.delete('place', place_id);
			toast.success('Deleted — the tombstone removes it from every synced client.');
			ondeleted?.();
		} catch (cause) {
			error = DelightError.from(cause).message;
		}
	}
</script>

<form
	onsubmit={(event) => {
		event.preventDefault();
		void save();
	}}>
	<Fieldset label={place_id ? 'Edit place' : 'New place'} bordered>
		<Input
			label="Name"
			required
			bind:value={() => draft.name, (next) => (draft.name = String(next ?? ''))} />

		<Input
			type="textarea"
			rows={4}
			label="Description"
			description="Indexed for full text, and hashed into the 64-dimension embedding on save."
			bind:value={
				() => draft.description, (next) => (draft.description = String(next ?? ''))
			} />

		<div class="row">
			<Select
				label="Category"
				options={CATEGORY_OPTIONS}
				bind:value={
					() => draft.category,
					(next) => (draft.category = (next as PlaceCategory | undefined) ?? 'cafe')
				} />
			<Select
				label="Status"
				options={STATUS_OPTIONS}
				bind:value={
					() => draft.status,
					(next) => (draft.status = (next as PlaceStatus | undefined) ?? 'open')
				} />
		</div>

		<div class="row">
			<Input
				type="number"
				label="Typical spend"
				min={0}
				max={1000}
				bind:value={
					() => draft.price ?? '',
					(next) => (draft.price = next === '' || next === null ? null : Number(next))
				} />
			<Range
				min={0}
				max={5}
				step={0.1}
				show_value
				label="Rating"
				bind:value={() => draft.rating ?? 0, (next) => (draft.rating = next as number)} />
		</div>

		<Toggle bind:checked={draft.open_late} label="Open late" />

		<Select
			multiple
			creatable
			searchable
			label="Tags (string[])"
			options={draft.tags.map((value) => ({ value, label: value }))}
			bind:value={
				() => draft.tags, (next) => (draft.tags = (next as string[] | undefined) ?? [])
			} />

		<Select
			multiple
			label="Amenities (enum[])"
			options={AMENITY_OPTIONS}
			bind:value={
				() => draft.amenities,
				(next) => (draft.amenities = (next as PlaceAmenity[] | undefined) ?? [])
			} />
	</Fieldset>

	<Fieldset label="Where" bordered>
		<div class="row">
			<Input
				label="address.city"
				bind:value={
					() => draft.address.city, (next) => (draft.address.city = String(next ?? ''))
				} />
			<Select
				label="address.country"
				options={COUNTRY_OPTIONS}
				bind:value={
					() => draft.address.country,
					(next) => (draft.address.country = (next as Country | undefined) ?? 'US')
				} />
		</div>
		<div class="row">
			<Input
				type="number"
				label="location.lat"
				step={0.0001}
				bind:value={
					() => draft.location.lat, (next) => (draft.location.lat = Number(next) || 0)
				} />
			<Input
				type="number"
				label="location.lon"
				step={0.0001}
				bind:value={
					() => draft.location.lon, (next) => (draft.location.lon = Number(next) || 0)
				} />
		</div>
		<Select
			label="Organization (foreign key)"
			description="organization_name is derived through this key — it is never stored on the place."
			options={organizations}
			bind:value={
				() => draft.organization_id,
				(next) => (draft.organization_id = String(next ?? ''))
			} />
	</Fieldset>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<footer>
		<Button type="submit" disabled={loading || !draft.name.trim()}>
			{place_id ? 'Save changes' : 'Create place'}
		</Button>
		{#if place_id}
			<Button outline error onclick={remove}>Delete</Button>
		{/if}
		<Button transparent onclick={() => oncancel?.()}>Cancel</Button>
	</footer>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);

		@media (max-width: 560px) {
			grid-template-columns: 1fr;
		}
	}

	.error {
		font-size: var(--font-size-00);
		color: var(--color-error-text);
		background: var(--color-error-bg);
		padding: var(--space-3);
		border-radius: var(--radius-md);
	}

	footer {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		flex-wrap: wrap;
	}
</style>
