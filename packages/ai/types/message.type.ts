import type { TokenUsage, AiErrorCode } from './ai.type';

// ── WebSocket message types for AI streaming ────────────────────────────────

/** Server streams a chunk of AI-generated text to the client */
export interface AiStreamChunkMessage {
	event: 'ai:stream:chunk';
	stream_id: string;
	delta: string;
	accumulated: string;
	done: boolean;
	usage?: TokenUsage;
	finish_reason?: string;
}

/** Server signals a stream error */
export interface AiStreamErrorMessage {
	event: 'ai:stream:error';
	stream_id: string;
	message: string;
	code: AiErrorCode;
}

/** Client requests to resume a disconnected stream */
export interface AiStreamResumeMessage {
	event: 'ai:stream:resume';
	stream_id: string;
	/** Character offset of the last chunk received */
	last_offset: number;
}

/** Client requests to cancel a stream */
export interface AiStreamCancelMessage {
	event: 'ai:stream:cancel';
	stream_id: string;
}

/** Embedding status changed (broadcast after alarm processing) */
export interface AiEmbeddingUpdatedMessage {
	event: 'ai:embedding:updated';
	entity_type: string;
	id: string | number;
	embedding_status: string;
}

/** Union of all AI-specific WebSocket messages */
export type AiWebsocketMessage =
	| AiStreamChunkMessage
	| AiStreamErrorMessage
	| AiStreamResumeMessage
	| AiStreamCancelMessage
	| AiEmbeddingUpdatedMessage;
