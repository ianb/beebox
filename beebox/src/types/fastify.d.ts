/**
 * Ambient augmentation of the Fastify instance with the `openAccess` flag.
 *
 * `openAccess` replaces the old `BBX_ALLOW_UNAUTHENTICATED` environment opt-out:
 * it is an in-process server-construction option, decorated onto the instance in
 * `createServer` / `createHubServer`. When `true`, the box serves without an
 * authentication wall (`resolveRequestIdentity` returns `source: "open"`). No
 * CLI path sets it — only test-constructed servers do — so a production box is
 * structurally always auth-on. Consulted per-instance (via `request.server` or
 * the registering instance) instead of the environment, so two servers in one
 * process can differ.
 */
import "fastify";
// The cookie plugin's reply methods. The backend program loads them through
// server/app.ts; the frontend's test program (src/frontend/tsconfig.test.json)
// includes this file for tests that import backend routes, and needs them too.
import "@fastify/cookie";

declare module "fastify" {
  interface FastifyInstance {
    openAccess: boolean;
  }
}
