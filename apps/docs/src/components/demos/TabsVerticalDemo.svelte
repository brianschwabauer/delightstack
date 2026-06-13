<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

{#snippet general()}
	<p style="margin: 0;">General settings — your name, language, and time zone.</p>
{/snippet}
{#snippet security()}
	<p style="margin: 0;">Security settings — password, sessions, and 2FA.</p>
{/snippet}
{#snippet notifications()}
	<p style="margin: 0;">Notification settings — email and push preferences.</p>
{/snippet}

<div style="width: 100%;">
	<Tabs
		bind:tab
		orientation="vertical"
		tabs={[
			{ label: 'General', content: general },
			{ label: 'Security', content: security },
			{ label: 'Notifications', content: notifications },
		]} />
</div>
