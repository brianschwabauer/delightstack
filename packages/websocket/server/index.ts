export { createWebsocketHandle, type WebsocketHandleOptions } from './websocket.handler';

// Note: WebsocketServer is intentionally NOT re-exported from this barrel.
// It imports cloudflare:workers which only resolves in the Workers runtime.
// Import it from '@delightstack/websocket/worker' in your Worker entry point.
export type { WebsocketServer, WebsocketServerConfig } from './websocket.server';
