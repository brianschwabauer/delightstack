<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Accordion skeleton={loading} skeleton_count={3}>
			<AccordionItem value="faq-1" title="Getting Started">
				<p>Getting started is easy! Create an account and follow the onboarding steps.</p>
			</AccordionItem>
			<AccordionItem value="faq-2" title="Payment Methods">
				<p>We accept all major credit cards, PayPal, and bank transfers.</p>
			</AccordionItem>
			<AccordionItem value="faq-3" title="Contact Support">
				<p>Reach our support team via email or through the in-app chat.</p>
			</AccordionItem>
		</Accordion>
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
</style>
