<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let denseValue = $state('a');
	let comfortableValue = $state('a');
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem;">
	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">Dense</p>
		<Accordion dense bind:value={denseValue}>
			<AccordionItem value="a" title="Compact Item A">
				<p>Less padding for dense layouts.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Compact Item B">
				<p>Tighter spacing between items.</p>
			</AccordionItem>
		</Accordion>
	</div>

	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">Comfortable</p>
		<Accordion comfortable bind:value={comfortableValue}>
			<AccordionItem value="a" title="Spacious Item A">
				<p>More padding for a relaxed feel.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Spacious Item B">
				<p>Extra breathing room between items.</p>
			</AccordionItem>
		</Accordion>
	</div>
</div>
