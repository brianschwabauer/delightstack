---
'@delightstack/auth': minor
---

Session tokens carry the user's profile image as an optional `image` claim, and `locals.user.image` exposes it, so apps can draw an avatar without looking the user up. The claim is read from `user.image` whenever a session is issued or refreshed. `updateUser` can now remove an image: pass `image: null` (or `''`), which used to leave the old image in place.
