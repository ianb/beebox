/**
 * Why a configured box has no endpoint right now, as an HTTP answer. The
 * 2026-09-16 incident's only symptom was a bare 404 "No running box" while
 * every box sat closed for an abandoned migration; a known box that cannot be
 * served now says so, with the reason and when it began.
 */
import type { FastifyReply } from "fastify";
import { boxMaintenanceStatus } from "../../lib/box-maintenance.js";
import { resolveGitDir } from "../../lib/git-lock.js";
import type { EndpointProvider } from "../endpoints.js";
import { escapeHtml } from "../../lib/escape-html.js";

export interface UnavailableBox {
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
 * which renders whatever body it gets) receives `renderUnavailablePage`, which
 * reloads itself; any other method that accepts HTML gets the sentence as plain
 * text, since a reload would repeat it as a GET. An API client receives the JSON
 * body.
 */
export async function replyNoEndpoint(reply: FastifyReply, args: { slug: string | null; reqPath: string; method: string; accept: string | undefined; boxRoot: string | undefined; endpoints: EndpointProvider; detailed: boolean }): Promise<FastifyReply> {
  if (args.slug === null || !args.endpoints.slugs().includes(args.slug)) {
    return reply.status(404).send({ error: "not_found", message: `No running box for ${JSON.stringify(args.reqPath)}` });
  }
  const unavailable: UnavailableBox = args.detailed
    ? await describeUnavailableBox({ slug: args.slug, boxRoot: args.boxRoot, endpoints: args.endpoints })
    : { status: 503, retryAfter: DEFAULT_RETRY_AFTER_S, body: { error: "box_unavailable", message: `Box ${args.slug} is not running` } };
  reply.status(unavailable.status).header("retry-after", String(unavailable.retryAfter));
  if (args.accept?.includes("text/html")) {
    if (args.method === "GET" || args.method === "HEAD") return reply.type("text/html; charset=utf-8").send(renderUnavailablePage(unavailable));
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

/** Below this, a reload would restart the swing before it settles. */
const MIN_SWING_RETRY_S = 10;

/**
 * The page a navigation gets: a paper sign that swings once on its pin, the
 * full message, and a bar that drains until the page reloads itself after
 * Retry-After. No script (meta refresh), and no motion under reduced motion.
 */
export function renderUnavailablePage(unavailable: UnavailableBox): string {
  const { body, retryAfter } = unavailable;
  const [headline, subline] = body.error === "box_closed" ? ["Closed", `for ${body.reason}`] : ["Not open", "right now"];
  const swing = retryAfter >= MIN_SWING_RETRY_S ? " swing" : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${String(retryAfter)}">
  <title>${escapeHtml(`${headline} ${subline}`)} · Bee Box</title>
  <style>
    :root { color-scheme: light dark; --desk: #e4e0d9; --paper: #f5efe2; --ink: #332e27; --soft: #4f4439; --edge: #d6c8af; --pen: #2b4264; --string: #8a7a62; }
    @media (prefers-color-scheme: dark) { :root { --desk: #23211e; --paper: #3a352d; --ink: #f1e9da; --soft: #cbbfa9; --edge: #5a5143; --pen: #9fb5d8; --string: #a8987e; } }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--desk); color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
    main { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 24px 16px; text-align: center; }
    .sign { transform-origin: 50% 4px; }
    .swing { animation: swing 2600ms ease-out both; }
    @keyframes swing { from { transform: rotate(11deg); } 22% { transform: rotate(-7deg); } 44% { transform: rotate(4deg); } 66% { transform: rotate(-2deg); } 84% { transform: rotate(.6deg); } }
    .string { display: block; width: 120px; height: 40px; margin: 0 auto -2px; }
    .string path { fill: none; stroke: var(--string); stroke-width: 1.2; }
    .string circle { fill: #8b3f2c; }
    .tag { width: 200px; padding: 14px 12px 12px; background: var(--paper); border: 1px solid var(--edge); border-radius: 6px; box-shadow: 0 1px 2px #0002, 0 6px 14px #0002; }
    h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: .02em; }
    .tag p { margin: 2px 0 0; color: var(--soft); }
    .detail { max-width: 26rem; margin: 6px 0 0; color: var(--soft); line-height: 1.5; overflow-wrap: anywhere; }
    .drain { width: 200px; height: 3px; border-radius: 2px; background: var(--edge); overflow: hidden; }
    .drain span { display: block; height: 100%; background: var(--pen); transform-origin: left; transform: scaleX(0); animation: drain ${String(retryAfter)}s linear both; }
    @keyframes drain { from { transform: scaleX(1); } }
    .retry { margin: 0; font: 13px ui-sans-serif, system-ui, sans-serif; color: var(--soft); }
    @media (prefers-reduced-motion: reduce) { .swing { animation: none; } .drain { display: none; } }
  </style>
</head>
<body>
  <main>
    <div class="sign${swing}">
      <svg class="string" viewBox="0 0 120 40" aria-hidden="true"><path d="M10 40 L60 4 L110 40"/><circle cx="60" cy="4" r="3"/></svg>
      <div class="tag"><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(subline)}</p></div>
    </div>
    <p class="detail">${escapeHtml(body.message)}</p>
    <div class="drain" aria-hidden="true"><span></span></div>
    <p class="retry">Rechecks automatically every ${String(retryAfter)} seconds.</p>
  </main>
</body>
</html>
`;
}
