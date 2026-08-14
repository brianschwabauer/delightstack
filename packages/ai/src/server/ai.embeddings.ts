import type { DatabaseServer } from '@delightstack/database';
import type { AiBroadcastChannel } from './ai.server';
import type {
	AiProcessingOptions,
	EmbeddingFieldConfig,
	EmbeddingStatus,
} from '../types';
import type { AiEmbeddingUpdatedMessage } from '../types/message.type';
import { createAiGateway, type AiGatewayClient } from './ai.gateway';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabaseServer = DatabaseServer<any>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Schedule an alarm using "set only if earlier" strategy.
 * Ensures we never push an existing alarm further into the future.
 * Same pattern as packages/images/src/integration.ts
 */
async function scheduleAlarm(storage: DurableObjectStorage): Promise<void> {
	const now = Date.now();
	const existing = await storage.getAlarm();
	if (existing === null || existing > now) {
		await storage.setAlarm(now);
	}
}

/**
 * Simple synchronous hash for change detection.
 * Not cryptographic — just needs to detect when source text changes.
 * Uses djb2 algorithm for speed (called in afterCreate/afterUpdate hooks).
 */
function hashText(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	}
	// Include length to reduce collisions for short strings
	return `${(hash >>> 0).toString(36)}_${text.length}`;
}

/** Safely get a record by ID, returning null instead of throwing on 404 */
function tryGet(
	db: AnyDatabaseServer,
	entityType: string,
	id: string | number,
): Record<string, unknown> | null {
	try {
		return db.get(entityType, id as string) as Record<string, unknown>;
	} catch (err: unknown) {
		if ((err as { status?: number })?.status === 404) return null;
		throw err;
	}
}

/** Extract source text from a record using the field config */
function extractSourceText(
	record: Record<string, unknown>,
	config: EmbeddingFieldConfig,
): string {
	if (config.extractText) {
		return config.extractText(record);
	}
	const separator = config.separator ?? '\n';
	return config.source_fields
		.map((field) => {
			const value = record[field];
			if (value == null) return '';
			if (typeof value === 'string') return value;
			if (Array.isArray(value)) return value.join(', ');
			return String(value);
		})
		.filter(Boolean)
		.join(separator);
}

/**
 * Validate that an entity type is in the configured fields whitelist.
 * Prevents SQL injection by only allowing known table names.
 */
function validateEntityType(
	entityType: string,
	fieldConfigs: Map<string, EmbeddingFieldConfig>,
): void {
	if (!fieldConfigs.has(entityType)) {
		throw new Error(
			`Unknown entity type '${entityType}'. Must be one of: ${[...fieldConfigs.keys()].join(', ')}`,
		);
	}
}

// ── Types ───────────────────────────────────────────────────────────────────

interface EmbeddingRecord {
	id: string | number;
	embedding_status: EmbeddingStatus | null;
	embedding_error: string | null;
	embedding_model: string | null;
	_embedding_source: string | null;
	[key: string]: unknown;
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Factory function for AI embedding processing integrated with @delightstack/database.
 * Follows the same alarm-based async pattern as imageProcessing() from @delightstack/images.
 *
 * Usage in a Durable Object:
 *   const embeddings = aiEmbeddings(db, {
 *     ai: () => env.AI,
 *     storage: this.ctx.storage,
 *     fields: [
 *       { entity_type: 'article', source_fields: ['title', 'body'] },
 *       { entity_type: 'product', source_fields: ['name', 'description'] },
 *     ],
 *   });
 *
 *   // After create/update:
 *   await embeddings.scheduleIfChanged('article', article.id, article);
 *
 *   // In the DO alarm handler:
 *   async alarm() { await embeddings.processAlarm(); }
 */
export function aiEmbeddings(
	db: AnyDatabaseServer,
	options: AiProcessingOptions & {
		fields: EmbeddingFieldConfig[];
		storage: DurableObjectStorage;
		ws?: () => AiBroadcastChannel | undefined;
		/** Pre-built gateway client (shared with aiProcessing to avoid duplicate instances) */
		gateway_client?: AiGatewayClient;
	},
) {
	const storage = options.storage;
	const embeddingModel = options.embedding_model ?? '@cf/baai/bge-base-en-v1.5';
	const MAX_RETRIES = options.max_retries ?? 5;
	const BATCH_SIZE = 10;
	const fieldConfigs = new Map(options.fields.map((f) => [f.entity_type, f]));

	// In-memory retry tracker — survives across alarm cycles within the same DO instance.
	// Keyed by `${entityType}:${id}`, stores retry count.
	const retryTracker = new Map<string, number>();

	/** Get the retry key for a record */
	function retryKey(entityType: string, id: string | number): string {
		return `${entityType}:${id}`;
	}

	/** Broadcast embedding status change via WebSocket if available */
	function broadcastEmbeddingUpdate(
		entity_type: string,
		id: string | number,
		embedding_status: string,
	): void {
		const ws = options.ws?.();
		if (!ws) return;
		ws.broadcast({
			event: 'ai:embedding:updated',
			entity_type,
			id,
			embedding_status,
		} satisfies AiEmbeddingUpdatedMessage);
	}

	/** Get the gateway client — uses shared instance if provided, otherwise creates lazily */
	let _ownGateway: AiGatewayClient | null = null;
	function getGateway(): AiGatewayClient {
		if (options.gateway_client) return options.gateway_client;
		if (!_ownGateway) {
			_ownGateway = createAiGateway({
				ai: options.ai(),
				gateway: options.gateway,
			});
		}
		return _ownGateway;
	}

	return {
		/**
		 * Check if an entity's embedding source text has changed.
		 * If so, mark it as pending and schedule an alarm.
		 * Call this in afterCreate/afterUpdate hooks.
		 */
		async scheduleIfChanged(
			entity_type: string,
			id: string | number,
			data: Record<string, unknown>,
		): Promise<void> {
			const config = fieldConfigs.get(entity_type);
			if (!config) return;

			const sourceText = extractSourceText(data, config);
			if (!sourceText.trim()) return;

			const newHash = hashText(sourceText);
			const existingHash = data._embedding_source as string | null;

			// Skip if the source text hasn't changed
			if (existingHash === newHash) return;

			db.update(
				entity_type,
				id as string,
				{
					embedding_status: 'pending',
					_embedding_source: newHash,
					embedding_error: null,
				} as any,
			);

			await scheduleAlarm(storage);
		},

		/**
		 * Process pending embedding jobs. Called from the DO's alarm handler.
		 *
		 * Processes up to BATCH_SIZE records per alarm cycle:
		 * 1. Fetches 'pending' records and marks them as 'processing' atomically
		 * 2. Generates embeddings via Workers AI
		 * 3. Updates records with the embedding vector
		 * 4. Reschedules alarm if more pending
		 *
		 * Handles stuck 'processing' records and retries failed ones.
		 */
		async processAlarm(): Promise<void> {
			const gateway = getGateway();

			// Collect all entity types that have embedding configs
			const entityTypes = [...fieldConfigs.keys()];
			let totalPending = 0;

			for (const entityType of entityTypes) {
				const config = fieldConfigs.get(entityType)!;

				// Entity type is from developer-configured fieldConfigs (validated at init),
				// but we still validate to be safe against any dynamic usage
				validateEntityType(entityType, fieldConfigs);

				// Fetch pending records
				const pending = db.exec(
					`SELECT * FROM ${entityType} WHERE embedding_status = 'pending' LIMIT ?`,
					BATCH_SIZE,
				) as unknown as EmbeddingRecord[];

				if (!pending.length) {
					// Check for stuck 'processing' records
					const stuck = db.exec(
						`SELECT * FROM ${entityType} WHERE embedding_status = 'processing' LIMIT 5`,
					) as unknown as EmbeddingRecord[];

					for (const record of stuck) {
						const key = retryKey(entityType, record.id);
						const retries = (retryTracker.get(key) ?? 0) + 1;
						retryTracker.set(key, retries);

						if (retries > MAX_RETRIES) {
							db.update(
								entityType,
								record.id as string,
								{
									embedding_status: 'failed',
									embedding_error: 'Max retries exceeded (stuck processing)',
								} as any,
							);
							retryTracker.delete(key);
							broadcastEmbeddingUpdate(entityType, record.id, 'failed');
						} else {
							db.update(
								entityType,
								record.id as string,
								{
									embedding_status: 'pending',
									embedding_error: null,
								} as any,
							);
							totalPending++;
						}
					}
					continue;
				}

				// Mark all selected records as 'processing' before starting work,
				// so a concurrent alarm cycle won't pick them up again
				const pendingIds = pending.map((r) => r.id);
				const placeholders = pendingIds.map(() => '?').join(',');
				db.exec(
					`UPDATE ${entityType} SET embedding_status = 'processing' WHERE id IN (${placeholders})`,
					...pendingIds,
				);

				for (const record of pending) {
					const key = retryKey(entityType, record.id);

					try {
						// Extract source text
						const sourceText = extractSourceText(
							record as Record<string, unknown>,
							config,
						);
						if (!sourceText.trim()) {
							db.update(
								entityType,
								record.id as string,
								{
									embedding_status: 'embedded',
									embedding: null,
									embedding_model: null,
									embedding_error: null,
								} as any,
							);
							retryTracker.delete(key);
							continue;
						}

						// Generate embedding
						const result = await gateway.embed({
							input: sourceText,
							model: embeddingModel,
						});

						const vector = result.vectors[0];
						if (!vector) {
							throw new Error('No embedding vector returned');
						}

						// Check if record was deleted during processing
						const stillExists = tryGet(db, entityType, record.id);
						if (!stillExists) {
							retryTracker.delete(key);
							continue;
						}

						// Update record with embedding
						db.update(
							entityType,
							record.id as string,
							{
								embedding: vector,
								embedding_status: 'embedded',
								embedding_model: embeddingModel,
								embedding_error: null,
							} as any,
						);
						retryTracker.delete(key);
						broadcastEmbeddingUpdate(entityType, record.id, 'embedded');
					} catch (error: unknown) {
						const retries = (retryTracker.get(key) ?? 0) + 1;
						retryTracker.set(key, retries);
						const errorMessage = error instanceof Error ? error.message : 'Unknown error';

						const newStatus = retries >= MAX_RETRIES ? 'failed' : 'pending';
						db.update(
							entityType,
							record.id as string,
							{
								embedding_status: newStatus,
								embedding_error: errorMessage,
							} as any,
						);
						if (newStatus === 'failed') {
							retryTracker.delete(key);
							broadcastEmbeddingUpdate(entityType, record.id, 'failed');
						}
					}
				}

				// Count remaining pending
				const remaining = db.exec(
					`SELECT COUNT(*) as count FROM ${entityType} WHERE embedding_status = 'pending'`,
				) as unknown as { count: number }[];
				totalPending += remaining[0]?.count ?? 0;
			}

			// Reschedule if more pending
			if (totalPending > 0) {
				await scheduleAlarm(storage);
			}
		},

		/**
		 * Force re-embed a specific record. Resets to pending and schedules alarm.
		 */
		async reembed(entity_type: string, id: string | number): Promise<void> {
			validateEntityType(entity_type, fieldConfigs);

			const record = tryGet(db, entity_type, id);
			if (!record) return;

			const config = fieldConfigs.get(entity_type)!;
			const sourceText = extractSourceText(record, config);
			const newHash = sourceText.trim() ? hashText(sourceText) : null;

			// Reset retry counter
			retryTracker.delete(retryKey(entity_type, id));

			db.update(
				entity_type,
				id as string,
				{
					embedding_status: 'pending',
					embedding_error: null,
					_embedding_source: newHash,
				} as any,
			);

			await scheduleAlarm(storage);
		},

		/**
		 * Bulk embed all records that don't have embeddings yet.
		 * Useful for backfilling after adding AI to an existing table.
		 */
		async backfill(entity_type: string): Promise<{ processed: number; failed: number }> {
			validateEntityType(entity_type, fieldConfigs);

			const config = fieldConfigs.get(entity_type)!;

			// Fetch full records in one query to avoid N+1
			const unembedded = db.exec(
				`SELECT * FROM ${entity_type} WHERE embedding_status IS NULL`,
			) as unknown as EmbeddingRecord[];

			let processed = 0;
			let failed = 0;
			let pendingCount = 0;

			for (const record of unembedded) {
				const sourceText = extractSourceText(record as Record<string, unknown>, config);

				// Records with no source text get marked as embedded (nothing to embed)
				if (!sourceText.trim()) {
					try {
						db.update(
							entity_type,
							record.id as string,
							{
								embedding_status: 'embedded',
								embedding: null,
								embedding_model: null,
								embedding_error: null,
							} as any,
						);
						processed++;
					} catch {
						failed++;
					}
					continue;
				}

				try {
					const hash = hashText(sourceText);
					db.update(
						entity_type,
						record.id as string,
						{
							embedding_status: 'pending',
							_embedding_source: hash,
							embedding_error: null,
						} as any,
					);
					processed++;
					pendingCount++;
				} catch {
					failed++;
				}
			}

			// Schedule alarm only if records were set to pending
			if (pendingCount > 0) {
				await scheduleAlarm(storage);
			}

			return { processed, failed };
		},
	};
}
