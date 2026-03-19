<script>
	import { Toggle } from '@delightstack/components/form';

	let settings = $state({
		notifications: true,
		autoSave: true,
		sounds: false,
	});
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<Toggle
		bind:checked={settings.notifications}
		label="Push Notifications"
		name="notifications"
		value="enabled"
	/>
	<Toggle
		bind:checked={settings.autoSave}
		label="Auto-save"
		name="autosave"
		value="enabled"
	/>
	<Toggle
		bind:checked={settings.sounds}
		label="Sound Effects"
		name="sounds"
		value="enabled"
	/>
</div>
