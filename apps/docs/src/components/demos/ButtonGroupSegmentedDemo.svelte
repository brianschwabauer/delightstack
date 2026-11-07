<script>
	import { ButtonGroup, Button } from '@delightstack/components/actions';

	let range = $state('week');
	let weight = $state(400);
	let view = $state('list');
</script>

<div class="demo">
	<ButtonGroup bind:value={range} aria-label="Date range">
		<Button value="day">Day</Button>
		<Button value="week">Week</Button>
		<Button value="month">Month</Button>
	</ButtonGroup>

	<!-- Show the option, don't name it: each choice renders its own weight. -->
	<ButtonGroup bind:value={weight} aria-label="Font weight">
		<Button value={300} tooltip="Light" aria-label="Light">
			<span style:font-weight="300">Aa</span>
		</Button>
		<Button value={400} tooltip="Regular" aria-label="Regular">
			<span style:font-weight="400">Aa</span>
		</Button>
		<Button value={700} tooltip="Bold" aria-label="Bold">
			<span style:font-weight="700">Aa</span>
		</Button>
	</ButtonGroup>

	<!-- `translucent`: the selected option is a neutral chip, not a brand fill,
	     for secondary controls that shouldn't compete with the page's actions. -->
	<ButtonGroup bind:value={view} translucent aria-label="View">
		<Button value="list">List</Button>
		<Button value="board">Board</Button>
		<Button value="calendar">Calendar</Button>
	</ButtonGroup>

	<p>Showing the {range} at weight {weight}, as a {view}.</p>
</div>

<style>
	.demo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.5rem;
	}

	p {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
</style>
