<script lang="ts" module>
	/** An option/command in the command palette */
	export interface CommandOption {
		/** The ID of the command. Used for tracking and identification */
		id: string;

		/** The title of the command */
		title: string;

		/** An optional description of the command (lighter gray text) */
		description?: string;

		/** The function called when the command is selected */
		onselect?: () => void;

		/** An optional icon for the command (can be an SVG or Svelte component) */
		icon?: typeof import('svelte').SvelteComponent | string;

		/** An optional snippet that will be used to render the command (takes precedence over title and description) */
		snippet?: import('svelte').Snippet;

		/** An optional keyboard shortcut for the command. Displayed at the end of the command */
		shortcut?: Array<'ctrl' | 'shift' | 'alt' | 'meta' | string>;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A searchable modal that allows users to quickly access features and commands.
	 */
	let {
		/** The title of the command palette */
		title = 'Run Command',

		/** The placeholder text for the search input */
		placeholder = 'Type a command...',

		/** The list of commands to display */
		options = [] as CommandOption[],

		/** Whether the command palette is open */
		open = $bindable(false),

		/** Whether to disable the search input */
		disableSearch = false,

		/** An optional header snippet to display above the commands */
		header = null as Snippet | null,

		/** An optional footer snippet to display below the commands */
		footer = null as Snippet | null,

		/** The function called when a command is selected */
		onselect = (command: CommandOption) => {},

		/** The function called when the command palette is closed */
		onclose = () => {},

		/** Additional props to pass to the command palette parent element */
		...rest
	} = $props();
</script>
