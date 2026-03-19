<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let value = $state(['section-1']);
</script>

<Accordion multiple bind:value>
	<AccordionItem value="section-1" title="First Section">
		<p>Content for the first section.</p>
	</AccordionItem>
	<AccordionItem value="section-2" title="Second Section">
		<p>Content for the second section.</p>
	</AccordionItem>
	<AccordionItem value="section-3" title="Third Section">
		<p>Content for the third section.</p>
	</AccordionItem>
</Accordion>
