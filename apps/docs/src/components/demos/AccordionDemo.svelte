<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let value = $state('item-1');
</script>

<Accordion bind:value>
	<AccordionItem value="item-1" title="Getting Started">
		<p>Getting started is easy! Create an account and follow the onboarding steps.</p>
	</AccordionItem>
	<AccordionItem value="item-2" title="Payment Methods">
		<p>We accept all major credit cards, PayPal, and bank transfers.</p>
	</AccordionItem>
	<AccordionItem value="item-3" title="Contact Support">
		<p>Reach our support team via email or through the in-app chat.</p>
	</AccordionItem>
</Accordion>
