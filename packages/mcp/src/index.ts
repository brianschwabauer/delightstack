/**
 * `@delightstack/mcp` — a Model Context Protocol server for Cloudflare
 * Workers: Streamable HTTP transport, a tool registry with schema validation,
 * and an OAuth 2.1 provider, with every store injected.
 *
 * Zero runtime dependencies beyond `@delightstack/utilities`, and no `node:`
 * imports anywhere — everything cryptographic goes through Web Crypto, so the
 * same build runs in workerd, in a browser, and under Node.
 */

export { createMcpServer, SUPPORTED_PROTOCOL_VERSIONS } from './server.js';
export type { McpServer, McpServerOptions } from './server.js';

export { createToolRegistry, defineTool, normalizeResult, toolError } from './tools.js';
export type { McpToolDescriptor, McpToolRegistry } from './tools.js';

export {
	applyDefaults,
	compileInputSchema,
	formatViolations,
	validateInput,
} from './schema.js';
export type { JsonSchemaObject, SchemaViolation, ValidationResult } from './schema.js';

export {
	errorToJsonRpc,
	failure,
	isJsonRpcRequest,
	isNotification,
	JSON_RPC_ERROR,
	success,
} from './jsonrpc.js';

export { createMemorySessionStore, generateSessionId } from './sessions.js';

export { createMemoryOauthStores, createOauthProvider } from './oauth.js';
export type {
	OauthAccessToken,
	OauthAuthorizationCode,
	OauthClient,
	OauthClientStore,
	OauthCodeStore,
	OauthConsentContext,
	OauthProvider,
	OauthProviderOptions,
	OauthResolvedUser,
	OauthTokenStore,
} from './oauth.js';

export {
	base64UrlEncode,
	hashToken,
	randomToken,
	sha256Base64Url,
	timingSafeEqual,
} from './crypto.js';

export type {
	JsonRpcErrorBody,
	JsonRpcFailure,
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcSuccess,
	JsonValue,
	McpArraySchema,
	McpAuthContext,
	McpBooleanSchema,
	McpContent,
	McpNumberSchema,
	McpObjectSchema,
	McpSchema,
	McpSession,
	McpSessionStore,
	McpStringSchema,
	McpTool,
	McpToolAnnotations,
	McpToolContext,
	McpToolInput,
	McpToolResult,
	McpToolReturn,
} from './types.js';
