<script lang="ts">
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	let stopCannon: (() => void) | undefined;
	let running = $state(false);

	function startCannon() {
		running = true;
		stopCannon = confetti.cannon({ duration: 10000 });
		setTimeout(() => (running = false), 10000);
	}

	function stopAll() {
		stopCannon?.();
		confetti.stop();
		running = false;
	}
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={startCannon} disabled={running}>Start Cannon</Button>
	<Button outline onclick={() => stopCannon?.()}>Stop Cannon</Button>
	<Button outline onclick={stopAll}>Stop All</Button>
</div>
