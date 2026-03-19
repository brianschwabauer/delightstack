<script>
	import { Checkbox } from '@delightstack/components/form';

	let notifications = $state(['email', 'push']);

	function toggle(val) {
		if (notifications.includes(val)) {
			notifications = notifications.filter((v) => v !== val);
		} else {
			notifications = [...notifications, val];
		}
	}
</script>

<div>
	<p style="margin: 0 0 0.5rem; font-weight: 600;">Notification preferences</p>
	<div style="display: flex; flex-direction: column; gap: 0.25rem;">
		<Checkbox
			checked={notifications.includes('email')}
			onchange={() => toggle('email')}
			label="Email notifications"
		/>
		<Checkbox
			checked={notifications.includes('sms')}
			onchange={() => toggle('sms')}
			label="SMS notifications"
		/>
		<Checkbox
			checked={notifications.includes('push')}
			onchange={() => toggle('push')}
			label="Push notifications"
		/>
	</div>
	<p style="margin: 0.5rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
		Selected: {notifications.join(', ') || 'none'}
	</p>
</div>
