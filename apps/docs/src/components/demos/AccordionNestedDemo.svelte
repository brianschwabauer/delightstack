<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let outerValue = $state('parent-1');
	let innerValue = $state('');
</script>

<Accordion bind:value={outerValue}>
	<AccordionItem value="parent-1" title="Frontend Frameworks">
		<Accordion bind:value={innerValue}>
			<AccordionItem value="child-1" title="Svelte">
				<p>A compiler-based framework that shifts work to build time for smaller, faster apps.</p>
			</AccordionItem>
			<AccordionItem value="child-2" title="React">
				<p>A library for building user interfaces with a virtual DOM and component model.</p>
			</AccordionItem>
		</Accordion>
	</AccordionItem>
	<AccordionItem value="parent-2" title="Backend Languages">
		<p>Popular choices include Node.js, Python, Go, and Rust.</p>
	</AccordionItem>
</Accordion>
