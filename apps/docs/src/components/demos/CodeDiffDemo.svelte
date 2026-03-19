<script>
	import { Code } from '@delightstack/components/display';

	const diffOutput = `@@ -1,5 +1,6 @@
 function greet(name) {
-  console.log("Hello");
+  console.log("Hello, " + name);
+  return name;
 }

-greet();
+greet("World");`;
</script>

<Code code={diffOutput} diff filename="greet.js" />
