<script>
	import { Progress } from '@delightstack/components/feedback';

	let isLoading = $state(false);

	function toggleLoading() {
		isLoading = true;
		setTimeout(() => (isLoading = false), 3000);
	}
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<button
		onclick={toggleLoading}
		style="align-self: flex-start; padding: 0.5rem 1rem; border: 1px solid #ccc; border-radius: 6px; background: transparent; cursor: pointer;">
		{isLoading ? 'Loading...' : 'Reload Table Data'}
	</button>

	<div
		style="position: relative; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
		<table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
			<thead>
				<tr style="background: #f9fafb;">
					<th
						style="text-align: left; padding: 0.625rem 1rem; border-bottom: 1px solid #e0e0e0;">
						Name
					</th>
					<th
						style="text-align: left; padding: 0.625rem 1rem; border-bottom: 1px solid #e0e0e0;">
						Status
					</th>
					<th
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid #e0e0e0;">
						Amount
					</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td style="padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
						Alice Johnson
					</td>
					<td style="padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
						Active
					</td>
					<td
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
						$1,200
					</td>
				</tr>
				<tr>
					<td style="padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
						Bob Smith
					</td>
					<td style="padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
						Pending
					</td>
					<td
						style="text-align: right; padding: 0.625rem 1rem; border-bottom: 1px solid #f0f0f0;">
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
