<script>
	import { Code } from '@delightstack/components/display';

	const snippet = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}`;
</script>

<Code code={snippet} language="javascript" highlight_lines={[3, 4]} filename="cart.js" />
