import { Database } from '@delightstack/database';
import { RESERVED_AI_FIELDS } from '../types';

/** Extract the schema builder type from Database.table's callback parameter */
type TableCallback = Parameters<typeof Database.table>[1];
export type AiSchemaBuilder = Parameters<TableCallback>[0];

/**
 * Define a table with auto-managed vector embeddings.
 *
 * Adds reserved fields for embedding storage, status tracking, and change
 * detection. Custom fields are spread alongside the reserved fields.
 *
 * Usage:
 *   const articleTable = defineAiTable('article', (schema) => ({
 *     title: schema.string().searchable(),
 *     body: schema.string(),
 *     author_id: schema.string(),
 *   }));
 *
 *   // With custom dimensions (e.g. for bge-large-en-v1.5):
 *   const articleTable = defineAiTable('article', (schema) => ({
 *     title: schema.string().searchable(),
 *     body: schema.string(),
 *   }), { dimensions: 1024 });
 */
export function defineAiTable(
	table_name: string,
	customFields: (schema: AiSchemaBuilder) => Record<string, unknown>,
	options?: {
		/** Vector dimensions. Default: 768 (matches @cf/baai/bge-base-en-v1.5) */
		dimensions?: number;
	},
) {
	const dimensions = options?.dimensions ?? 768;

	// Validate that custom fields don't shadow reserved AI fields.
	// Use a Proxy-based mock schema so chained calls like schema.string().searchable() work.
	const mockHandler: ProxyHandler<object> = {
		get: () => new Proxy(() => {}, mockHandler),
		apply: () => new Proxy(() => {}, mockHandler),
	};
	const mockSchema = new Proxy(() => {}, mockHandler) as unknown as AiSchemaBuilder;
	const custom = customFields(mockSchema);
	for (const key of Object.keys(custom)) {
		if (RESERVED_AI_FIELDS.has(key as any)) {
			throw new Error(
				`defineAiTable: custom field '${key}' conflicts with reserved AI field. ` +
					`Reserved fields: ${[...RESERVED_AI_FIELDS].join(', ')}`,
			);
		}
	}

	return Database.table(table_name, (schema) => ({
		id: schema.primaryKey(),

		// Custom fields first, then reserved fields override any accidental collisions
		...customFields(schema),

		/** Vector embedding generated from source fields */
		embedding: schema.vector(dimensions).optional(),

		/** Processing status of the embedding */
		embedding_status: schema
			.enum(['pending', 'processing', 'embedded', 'failed'])
			.optional(),

		/** Error message if embedding generation failed */
		embedding_error: schema.string().optional(),

		/** The model used to generate the embedding */
		embedding_model: schema.string().optional(),

		/**
		 * Internal: hash of the source text. When fields change and produce a
		 * different hash, a new embedding is scheduled.
		 */
		_embedding_source: schema.string().optional(),

		created_at: schema.string().datetime(),
		updated_at: schema.string().datetime(),
	}));
}

/**
 * Define a conversation table for persisting chat history.
 *
 * Stores conversations with message arrays and token tracking.
 *
 * Usage:
 *   const conversationTable = defineAiConversationTable();
 *
 *   // With custom fields:
 *   const conversationTable = defineAiConversationTable((schema) => ({
 *     user_id: schema.string(),
 *     title: schema.string().searchable(),
 *   }));
 */
export function defineAiConversationTable(
	customFields?: (schema: AiSchemaBuilder) => Record<string, unknown>,
) {
	return Database.table('ai_conversation', (schema) => ({
		id: schema.primaryKey(),

		/** Array of messages in the conversation */
		messages: schema.array(
			schema.object({
				role: schema.enum(['system', 'user', 'assistant', 'tool']),
				content: schema.string(),
				tool_call_id: schema.string().optional(),
				tool_calls: schema
					.array(
						schema.object({
							id: schema.string(),
							type: schema.string(),
							function: schema.object({
								name: schema.string(),
								arguments: schema.string(),
							}),
						}),
					)
					.optional(),
				created_at: schema.string().datetime(),
			}),
		),

		/** The model used for this conversation */
		model: schema.string().optional(),

		/** Cumulative token usage */
		total_tokens: schema.number().int().optional(),

		/** Whether the conversation is active or archived */
		status: schema.enum(['active', 'archived']),

		created_at: schema.string().datetime(),
		updated_at: schema.string().datetime(),

		...(customFields ? customFields(schema) : {}),
	}));
}

export type AiTable = ReturnType<typeof defineAiTable>;
export type AiConversationTable = ReturnType<typeof defineAiConversationTable>;
