<script>
	import { Code } from '@delightstack/components/display';

	const snippet = `function greet(name: string) {
  console.log(\`Hello, \${name}!\`);
}

greet('World');`;
</script>

<Code code={snippet} language="typescript" />
