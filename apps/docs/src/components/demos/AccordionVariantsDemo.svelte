<script>
	import { Accordion, AccordionItem } from '@delightstack/components/display';

	let plainValue = $state('a');
	let filledValue = $state('a');
	let outlineValue = $state('a');
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem;">
	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">Default</p>
		<Accordion bind:value={plainValue}>
			<AccordionItem value="a" title="Hairline separators">
				<p>The default keeps a subtle line between each item and nothing else.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Items stay connected">
				<p>Items touch by default — opening one doesn't push the others away.</p>
			</AccordionItem>
			<AccordionItem value="c" title="No trailing border">
				<p>The last item never draws a bottom separator.</p>
			</AccordionItem>
		</Accordion>
	</div>

	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">Filled</p>
		<Accordion filled bind:value={filledValue}>
			<AccordionItem value="a" title="Tinted block">
				<p>Items join into one tinted surface with squircle-rounded ends.</p>
			</AccordionItem>
			<AccordionItem value="b" title="One consistent fill">
				<p>Every item shares the same subtle tint, open or closed.</p>
			</AccordionItem>
			<AccordionItem value="c" title="Squircle corners">
				<p>Corners use the same squircle treatment as the rest of the library.</p>
			</AccordionItem>
		</Accordion>
	</div>

	<div>
		<p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.875rem;">Outline</p>
		<Accordion outline bind:value={outlineValue}>
			<AccordionItem value="a" title="One framed group">
				<p>A single bordered, rounded frame wraps the whole set.</p>
			</AccordionItem>
			<AccordionItem value="b" title="Hairline divisions">
				<p>Items are divided by hairlines inside the frame.</p>
			</AccordionItem>
			<AccordionItem value="c" title="Tidy edges">
				<p>Only the group's outer corners round; the radius stays subtle.</p>
			</AccordionItem>
		</Accordion>
	</div>
</div>
