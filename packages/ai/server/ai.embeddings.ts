import type { DatabaseServer } from '@delightstack/database';
import type {
	AiProcessingOptions,
	EmbeddingFieldConfig,
	EmbeddingStatus,
} from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabaseServer = DatabaseServer<any>;
import { createAiGateway } from './ai.gateway';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Schedule an alarm using "set only if earlier" strategy.
 * Ensures we never push another alarm further into the future.
 * Same pattern as packages/images/src/integration.ts
 */
async function scheduleAlarm(storage: DurableObjectStorage): Promise<void> {
	const existing = await storage.getAlarm();
	if (existing === null || Date.now() < existing) {
		await storage.setAlarm(Date.now());
	}
}

/** Hash source text for change detection using SHA-256 */
async function hashText(text: string): Promise<string> {
	const encoded = new TextEncoder().encode(text);
	const hash = await crypto.subtle.digest('SHA-256', encoded);
	const bytes = new Uint8Array(hash);
	// Use hex encoding for compact representation
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return hex;
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
	options: AiProcessingOptions & { fields: EmbeddingFieldConfig[] },
) {
	const storage = options.storage;
	const embeddingModel = options.embedding_model ?? '@cf/baai/bge-base-en-v1.5';
	const MAX_RETRIES = options.max_retries ?? 5;
	const BATCH_SIZE = 10;
	const fieldConfigs = new Map(options.fields.map((f) => [f.entity_type, f]));

	const gateway = createAiGateway({
		ai: options.ai(),
		gateway: options.gateway,
	});

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

			const newHash = await hashText(sourceText);
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
		 * 1. Fetches 'pending' records
		 * 2. Generates embeddings via Workers AI
		 * 3. Updates records with the embedding vector
		 * 4. Reschedules alarm if more pending
		 *
		 * Handles stuck 'processing' records and retries failed ones.
		 */
		async processAlarm(): Promise<void> {
			// Collect all entity types that have embedding configs
			const entityTypes = [...fieldConfigs.keys()];
			let totalPending = 0;

			for (const entityType of entityTypes) {
				const config = fieldConfigs.get(entityType)!;

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
						// Parse retry count from error field (format: "retry:N")
						const retryMatch = record.embedding_error?.match(/^retry:(\d+)$/);
						const retries = retryMatch ? parseInt(retryMatch[1], 10) + 1 : 1;

						if (retries > MAX_RETRIES) {
							db.update(
								entityType,
								record.id as string,
								{
									embedding_status: 'failed',
									embedding_error: 'Max retries exceeded',
								} as any,
							);
						} else {
							db.update(
								entityType,
								record.id as string,
								{
									embedding_status: 'pending',
									embedding_error: `retry:${retries}`,
								} as any,
							);
						}
					}
					if (stuck.length) totalPending += stuck.length;
					continue;
				}

				for (const record of pending) {
					try {
						// Mark as processing
						db.update(
							entityType,
							record.id as string,
							{
								embedding_status: 'processing',
							} as any,
						);

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
						if (!stillExists) continue;

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
					} catch (error: unknown) {
						// Parse retry count
						const retryMatch = record.embedding_error?.match(/^retry:(\d+)$/);
						const retries = retryMatch ? parseInt(retryMatch[1], 10) + 1 : 1;
						const errorMessage = error instanceof Error ? error.message : 'Unknown error';

						db.update(
							entityType,
							record.id as string,
							{
								embedding_status: retries >= MAX_RETRIES ? 'failed' : 'pending',
								embedding_error:
									retries >= MAX_RETRIES ? errorMessage : `retry:${retries}`,
							} as any,
						);
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
			const record = tryGet(db, entity_type, id);
			if (!record) return;

			const config = fieldConfigs.get(entity_type);
			if (!config) return;

			const sourceText = extractSourceText(record, config);
			const newHash = sourceText.trim() ? await hashText(sourceText) : null;

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
			const config = fieldConfigs.get(entity_type);
			if (!config) return { processed: 0, failed: 0 };

			// Mark all un-embedded records as pending
			const unembedded = db.exec(
				`SELECT id FROM ${entity_type} WHERE embedding_status IS NULL OR embedding IS NULL`,
			) as unknown as { id: string | number }[];

			let processed = 0;
			let failed = 0;

			for (const { id } of unembedded) {
				const record = tryGet(db, entity_type, id);
				if (!record) continue;

				const sourceText = extractSourceText(record, config);
				if (!sourceText.trim()) {
					processed++;
					continue;
				}

				const hash = await hashText(sourceText);
				db.update(
					entity_type,
					id as string,
					{
						embedding_status: 'pending',
						_embedding_source: hash,
						embedding_error: null,
					} as any,
				);
				processed++;
			}

			// Schedule alarm to start processing
			if (processed > 0) {
				await scheduleAlarm(storage);
			}

			return { processed, failed };
		},
	};
}
