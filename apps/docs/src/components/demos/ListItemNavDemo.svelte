<script>
	import { List, ListItem } from '@delightstack/components/display';
</script>

<List>
	<ListItem href="#profile">Profile</ListItem>
	<ListItem href="#settings">Settings</ListItem>
	<ListItem onclick={() => alert('Logged out!')}>Log Out</ListItem>
</List>
