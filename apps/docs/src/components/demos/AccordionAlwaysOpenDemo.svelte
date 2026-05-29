<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let value = $state('first');
</script>

<Accordion collapsible={false} bind:value>
	<AccordionItem value="first" title="Always Visible">
		<p>At least one section is always open.</p>
	</AccordionItem>
	<AccordionItem value="second" title="Another Section">
		<p>Click to switch which section is open.</p>
	</AccordionItem>
</Accordion>
