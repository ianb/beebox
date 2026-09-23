/**
 * Why a configured box has no endpoint right now, as an HTTP answer. The
 * 2026-09-16 incident's only symptom was a bare 404 "No running box" while
 * every box sat closed for an abandoned migration; a known box that cannot be
 * served now says so, with the reason and when it began.
 */
import type { FastifyReply } from "fastify";
import { boxMaintenanceStatus } from "../lib/box-maintenance.js";
import { resolveGitDir } from "../lib/git-lock.js";
import type { EndpointProvider } from "./endpoints.js";

interface UnavailableBox {
  status: 503;
  /** Seconds a client should wait before retrying. */
  retryAfter: number;
  body:
    | { error: "box_closed"; reason: string; since: string | undefined; owner: { pid: number; since: string }; message: string }
    | { error: "box_unavailable"; message: string };
}

const DEFAULT_RETRY_AFTER_S = 60;

/**
 * A configured box that cannot be served says why; only an unconfigured path
 * is a 404. A page navigation (a browser tab, the iOS companion's web view,
 * which renders whatever body it gets) receives the sentence as plain text;
 * an API client receives the JSON body.
 */
export async function replyNoEndpoint(reply: FastifyReply, args: { slug: string | null; reqPath: string; accept: string | undefined; boxRoot: string | undefined; endpoints: EndpointProvider; detailed: boolean }): Promise<FastifyReply> {
  if (args.slug === null || !args.endpoints.slugs().includes(args.slug)) {
    return reply.status(404).send({ error: "not_found", message: `No running box for ${JSON.stringify(args.reqPath)}` });
  }
  const unavailable: UnavailableBox = args.detailed
    ? await describeUnavailableBox({ slug: args.slug, boxRoot: args.boxRoot, endpoints: args.endpoints })
    : { status: 503, retryAfter: DEFAULT_RETRY_AFTER_S, body: { error: "box_unavailable", message: `Box ${args.slug} is not running` } };
  reply.status(unavailable.status).header("retry-after", String(unavailable.retryAfter));
  if (args.accept?.includes("text/html")) {
    return reply.type("text/plain; charset=utf-8").send(`${unavailable.body.message}\nRetry in ${String(unavailable.retryAfter)} seconds.\n`);
  }
  return reply.send(unavailable.body);
}

/** A live maintenance owner closes the box; anything else is the supervisor's last word on it. */
async function describeUnavailableBox(args: { slug: string; boxRoot: string | undefined; endpoints: EndpointProvider }): Promise<UnavailableBox> {
  // Maintenance records live in the box's Git directory; a root without one has none.
  const hasGit = args.boxRoot !== undefined && await resolveGitDir(args.boxRoot) !== null;
  const maintenance = hasGit && args.boxRoot !== undefined ? await boxMaintenanceStatus(args.boxRoot) : null;
  if (maintenance?.owner) {
    const remainingMs = maintenance.until === undefined ? undefined : Math.max(0, Date.parse(maintenance.until) - Date.now());
    const retryAfter = remainingMs === undefined ? DEFAULT_RETRY_AFTER_S : Math.max(1, Math.ceil(remainingMs / 1000));
    const owner = { pid: maintenance.owner.pid, since: maintenance.owner.since };
    return { status: 503, retryAfter, body: {
      error: "box_closed", reason: maintenance.reason, since: maintenance.since, owner,
      message: `Box ${args.slug} is closed for ${maintenance.reason} (pid ${String(owner.pid)}, since ${owner.since}); it reopens when that process finishes or exits`,
    } };
  }
  const detail = args.endpoints.unavailable?.(args.slug);
  return { status: 503, retryAfter: DEFAULT_RETRY_AFTER_S, body: {
    error: "box_unavailable",
    message: detail === undefined ? `Box ${args.slug} is not running` : `Box ${args.slug} is not running: ${detail}`,
  } };
}
