<script>
	import { Code } from '@delightstack/components/display';

	const longLineCode = `// This file contains some intentionally long lines to demonstrate line wrapping behavior
const apiEndpoint = "https://api.example.com/v2/organizations/acme-corp/projects/my-project/environments/production/deployments/latest";

export function createQueryString(params: Record<string, string>): string {
  return Object.entries(params).map(([key, value]) => \`\${encodeURIComponent(key)}=\${encodeURIComponent(value)}\`).join("&");
}`;
</script>

<Code code={longLineCode} language="typescript" wrap filename="utils.ts" />
