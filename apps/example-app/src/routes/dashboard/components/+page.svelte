<script lang="ts">
	import { Input, Select, type SelectOption } from '@delightstack/components';
	import IconSearch from './IconSearch.svelte';
	import IconMail from './IconMail.svelte';
	import IconLock from './IconLock.svelte';

	/* ---- Input types ------------------------------------------------- */
	let text = $state('');
	let email = $state('');
	let password = $state('');
	let url = $state('');
	let tel = $state('');
	let search = $state('');
	let amount = $state<number | null>(null);

	/* ---- Label & placeholder behaviour ------------------------------ */
	let labelOnly = $state('');
	let labelMatch = $state('');
	let labelDistinct = $state('');
	let noLabel = $state('');

	/* ---- States ------------------------------------------------------ */
	let prefilled = $state('Brian Schwabauer');
	let requiredValue = $state('');

	/* ---- Date & time ------------------------------------------------- */
	let date = $state('');
	let dateFilled = $state('2026-05-20');
	let time = $state('');
	let datetime = $state('');

	/* ---- Colour & file ---------------------------------------------- */
	let color = $state('#005640');
	let file = $state<File | null>(null);
	let files = $state<File[]>([]);

	/* ---- Textarea ---------------------------------------------------- */
	let bio = $state('');
	let notes = $state('This textarea grows to fit its content as you type.');
	let counted = $state('');

	/* ---- Number ------------------------------------------------------ */
	let quantity = $state<number | null>(8);
	let price = $state<number | null>(null);
	let weight = $state<number | null>(null);

	/* ---- Adornments -------------------------------------------------- */
	let withIcon = $state('');
	let withPrefix = $state('');
	let withSuffix = $state('');
	let clearable = $state('Clear me');
	let withTooltip = $state('');

	/* ---- Autocomplete ------------------------------------------------ */
	let country = $state('');
	let fruit = $state('');

	/* ---- Chips ------------------------------------------------------- */
	let tags = $state<string[]>(['svelte', 'typescript']);
	let emptyTags = $state<string[]>([]);

	/* ---- Password ---------------------------------------------------- */
	let pwToggle = $state('');
	let pwStrength = $state('');

	/* ---- Mask -------------------------------------------------------- */
	let phone = $state('');
	let cardNumber = $state('');

	/* ---- Size & density --------------------------------------------- */
	let size0 = $state('');
	let size1 = $state('');
	let size2 = $state('');
	let size3 = $state('');
	let dense = $state('');
	let normal = $state('');
	let comfortable = $state('');

	const countries = [
		{ value: 'us', label: 'United States' },
		{ value: 'ca', label: 'Canada' },
		{ value: 'gb', label: 'United Kingdom' },
		{ value: 'au', label: 'Australia' },
		{ value: 'de', label: 'Germany' },
		{ value: 'fr', label: 'France' },
		{ value: 'jp', label: 'Japan' },
		{ value: 'br', label: 'Brazil', description: 'América do Sul' },
	];

	const fruitList = [
		'Apple',
		'Apricot',
		'Banana',
		'Blackberry',
		'Blueberry',
		'Cherry',
		'Grape',
		'Lemon',
		'Mango',
		'Orange',
		'Peach',
		'Pear',
		'Strawberry',
	];

	async function filterFruit(query: string) {
		await new Promise((resolve) => setTimeout(resolve, 450));
		const q = query.toLowerCase().trim();
		return fruitList
			.filter((f) => f.toLowerCase().includes(q))
			.map((f) => ({ value: f, label: f }));
	}

	/* ---- Select ------------------------------------------------------ */
	let selBasic = $state<unknown>(undefined);
	let selFilled = $state<unknown>('ca');
	let selPlaceholder = $state<unknown>(undefined);
	let selNoLabel = $state<unknown>(undefined);
	let selMulti = $state<unknown[]>(['us', 'jp']);
	let selSearch = $state<unknown>(undefined);
	let selClear = $state<unknown>('gb');
	let selColor = $state<unknown>(undefined);
	let selGroup = $state<unknown>(undefined);
	let selDesc = $state<unknown>('pro');
	let selError = $state<unknown>(undefined);
	let selS0 = $state<unknown>(undefined);
	let selS1 = $state<unknown>(undefined);
	let selS2 = $state<unknown>(undefined);
	let selS3 = $state<unknown>(undefined);
	let selDense = $state<unknown>(undefined);
	let selDefault = $state<unknown>(undefined);
	let selComfy = $state<unknown>(undefined);

	let createdColors = $state<SelectOption[]>([
		{ value: 'red', label: 'Red' },
		{ value: 'blue', label: 'Blue' },
	]);
	function createColor(detail: { value: string }): SelectOption {
		const created: SelectOption = {
			value: detail.value.toLowerCase(),
			label: detail.value,
		};
		createdColors = [...createdColors, created];
		// Returning the option lets the Select select it immediately.
		return created;
	}

	const groupedFood: SelectOption[] = [
		{ value: 'apple', label: 'Apple', group: 'Fruit' },
		{ value: 'banana', label: 'Banana', group: 'Fruit' },
		{ value: 'cherry', label: 'Cherry', group: 'Fruit' },
		{ value: 'carrot', label: 'Carrot', group: 'Vegetable' },
		{ value: 'potato', label: 'Potato', group: 'Vegetable' },
		{ value: 'spinach', label: 'Spinach', group: 'Vegetable' },
	];
	const plans: SelectOption[] = [
		{ value: 'free', label: 'Free', description: 'For getting started' },
		{ value: 'pro', label: 'Pro', description: '$12/mo, billed yearly' },
		{ value: 'team', label: 'Team', description: 'Up to 10 seats' },
		{ value: 'ent', label: 'Enterprise', description: 'Custom pricing', disabled: true },
	];
</script>

<svelte:head><title>Input — Component Showcase</title></svelte:head>

<div class="showcase">
	<header>
		<h1>Input</h1>
		<p>
			Every variation of the <code>Input</code>
			 component, for visual review.
		</p>
	</header>

	<!-- ============================================================ -->
	<section>
		<h2>Input types</h2>
		<div class="grid">
			<figure>
				<figcaption>text</figcaption>
				<Input label="Full name" bind:value={text} />
			</figure>
			<figure>
				<figcaption>email</figcaption>
				<Input type="email" label="Email address" bind:value={email} />
			</figure>
			<figure>
				<figcaption>password</figcaption>
				<Input type="password" label="Password" bind:value={password} />
			</figure>
			<figure>
				<figcaption>url</figcaption>
				<Input type="url" label="Website" bind:value={url} />
			</figure>
			<figure>
				<figcaption>tel</figcaption>
				<Input type="tel" label="Phone" bind:value={tel} />
			</figure>
			<figure>
				<figcaption>search</figcaption>
				<Input type="search" label="Search" bind:value={search} />
			</figure>
			<figure>
				<figcaption>number</figcaption>
				<Input type="number" label="Amount" bind:value={amount} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Label &amp; placeholder behaviour</h2>
		<p class="note">
			With no placeholder — or a placeholder equal to the label — the label animates up on
			focus. A placeholder that differs from the label keeps the label pinned to the top
			so the placeholder stays visible.
		</p>
		<div class="grid">
			<figure>
				<figcaption>label only — animates on focus</figcaption>
				<Input label="Email address" bind:value={labelOnly} />
			</figure>
			<figure>
				<figcaption>label + matching placeholder — animates</figcaption>
				<Input
					label="Email address"
					placeholder="Email address"
					bind:value={labelMatch} />
			</figure>
			<figure>
				<figcaption>label + distinct placeholder — label pinned</figcaption>
				<Input
					label="Email address"
					placeholder="you@example.com"
					bind:value={labelDistinct} />
			</figure>
			<figure>
				<figcaption>no label — plain placeholder</figcaption>
				<Input placeholder="Search anything…" bind:value={noLabel} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>States</h2>
		<div class="grid">
			<figure>
				<figcaption>default (empty)</figcaption>
				<Input label="First name" />
			</figure>
			<figure>
				<figcaption>filled</figcaption>
				<Input label="Full name" bind:value={prefilled} />
			</figure>
			<figure>
				<figcaption>required</figcaption>
				<Input label="Email address" required bind:value={requiredValue} />
			</figure>
			<figure>
				<figcaption>helper text</figcaption>
				<Input label="Username" helper="Letters, numbers and dashes only." />
			</figure>
			<figure>
				<figcaption>error</figcaption>
				<Input
					label="Email address"
					value="not-an-email"
					error="Enter a valid email address" />
			</figure>
			<figure>
				<figcaption>error (boolean, no message)</figcaption>
				<Input label="Code" value="abc" error />
			</figure>
			<figure>
				<figcaption>disabled</figcaption>
				<Input label="Account ID" value="acct_8841" disabled />
			</figure>
			<figure>
				<figcaption>readonly</figcaption>
				<Input label="Reference" value="REF-2026-0042" readonly />
			</figure>
			<figure>
				<figcaption>skeleton (loading)</figcaption>
				<Input label="Loading…" skeleton />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Date &amp; time</h2>
		<p class="note">
			These types render native content, so the label stays pinned to the top and never
			overlaps the browser's date format.
		</p>
		<div class="grid">
			<figure>
				<figcaption>date (empty)</figcaption>
				<Input type="date" label="Birthday" bind:value={date} />
			</figure>
			<figure>
				<figcaption>date (filled)</figcaption>
				<Input type="date" label="Start date" bind:value={dateFilled} />
			</figure>
			<figure>
				<figcaption>time</figcaption>
				<Input type="time" label="Reminder" bind:value={time} />
			</figure>
			<figure>
				<figcaption>datetime-local</figcaption>
				<Input type="datetime-local" label="Scheduled for" bind:value={datetime} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Colour &amp; file</h2>
		<div class="grid">
			<figure>
				<figcaption>color</figcaption>
				<Input type="color" label="Brand colour" bind:value={color} />
			</figure>
			<figure>
				<figcaption>file</figcaption>
				<Input type="file" label="Avatar" bind:value={file} />
			</figure>
			<figure>
				<figcaption>file — multiple</figcaption>
				<Input type="file" label="Attachments" multiple bind:value={files} />
			</figure>
			<figure>
				<figcaption>file — accept images</figcaption>
				<Input type="file" label="Photo" accept="image/*" />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Textarea</h2>
		<div class="grid">
			<figure>
				<figcaption>basic (3 rows)</figcaption>
				<Input type="textarea" label="Bio" bind:value={bio} />
			</figure>
			<figure>
				<figcaption>auto-resize</figcaption>
				<Input type="textarea" label="Notes" auto_resize bind:value={notes} />
			</figure>
			<figure>
				<figcaption>with counter</figcaption>
				<Input
					type="textarea"
					label="Message"
					maxlength={200}
					show_counter
					bind:value={counted} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Number</h2>
		<div class="grid">
			<figure>
				<figcaption>stepper</figcaption>
				<Input type="number" label="Quantity" bind:value={quantity} />
			</figure>
			<figure>
				<figcaption>min / max / step</figcaption>
				<Input
					type="number"
					label="Rating"
					min={0}
					max={10}
					step={0.5}
					bind:value={weight} />
			</figure>
			<figure>
				<figcaption>with prefix</figcaption>
				<Input type="number" label="Price" prefix="$" bind:value={price} />
			</figure>
			<figure>
				<figcaption>with suffix</figcaption>
				<Input type="number" label="Weight" suffix="kg" />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Adornments</h2>
		<div class="grid">
			<figure>
				<figcaption>leading icon</figcaption>
				<Input label="Search" icon={IconSearch} bind:value={withIcon} />
			</figure>
			<figure>
				<figcaption>leading icon + value</figcaption>
				<Input label="Email" icon={IconMail} value="hello@delight.dev" />
			</figure>
			<figure>
				<figcaption>prefix</figcaption>
				<Input label="Username" prefix="@" bind:value={withPrefix} />
			</figure>
			<figure>
				<figcaption>suffix</figcaption>
				<Input label="Subdomain" suffix=".delight.dev" bind:value={withSuffix} />
			</figure>
			<figure>
				<figcaption>clearable</figcaption>
				<Input label="Keyword" clearable bind:value={clearable} />
			</figure>
			<figure>
				<figcaption>tooltip</figcaption>
				<Input
					label="API key"
					tooltip="Find this in your dashboard settings."
					bind:value={withTooltip} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Autocomplete</h2>
		<div class="grid">
			<figure>
				<figcaption>static options</figcaption>
				<Input label="Country" options={countries} bind:value={country} />
			</figure>
			<figure>
				<figcaption>async filter (typeahead)</figcaption>
				<Input label="Favourite fruit" onfilter={filterFruit} bind:value={fruit} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Multiple / chips</h2>
		<div class="grid">
			<figure>
				<figcaption>tags — prefilled</figcaption>
				<Input label="Tags" multiple bind:value={tags} />
			</figure>
			<figure>
				<figcaption>tags — empty, distinct placeholder</figcaption>
				<Input label="Tags" multiple placeholder="Add a tag…" bind:value={emptyTags} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Password</h2>
		<div class="grid">
			<figure>
				<figcaption>visibility toggle</figcaption>
				<Input
					type="password"
					label="Password"
					show_toggle
					icon={IconLock}
					bind:value={pwToggle} />
			</figure>
			<figure>
				<figcaption>toggle + strength meter</figcaption>
				<Input
					type="password"
					label="New password"
					show_toggle
					strength_indicator
					bind:value={pwStrength} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Masked input</h2>
		<div class="grid">
			<figure>
				<figcaption>phone — (###) ###-####</figcaption>
				<Input label="Phone number" mask="(###) ###-####" bind:value={phone} />
			</figure>
			<figure>
				<figcaption>card — #### #### #### ####</figcaption>
				<Input label="Card number" mask="#### #### #### ####" bind:value={cardNumber} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Sizes</h2>
		<div class="grid">
			<figure>
				<figcaption>size 0</figcaption>
				<Input size="0" label="Size 0" bind:value={size0} />
			</figure>
			<figure>
				<figcaption>size 1 (default)</figcaption>
				<Input size="1" label="Size 1" bind:value={size1} />
			</figure>
			<figure>
				<figcaption>size 2</figcaption>
				<Input size="2" label="Size 2" bind:value={size2} />
			</figure>
			<figure>
				<figcaption>size 3</figcaption>
				<Input size="3" label="Size 3" bind:value={size3} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<section>
		<h2>Density</h2>
		<div class="grid">
			<figure>
				<figcaption>dense</figcaption>
				<Input dense label="Dense field" bind:value={dense} />
			</figure>
			<figure>
				<figcaption>default</figcaption>
				<Input label="Default field" bind:value={normal} />
			</figure>
			<figure>
				<figcaption>comfortable</figcaption>
				<Input comfortable label="Comfortable field" bind:value={comfortable} />
			</figure>
		</div>
	</section>

	<!-- ============================================================ -->
	<header class="select-header">
		<h1>Select</h1>
		<p>
			The <code>Select</code>
			component — legacy notched-outline styling, native
			<code>popover</code>
			 dropdown positioned with CSS anchor positioning.
		</p>
	</header>

	<section>
		<h2>Single select</h2>
		<div class="grid">
			<figure>
				<figcaption>label — animates</figcaption>
				<Select label="Country" options={countries} bind:value={selBasic} />
			</figure>
			<figure>
				<figcaption>filled</figcaption>
				<Select label="Country" options={countries} bind:value={selFilled} />
			</figure>
			<figure>
				<figcaption>label + distinct placeholder</figcaption>
				<Select
					label="Country"
					placeholder="Pick one…"
					options={countries}
					bind:value={selPlaceholder} />
			</figure>
			<figure>
				<figcaption>no label</figcaption>
				<Select
					placeholder="Select a country…"
					options={countries}
					bind:value={selNoLabel} />
			</figure>
		</div>
	</section>

	<section>
		<h2>Features</h2>
		<div class="grid">
			<figure>
				<figcaption>multiple (chips)</figcaption>
				<Select label="Countries" multiple options={countries} bind:value={selMulti} />
			</figure>
			<figure>
				<figcaption>searchable</figcaption>
				<Select label="Country" searchable options={countries} bind:value={selSearch} />
			</figure>
			<figure>
				<figcaption>clearable</figcaption>
				<Select label="Country" clearable options={countries} bind:value={selClear} />
			</figure>
			<figure>
				<figcaption>searchable + creatable</figcaption>
				<Select
					label="Colour"
					searchable
					creatable
					options={createdColors}
					oncreate={createColor}
					bind:value={selColor} />
			</figure>
			<figure>
				<figcaption>grouped options</figcaption>
				<Select label="Food" options={groupedFood} bind:value={selGroup} />
			</figure>
			<figure>
				<figcaption>option descriptions</figcaption>
				<Select label="Plan" options={plans} bind:value={selDesc} />
			</figure>
		</div>
	</section>

	<section>
		<h2>States</h2>
		<div class="grid">
			<figure>
				<figcaption>loading</figcaption>
				<Select label="Country" loading options={countries} />
			</figure>
			<figure>
				<figcaption>disabled</figcaption>
				<Select label="Country" disabled options={countries} value="ca" />
			</figure>
			<figure>
				<figcaption>error</figcaption>
				<Select
					label="Country"
					required
					error="Please choose a country"
					options={countries}
					bind:value={selError} />
			</figure>
			<figure>
				<figcaption>skeleton</figcaption>
				<Select label="Loading…" skeleton options={countries} />
			</figure>
		</div>
	</section>

	<section>
		<h2>Sizes</h2>
		<div class="grid">
			<figure>
				<figcaption>size 0</figcaption>
				<Select size="0" label="Size 0" options={countries} bind:value={selS0} />
			</figure>
			<figure>
				<figcaption>size 1 (default)</figcaption>
				<Select size="1" label="Size 1" options={countries} bind:value={selS1} />
			</figure>
			<figure>
				<figcaption>size 2</figcaption>
				<Select size="2" label="Size 2" options={countries} bind:value={selS2} />
			</figure>
			<figure>
				<figcaption>size 3</figcaption>
				<Select size="3" label="Size 3" options={countries} bind:value={selS3} />
			</figure>
		</div>
	</section>

	<section>
		<h2>Density</h2>
		<div class="grid">
			<figure>
				<figcaption>dense</figcaption>
				<Select dense label="Dense" options={countries} bind:value={selDense} />
			</figure>
			<figure>
				<figcaption>default</figcaption>
				<Select label="Default" options={countries} bind:value={selDefault} />
			</figure>
			<figure>
				<figcaption>comfortable</figcaption>
				<Select
					comfortable
					label="Comfortable"
					options={countries}
					bind:value={selComfy} />
			</figure>
		</div>
	</section>
</div>

<style>
	.showcase {
		display: flex;
		flex-direction: column;
		gap: var(--size-7);
		padding-bottom: var(--size-9);
	}

	header h1 {
		font-family: var(--font-serif);
	}
	header p {
		color: var(--color-text-disabled);
		margin-top: var(--size-1);
	}
	.select-header {
		margin-top: var(--size-6);
		padding-top: var(--size-6);
		border-top: 1px solid var(--color-outline);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
		background: var(--color-bg-2);
		padding: 0.1em 0.35em;
		border-radius: var(--radius-1);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--size-4);
	}
	section h2 {
		padding-bottom: var(--size-2);
		border-bottom: 1px solid var(--color-outline);
	}
	.note {
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		max-width: 60ch;
		margin-top: calc(var(--size-2) * -1);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--size-5) var(--size-4);
		align-items: start;
	}

	figure {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
	}
	figcaption {
		font-size: var(--font-size-00);
		font-weight: var(--font-weight-6);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-disabled);
	}
</style>
