<script lang="ts">
	import { Input } from '$lib/form';
</script>

<section>
	<nav>
		<Input
			multiple
			value={['Kansas City']}
			label="Search locations, people, stories, etc."></Input>
	</nav>
	<div class="map"></div>
</section>

<style>
	nav {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background-color: var(--c-bg-0);
		max-width: 800px;
		width: 100%;
		padding: 0.5rem 1rem;
		box-shadow: var(--shadow-3);
		border-radius: var(--radius-4);
		margin-top: 0.5rem;
	}
	section {
		width: 100%;
		height: 100vh;
		position: relative;
		display: flex;
		align-items: start;
		justify-content: center;
	}

	.map {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--c-bg-5);
		z-index: -1;
	}
</style>
