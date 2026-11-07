<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let value = $state('first');
</script>

<Accordion collapsible={false} bind:value>
	<AccordionItem value="first" title="Always visible">
		<p>At least one section is always open.</p>
	</AccordionItem>
	<AccordionItem value="second" title="Another section">
		<p>Click to switch which section is open.</p>
	</AccordionItem>
</Accordion>
