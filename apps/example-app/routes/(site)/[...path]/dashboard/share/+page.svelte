<script lang="ts">
	import { Input } from '$lib/form';
</script>

<section>
	<h1>Share</h1>
	<pre>
		- List publicly shareable sites containing a collection of stories, people, documents, etc
		- Activity feed (for each site, show the activity/reactions/comments on that site)
		- List memory/story/answer requests
		- Request a new story, answer, memory, etc from someone
		- Create new shareable site
			 - Choose content (people, memories, documents, etc) to include in shareable site
					- Selected people to include on page (individual people or by tag/group)
					- Selected memories to include on page (individual memories or by tag/group or by author)
					- Selected documents/recipes to include on page (individual docs or by tag/group or by author)
			 - Choose layout (timeline, gallery, map, directory, family tree, etc)
			 - Choose url, visibility (public/password protected/private)
			 - Design settings (header, navigation, colors, font, etc)
		- Create public/private share links
			 - Each share link can automatically include any item with the chosen tag (or person, location, date, etc)
		- Show an "activity" feed for each shared link (like Google Photos)
			 - View a history of comments here
		- Add ability to share each tab separately - like the share link could have "Family Tree" view turned on/off
	</pre>
</section>

<style>
	section {
		width: 100%;
		height: 100vh;
		position: relative;
		display: flex;
		align-items: start;
		justify-content: start;
		align-items: center;
		flex-direction: column;
	}
	pre {
		max-width: 100vw;
		overflow: auto;
	}
</style>
