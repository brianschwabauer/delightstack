/**
 * Shared types for `@delightstack/mcp`.
 *
 * Two naming conventions meet in this file and the split is deliberate:
 * everything we own is `snake_case`, and everything that crosses the wire as
 * MCP or JSON Schema keeps the casing the specification gives it
 * (`inputSchema`, `additionalProperties`, `protocolVersion`, …). Converting
 * those would mean converting them back before they are serialized.
 */

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

/** A JSON value, as far as JSON-RPC is concerned. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/** A JSON-RPC 2.0 request or notification id. `undefined` means notification. */
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	/** Absent on a notification. */
	id?: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcSuccess {
	jsonrpc: '2.0';
	id: JsonRpcId;
	result: unknown;
}

export interface JsonRpcFailure {
	jsonrpc: '2.0';
	id: JsonRpcId;
	error: JsonRpcErrorBody;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

// ---------------------------------------------------------------------------
// Schema subset
// ---------------------------------------------------------------------------

/**
 * The JSON Schema subset a tool's arguments may be described with.
 *
 * Deliberately small. It covers what an MCP tool surface actually needs —
 * objects of scalars, enums, and arrays of those — and nothing else, because
 * every keyword added here is a keyword the hand-written validator has to
 * implement correctly and an agent has to interpret correctly. `$ref`,
 * `oneOf`, `allOf` and conditional keywords are all deliberately absent.
 */
export type McpSchema =
	| McpStringSchema
	| McpNumberSchema
	| McpBooleanSchema
	| McpArraySchema
	| McpObjectSchema;

interface McpSchemaBase {
	/** Shown to the agent. Write it as if it were the only documentation. */
	description?: string;
	/** Marks the property as not required when it appears in a tool's `input`. */
	optional?: boolean;
	/**
	 * Advertised in the schema, and filled in for an absent or `null` argument
	 * after validation has passed — never before, so a default cannot paper over
	 * an argument that failed to validate.
	 */
	default?: JsonValue;
}

export interface McpStringSchema extends McpSchemaBase {
	type: 'string';
	enum?: readonly string[];
	min_length?: number;
	max_length?: number;
	/** Advisory only — surfaced in the schema, not enforced. */
	format?: string;
}

export interface McpNumberSchema extends McpSchemaBase {
	type: 'number' | 'integer';
	enum?: readonly number[];
	minimum?: number;
	maximum?: number;
}

export interface McpBooleanSchema extends McpSchemaBase {
	type: 'boolean';
}

export interface McpArraySchema extends McpSchemaBase {
	type: 'array';
	items: McpSchema;
	min_items?: number;
	max_items?: number;
}

export interface McpObjectSchema extends McpSchemaBase {
	type: 'object';
	properties: Record<string, McpSchema>;
	/** Extra keys are rejected unless this is `true`. */
	additional?: boolean;
}

/** The `input` shape a tool is defined with: a map of argument name to schema. */
export type McpToolInput = Record<string, McpSchema>;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** One block of a tool result. Matches the MCP content block union. */
export type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'audio'; data: string; mimeType: string }
	| { type: 'resource_link'; uri: string; name?: string; description?: string };

/** What a tool's `run` may return. Anything but `McpToolResult` is wrapped. */
export type McpToolReturn = string | McpContent[] | McpToolResult | JsonValue;

export interface McpToolResult {
	content: McpContent[];
	/** Machine-readable result, mirrored into the text block when absent. */
	structuredContent?: JsonValue;
	/** `true` marks a *tool* failure — a protocol success the model can read. */
	isError?: boolean;
}

/**
 * Hints about a tool's behaviour. Advisory: a client may show them to the
 * user, and must not rely on them for safety.
 */
export interface McpToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/** Who the caller is, resolved from the bearer token before any tool runs. */
export interface McpAuthContext {
	/** The user the token was minted for. */
	subject: string;
	/** The tenant the token is bound to. One vault per token. */
	org_id?: string;
	/** Granted scopes, already expanded through any ladder the app applies. */
	scopes: string[];
	/** The OAuth client id the token was issued to. */
	client_id?: string;
	/** The registered client name — the app turns this into an `actor`. */
	client_name?: string;
	/** The token's own id, for revocation and last-used bookkeeping. */
	token_id?: string;
	/** Anything else the app's `authenticate` wants to carry through. */
	meta?: Record<string, unknown>;
}

export interface McpToolContext<Locals = unknown> {
	/** Null only when the server was built without `authenticate`. */
	auth: McpAuthContext | null;
	/** The HTTP request the call arrived on. Read-only; the body is consumed. */
	request: Request;
	/** The MCP session, when the negotiated protocol version has sessions. */
	session_id: string | undefined;
	/** Aborts when the client disconnects. */
	signal: AbortSignal;
	/** Whatever the server's `locals` factory built for this request. */
	locals: Locals;
	/** The negotiated protocol version. */
	protocol_version: string;
}

export interface McpTool<Input = Record<string, unknown>, Locals = unknown> {
	name: string;
	/** Human-readable name for a picker. Distinct from `name`, which is API. */
	title?: string;
	description: string;
	/** The single scope a caller must hold. Checked before `run`. */
	scope?: string;
	input: McpToolInput;
	annotations?: McpToolAnnotations;
	run: (
		args: Input,
		ctx: McpToolContext<Locals>,
	) => Promise<McpToolReturn> | McpToolReturn;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface McpSession {
	id: string;
	protocol_version: string;
	/** The token id the session was opened under, when there was one. */
	token_id?: string;
	subject?: string;
	org_id?: string;
	client_name?: string;
	client_version?: string;
	created_at: number;
	last_seen_at: number;
}

/**
 * Where sessions live. Injected because the only correct answer differs per
 * deployment: a Durable Object's SQLite in production, a `Map` in a test.
 */
export interface McpSessionStore {
	create(session: McpSession): void | Promise<void>;
	get(id: string): McpSession | undefined | Promise<McpSession | undefined>;
	touch(id: string, at: number): void | Promise<void>;
	delete(id: string): void | Promise<void>;
}
