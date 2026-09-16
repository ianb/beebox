/** HTTP preparation and detached work share the box's cross-process admission. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BoxSpec } from "./server-types.js";
import { acquireBoxWork, BoxMaintenanceError, withoutBoxWork, type BoxWork } from "../lib/box-maintenance.js";
import { parseOAuthState } from "../connectors/google-oauth-state.js";
import { toError } from "../lib/error-guards.js";

const requests = new Map<string, number>();
const admitted = new WeakMap<FastifyRequest, BoxWork[]>();

export function boxRequestsAreIdle(boxRoot: string): boolean {
  return (requests.get(boxRoot) ?? 0) === 0;
}

function requestBoxes(request: FastifyRequest, boxes: BoxSpec[]): BoxSpec[] {
  const url = new URL(request.url, "http://localhost");
  // This exact procedure validates and owns its narrowly scoped answer lease.
  if (typeof request.headers["x-bbx-box-work"] !== "string" && boxes.some((box) => url.pathname === `/${box.slug}/api/trpc/actions.answer`)) return [];
  if (url.pathname === "/auth/google-services/callback") {
    const parsed = parseOAuthState(url.searchParams.get("state") ?? undefined);
    const box = boxes.find((candidate) => candidate.slug === parsed?.boxSlug);
    return box ? [box] : boxes;
  }
  // Login/setup owns global identity state, not any box's migration data.
  // It must remain available so a boxholder can inspect a closed box.
  if (url.pathname.startsWith("/auth/")) return [];
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) && typeof request.headers["x-bbx-box-work"] !== "string") return [];
  const scoped = boxes.filter((candidate) => url.pathname.startsWith(`/${candidate.slug}/`) || url.pathname.startsWith(`/webhook/${candidate.slug}/`));
  return scoped.length > 0 ? scoped : boxes;
}

/** The route, not the request: no query string and at most the route's leading segments, since diagnostics travel into alerts. */
function routeLabel(url: string): string {
  const pathname = url.split("?")[0] ?? url;
  const segments = pathname.split("/").filter(Boolean);
  return `/${segments.slice(0, 4).join("/")}${segments.length > 4 ? "/…" : ""}`;
}

export function registerBoxAdmission(server: FastifyInstance, boxes: BoxSpec[]): void {
  // eslint-disable-next-line max-params -- Fastify callback hooks require request, reply, and done to propagate async context.
  server.addHook("onRequest", (request, reply, done) => withoutBoxWork(() => {
    const targets = requestBoxes(request, boxes);
    const work: BoxWork[] = [];
    const release = async (): Promise<void> => {
      if (!admitted.delete(request)) return;
      for (const [index, lease] of work.entries()) {
        const root = targets[index]?.boxRoot;
        if (root) { const remaining = (requests.get(root) ?? 1) - 1; if (remaining) requests.set(root, remaining); else requests.delete(root); }
        await lease.release();
      }
    };
    admitted.set(request, work);
    // The handler wrapper below releases after asynchronous preparation even
    // when the client disconnects. onResponse covers early auth/error replies.
    reply.raw.once("finish", () => { if (!handling.has(request)) void release().catch((error: unknown) => request.log.error(error)); });
    const header = request.headers["x-bbx-box-work"];
    void (async () => {
      for (const box of targets) {
        const lease = await acquireBoxWork(box.boxRoot, { reason: `${request.method} ${routeLabel(request.url)}`, inherited: typeof header === "string" ? header : null });
        work.push(lease);
        requests.set(box.boxRoot, (requests.get(box.boxRoot) ?? 0) + 1);
      }
      releases.set(request, release);
      // A callback keeps all subsequent Fastify hooks inside the accepted context.
      if (work.length === 1) work[0]?.run(done); else done();
    })().catch(async (error: unknown) => {
      await release();
      if (error instanceof BoxMaintenanceError) {
        if (error.retryAfterMs !== undefined) void reply.header("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
        await reply.status(503).send({ error: error.message });
      }
      else done(toError(error));
    });
  }));
  server.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = async function (request, reply) {
      handling.add(request);
      try {
        const result = await handler.call(this, request, reply);
        // Callback-style handlers (sendFile, not-found) finish through reply.
        return result === undefined ? await reply : result;
      }
      finally { handling.delete(request); await releases.get(request)?.(); }
    };
  });
  server.addHook("onResponse", async (request) => { if (!handling.has(request)) await releases.get(request)?.(); });
}
const handling = new WeakSet<FastifyRequest>();
const releases = new WeakMap<FastifyRequest, () => Promise<void>>();
