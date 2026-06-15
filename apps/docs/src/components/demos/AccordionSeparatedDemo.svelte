<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let outlineValue = $state('b');
	let filledValue = $state('b');
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem;">
	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">
			Outline + separated
		</p>
		<Accordion outline separated bind:value={outlineValue}>
			<AccordionItem value="a" title="Connected when closed">
				<p>While every item is closed the frame reads as one continuous outline.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Splits to its own piece">
				<p>
					Open an item and it animates apart into its own rounded box — the item above
					rounds its bottom, this one rounds top and bottom, and the item below rounds its
					top.
				</p>
			</AccordionItem>
			<AccordionItem value="c" title="Rejoins on close">
				<p>Close it again and the pieces glide back into a single frame.</p>
			</AccordionItem>
		</Accordion>
	</div>

	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">
			Filled + separated
		</p>
		<Accordion filled separated bind:value={filledValue}>
			<AccordionItem value="a" title="One tinted block">
				<p>Closed items sit flush as a single tinted surface.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Lifts out when open">
				<p>The active item pulls away as its own fully rounded piece.</p>
			</AccordionItem>
			<AccordionItem value="c" title="Same split logic">
				<p>Filled and outline share the splitting behaviour; only the surface differs.</p>
			</AccordionItem>
		</Accordion>
	</div>
</div>
