<script lang="ts">
	import { Input } from '$lib/form';
</script>

<section>
	<nav>
		<Input multiple value={['Brian Schwabauer']} label="Search people..."></Input>
	</nav>
</section>

<style>
	nav {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 800px;
		width: 100%;
		padding: 0.5rem 1rem;
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
</style>
