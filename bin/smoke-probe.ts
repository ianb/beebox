/**
 * How a router response becomes a verdict, and what the router's own status
 * says about the generation under test.
 *
 * Pure — no fs, no network, no child processes — so every verdict here is unit
 * tested (bin/smoke-probe.test.ts) instead of being reachable only by breaking
 * a real box on purpose. bin/smoke-harness.ts owns the I/O and calls into this;
 * the run log lives in bin/smoke-lib.ts.
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

import { isRecord } from "../callback-box/src/lib/is-record.js";
import {
  BoxFailedToStartError,
  CredentialRefusedError,
  NotBackendResponseError,
  UnexpectedStatusError,
  UnhandledProbeVerdictError,
  type SmokeFailureError,
} from "./smoke-errors.js";

// ── the router's answers ────────────────────────────────────────────────────

/**
 * What a response to `GET /<worktree>/<box>/` actually tells us.
 *
 * These are three different bugs and the tier must not blur them: `failed` is
 * the app refusing to boot (the failure this tier exists for, which the router
 * renders as an HTML page — bin/router.ts `renderFailedPage`); `unauthorized`
 * is our own credential missing; `unexpected` is anything else.
 */
export type ProbeVerdict =
  | { kind: "ok" }
  | { kind: "failed"; phase: string; message: string; stderr: string }
  | { kind: "unauthorized" }
  | { kind: "unexpected"; status: number }
  /** 200, but not the backend's health payload — vite answered, Fastify did not. */
  | { kind: "not-backend" };

/** The router's failed-to-start page, which is HTML and says so in its title. */
function isFailedStartPage(body: string): boolean {
  return /<title>Worktree .* — failed to start<\/title>/.test(body);
}

/** How much of a child's captured output a failure report carries. */
const STDERR_TAIL_LINES = 30;

/**
 * What the failed-to-start page says, so a red smoke names the cause instead of
 * only the symptom.
 *
 * The router's own message is usually the timeout, not the bug — the bug is in
 * the child's captured output, which the page renders in `<pre>` blocks. Taking
 * the tail of those is the difference between "did not respond within 30s" and
 * the actual thrown error. Restyled markup degrades to "unknown"/empty rather
 * than throwing: a failure report that itself fails is worthless.
 */
export function parseFailedPage(body: string): {
  phase: string;
  message: string;
  stderr: string;
} {
  const phase = /Phase: <code>([^<]*)<\/code>/.exec(body)?.[1] ?? "unknown";
  const message = /<div class="err">([\S\s]*?)<\/div>/.exec(body)?.[1]?.trim() ?? "";
  const blocks = [...body.matchAll(/<pre>([\S\s]*?)<\/pre>/g)]
    .map((match) => unescapeHtml(match[1] ?? "").trim())
    .filter((text) => text !== "");
  const stderr = blocks
    .map((block) => block.split("\n").slice(-STDERR_TAIL_LINES).join("\n"))
    .join("\n\n");
  return { phase, message: unescapeHtml(message), stderr };
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

export function readProbe(input: { status: number; body: string }): ProbeVerdict {
  if (input.status === 200) return { kind: "ok" };
  if (input.status === 401) return { kind: "unauthorized" };
  if (isFailedStartPage(input.body)) {
    return { kind: "failed", ...parseFailedPage(input.body) };
  }
  return { kind: "unexpected", status: input.status };
}

/**
 * `readProbe` for `/api/health`, which is the only cheap request that crosses
 * into the box's Fastify process: vite serves every non-API path itself, so a
 * 200 on a page path proves only that vite is up. A 200 that is not a health
 * payload is therefore not "ok" — it is the request having stopped short.
 */
export function readHealthProbe(input: { status: number; body: string }): ProbeVerdict {
  const verdict = readProbe(input);
  if (verdict.kind !== "ok") return verdict;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch (_e) {
    return { kind: "not-backend" };
  }
  const status = isRecord(parsed) ? parsed["status"] : undefined;
  return typeof status === "string" ? { kind: "ok" } : { kind: "not-backend" };
}

/**
 * Whether a verdict is worth another poll while the box is still coming up.
 * A rendered failed-to-start page is terminal (retrying re-reads the same
 * captured error), and so is our own credential being refused. A 502, a
 * timeout, or vite answering before Fastify is exactly what a box mid-boot
 * looks like — and mid-reload too: the post-commit CLI rebuild makes running
 * box children restart themselves, so a walk started right after a landing
 * meets the same window.
 */
export function isRetryableVerdict(verdict: ProbeVerdict): boolean {
  switch (verdict.kind) {
    case "ok":
    case "failed":
    case "unauthorized":
      return false;
    case "unexpected":
    case "not-backend":
      return true;
    default:
      return neverProbe(verdict);
  }
}

/**
 * Poll `attempt` until it is `ok`, terminal, or the deadline passes. `attempt`
 * returns null when the router refused the connection outright, which
 * mid-restart it briefly does; only a refusal that outlasts the window is the
 * router being down. Pure over its inputs so the retry policy is testable
 * without a router.
 */
export async function pollUntilReady(input: {
  attempt: () => Promise<ProbeVerdict | null>;
  until: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
}): Promise<{ verdict: ProbeVerdict | null; timedOut: boolean }> {
  let last: ProbeVerdict | null = null;
  while (input.now() < input.until) {
    const verdict = await input.attempt();
    if (verdict !== null) {
      if (!isRetryableVerdict(verdict)) return { verdict, timedOut: false };
      last = verdict;
    }
    await input.sleep(input.pollMs);
  }
  return { verdict: last, timedOut: true };
}

/** The failure a probe verdict deserves; null when it passed. */
export function probeFailure(input: {
  verdict: ProbeVerdict;
  url: string;
  body: string;
}): SmokeFailureError | null {
  const { verdict, url } = input;
  switch (verdict.kind) {
    case "ok":
      return null;
    case "failed":
      return new BoxFailedToStartError({
        phase: verdict.phase,
        url,
        message: verdict.message,
        stderr: verdict.stderr,
      });
    case "unauthorized":
      return new CredentialRefusedError(url);
    case "unexpected":
      return new UnexpectedStatusError({ url, status: verdict.status, body: input.body });
    case "not-backend":
      return new NotBackendResponseError({ url, body: input.body });
    default:
      return neverProbe(verdict);
  }
}

function neverProbe(verdict: never): never {
  throw new UnhandledProbeVerdictError(verdict);
}

// ── the router's own view of a generation ───────────────────────────────────

/**
 * A worktree's state in `GET /__router/status`. Only the fields this tier
 * reads; the router publishes more.
 */
export type WorktreeState = "cold" | "starting" | "ready" | "failed" | "unknown";

/**
 * What the router says about one worktree.
 *
 * `unknown` covers both "the router has never heard of this name" and a state
 * string a newer router introduced — the caller treats both as "not running",
 * which is the safe reading for a tier whose next move is to start it.
 */
export function worktreeState(statusJson: unknown, name: string): WorktreeState {
  if (!isRecord(statusJson)) return "unknown";
  const worktrees = statusJson["worktrees"];
  if (!isRecord(worktrees)) return "unknown";
  const entry = worktrees[name];
  if (!isRecord(entry)) return "unknown";
  const state = entry["state"];
  switch (state) {
    case "cold":
    case "starting":
    case "ready":
    case "failed":
      return state;
    default:
      return "unknown";
  }
}

/**
 * When the running generation started, per the router; null unless it is up.
 *
 * This is how the tier proves it is looking at the code that is about to land
 * rather than at whatever was on disk when the generation happened to start.
 * Waiting for the worktree to go `cold` instead does not work: any open browser
 * tab keeps issuing HTTP, and the router lazy-starts on every request, so a
 * stopped worktree is `starting` again within milliseconds. Identity, not
 * absence.
 */
export function generationStartedAt(statusJson: unknown, name: string): number | null {
  if (!isRecord(statusJson)) return null;
  const worktrees = statusJson["worktrees"];
  if (!isRecord(worktrees)) return null;
  const entry = worktrees[name];
  if (!isRecord(entry)) return null;
  const startedAt = entry["startedAt"];
  return typeof startedAt === "number" ? startedAt : null;
}

/**
 * Is the generation now serving a different one from the generation this run
 * replaced?
 *
 * Identity, not clock ordering. Comparing `startedAt` against the moment the
 * stop returned looks equivalent and is not: the router unlinks a handle before
 * tearing it down, so any request arriving during teardown lazy-starts a
 * replacement whose `startedAt` predates the stop's return. That replacement is
 * running the same on-disk source we are testing and is perfectly good — timing
 * it out would be a false red that wedges a landing for no reason.
 *
 * `null` now fails closed: the router reporting no start time is not proof of
 * anything, least of all freshness.
 */
export function isFreshGeneration(input: {
  before: number | null;
  now: number | null;
}): boolean {
  if (input.now === null) return false;
  return input.now !== input.before;
}
