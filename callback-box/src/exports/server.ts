/**
 * The `callback-box/server` export: the programmatic server entry for the hub
 * and for embedders. Importing this has no side effects — nothing listens
 * until `startServer()`/`createServer()` is called (the side-effectful boot
 * lives in src/webapp/server-main.ts, which is deliberately not exported).
 */
export { createServer, startServer, DEFAULT_PORT } from "../webapp/server.js";
export type { BoxSpec, ServerOptions, ServerContext } from "../webapp/server-types.js";
