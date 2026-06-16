export { PresenceClient, type PresenceClientOptions } from './presence.client.svelte';
export { userColor } from './color';
export {
	mergeUpdate,
	applySnapshot,
	removePeer,
	pruneStale,
	moreActive,
	dedupeUsers,
	type PeerUpdate,
} from './awareness';
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
} from './coordinates';
