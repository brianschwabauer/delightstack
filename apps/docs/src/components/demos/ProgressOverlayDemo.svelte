<script>
	import { Progress } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	let isLoading = $state(false);

	function toggleLoading() {
		isLoading = true;
		setTimeout(() => (isLoading = false), 3000);
	}
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<div>
		<Button outline onclick={toggleLoading} disabled={isLoading}>
			{isLoading ? 'Loading…' : 'Reload table data'}
		</Button>
	</div>

	<div
		style="position: relative; border: 1px solid var(--color-border); border-radius: 10px; overflow: hidden;">
		<table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
			<thead>
				<tr style="background: var(--color-bg-muted);">
					<th
						style="text-align: left; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Name
					</th>
					<th
						style="text-align: left; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Status
					</th>
					<th
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Amount
					</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td
						style="padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Alice Johnson
					</td>
					<td
						style="padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Active
					</td>
					<td
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						$1,200
					</td>
				</tr>
				<tr>
					<td
						style="padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Bob Smith
					</td>
					<td
						style="padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						Pending
					</td>
					<td
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid var(--color-border);">
						$850
					</td>
				</tr>
				<tr>
					<td style="padding: 0.625rem 1rem;">Carol Davis</td>
					<td style="padding: 0.625rem 1rem;">Active</td>
					<td style="text-align: right; padding: 0.625rem 1rem;">$2,340</td>
				</tr>
			</tbody>
		</table>
		{#if isLoading}
			<Progress overlay label="Loading data..." />
		{/if}
	</div>
</div>
