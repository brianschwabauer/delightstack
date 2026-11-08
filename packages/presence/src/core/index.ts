export { PresenceClient, type PresenceClientOptions } from './presence.client.svelte.js';
export { userColor } from './color.js';
export {
	mergeUpdate,
	applySnapshot,
	removePeer,
	pruneStale,
	moreActive,
	dedupeUsers,
	type PeerUpdate,
} from './awareness.js';
export {
	STAGE_ATTR,
	normalize,
	denormalize,
	readStageGeometry,
	findStage,
	getStageById,
	normalizeCursor,
	denormalizeCursor,
	type StageGeometry,
} from './coordinates.js';
