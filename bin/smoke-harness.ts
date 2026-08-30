/**
 * The smoke tier's plumbing: argument parsing, the shared run log, the dev
 * router's control plane over its unix socket, the wall-clock budget, and the
 * cold-start wait. bin/smoke.ts owns the walk itself and calls into this.
 *
 * Split out of bin/smoke.ts for size; behaviour is unchanged.
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { request as httpRequest } from "node:http";
import { invariant } from "../beebox/src/lib/invariant.js";
import {
  BudgetExhaustedError,
  MissingBoxSlugError,
  NoAnswerAfterRestartError,
  RouterRefusedStopError,
  RouterRequestTimeoutError,
  RouterSocketDownError,
  RouterUnreachableError,
  StepOverBudgetError,
  StillFailingAfterRestartError,
  type SmokeFailureError,
} from "./smoke-errors.js";
import {
  generationStartedAt,
  pollUntilReady,
  probeFailure,
  readHealthProbe,
} from "./smoke-probe.js";
import { formatSmokeReport, smokeLogPath, summarizeSmokeLog, type SmokeRunRecord } from "./smoke-lib.js";

export const REPO_ROOT = join(import.meta.dirname, "..");

/** Hard wall-clock ceiling. A walk that has not finished by here is a failure. */
export const BUDGET_MS = 120_000;

/** How long the box gets to answer its first request after the restart. */
export const COLD_START_MS = 90_000;

/** How long the router gets to tear down the generation we signalled. */
const TEARDOWN_MS = 20_000;

const POLL_MS = 250;

export interface Options {
  box: string;
  restart: boolean;
  report: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const boxIndex = argv.indexOf("--box");
  const box = boxIndex === -1 ? "test1" : argv[boxIndex + 1];
  if (box === undefined || box.startsWith("-")) throw new MissingBoxSlugError();
  return {
    box,
    restart: !argv.includes("--no-restart"),
    report: argv.includes("--report"),
  };
}

export function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
}

/**
 * The reason this run was deliberately broken, if it was.
 *
 * A reason rather than a flag: `=1` records that someone was testing the tier
 * but not what they broke, and the value is the only thing a later reader has.
 */
export function faultInjection(): string | null {
  const reason = process.env["BBX_SMOKE_FAULT_INJECTION"];
  return reason === undefined || reason.trim() === "" ? null : reason.trim();
}

function logPath(): string {
  const common = git(["rev-parse", "--git-common-dir"]);
  // A path relative to the checkout is what `--git-common-dir` returns in the
  // main checkout (a bare `.git`); resolve it so every worktree appends to the
  // same file rather than to one of its own.
  return smokeLogPath(common.startsWith("/") ? common : join(REPO_ROOT, common));
}

/**
 * Append this run to the shared log.
 *
 * Never throws into the run's own verdict: a smoke walk that went green must
 * not report red because bookkeeping failed, and one that went red must still
 * say so. A failure to record is worth seeing, so it is printed.
 */
export function record(entry: SmokeRunRecord): void {
  try {
    appendFileSync(logPath(), `${JSON.stringify(entry)}\n`);
  } catch (e) {
    process.stdout.write(
      `smoke: could not append to the run log (${e instanceof Error ? e.message : String(e)})\n`,
    );
  }
}

export function report(): number {
  let lines: string[] = [];
  try {
    lines = readFileSync(logPath(), "utf-8").split("\n");
  } catch (_e) {
    // No log yet is a legitimate state, and summarize says so.
  }
  process.stdout.write(formatSmokeReport(summarizeSmokeLog(lines)));
  return 0;
}

/**
 * The worktree segment the router routes by — the checkout directory's name,
 * NOT the git branch. `worktree-<name>` is the branch; the router serves
 * `/<name>/`, and a URL built from the branch name hits nothing.
 */
export function worktreeName(): string {
  return REPO_ROOT.includes("/beebox-worktrees/") ? basename(REPO_ROOT) : "main";
}

export function routerPort(): string {
  return process.env["ROUTER_PORT"] ?? "3210";
}

/**
 * The dev credential, read with the SAME parser the router and bin/browse use.
 * Absent is not an error here — the probe then gets a 401 and says so, which is
 * a clearer report than a guess about why.
 */
export function browseKey(): string | null {
  try {
    const parsed = parseEnv(readFileSync(join(REPO_ROOT, "beebox/.env"), "utf8"));
    const key = parsed["BBX_BROWSE_API_KEY"];
    return typeof key === "string" && key !== "" ? key : null;
  } catch (_e) {
    // No .env in this checkout: proceed unauthenticated and let the probe say so.
    return null;
  }
}

/**
 * The router's unix socket. A request arriving there is `trustedLocal` — a
 * browser cannot originate one, so the router treats the socket itself as the
 * capability and asks for no credential (bin/router-auth.ts). That is what lets
 * this tier drive the control plane it otherwise has no session for.
 */
function routerSocket(): string {
  const stateDir = process.env["BBX_STATE_DIR"] ?? join(homedir(), ".cache", "beebox");
  return join(stateDir, "router.sock");
}

/**
 * One request to the router over its socket, via `node:http` — the global
 * `fetch` has no supported way to dial a unix socket without reaching into
 * undici's dispatcher, and this needs nothing fetch offers.
 */
function control(input: {
  path: string;
  method: "GET" | "POST";
  timeoutMs: number;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath: routerSocket(),
        path: input.path,
        method: input.method,
        timeout: input.timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new RouterRequestTimeoutError(input.timeoutMs));
    });
    request.on("error", (e) => {
      reject(new RouterSocketDownError({ socketPath: routerSocket(), cause: e.message }));
    });
    request.end();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A deadline shared by every step, so one slow step cannot eat the whole budget. */
export class Budget {
  private readonly endsAt: number;

  constructor(ms: number) {
    this.endsAt = Date.now() + ms;
  }

  remaining(): number {
    return this.endsAt - Date.now();
  }

  check(step: string): void {
    if (this.remaining() <= 0) {
      throw new BudgetExhaustedError({ step, budgetSeconds: String(BUDGET_MS / 1000) });
    }
  }

  /**
   * Fail a step that outruns the budget instead of waiting on it.
   *
   * Checking the clock only between steps bounds nothing: every browser call
   * spawns `bin/browse`, and a hung Chrome would block one step forever. That
   * is worse here than anywhere else, because `bin/finish-verify` runs its
   * commands with `spawnSync` and no timeout — a smoke walk that never returns
   * hangs the whole landing with no verdict printed at all.
   */
  async race<T>(step: string, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new StepOverBudgetError({ step, budgetSeconds: String(BUDGET_MS / 1000) }));
      }, Math.max(this.remaining(), 0));
    });
    try {
      return await Promise.race([work, expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

interface Probe {
  status: number;
  body: string;
}

async function probe(input: { url: string; key: string | null; timeoutMs: number }): Promise<Probe> {
  const headers: Record<string, string> = {};
  if (input.key !== null) headers["cookie"] = `bbx_browse_key=${input.key}`;
  const response = await fetch(input.url, {
    headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  return { status: response.status, body: await response.text() };
}

/** A router that is not listening at all, told apart from a box that is broken. */
function routerDownFailure(url: string, cause: unknown): SmokeFailureError {
  return new RouterUnreachableError({
    url,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
}

/**
 * Replace the running generation through the router's own control plane, and
 * report the identity of the one that was replaced.
 *
 * `retry` first: it clears a parked `failed` entry, without which every later
 * request is answered from the cached error and the tier stays red even after
 * the bug is fixed. Then `stop`, which the router performs and awaits.
 */
export async function restartGeneration(name: string, budget: Budget): Promise<number | null> {
  const before = await generationAge(name);
  const timeoutMs = () => Math.min(TEARDOWN_MS, Math.max(budget.remaining(), 1_000));
  await control({ path: `/__router/retry/${name}`, method: "POST", timeoutMs: timeoutMs() });
  const stopped = await control({
    path: `/__router/stop/${name}`,
    method: "POST",
    timeoutMs: timeoutMs(),
  });
  if (stopped.status !== 200) {
    throw new RouterRefusedStopError({ name, status: stopped.status, body: stopped.body });
  }
  return before;
}

/** The router's start time for this worktree, or null if it reports none. */
export async function generationAge(name: string): Promise<number | null> {
  const status = await control({ path: "/__router/status", method: "GET", timeoutMs: 5_000 });
  const parsed: unknown = JSON.parse(status.body);
  return generationStartedAt(parsed, name);
}

/**
 * Wait until the box's BACKEND answers, or until it answers with a real verdict.
 *
 * `/api/health`, not the root: vite serves every non-API path itself, so the
 * root is up seconds before the box's Fastify process is, and a walk that
 * started on the root's say-so met a 502 on its first real request
 * (2026-08-26, right after a landing — the post-commit CLI rebuild had the box
 * child mid-reload). The verdict itself is deliberately not asserted: a real
 * box reports "degraded" for ordinary content reasons, and failing a landing
 * over the state of someone's test box would be a false red. That the backend
 * composed and returned its own health payload is the readiness signal.
 */
export async function waitForBox(input: {
  url: string;
  key: string | null;
  budget: Budget;
}): Promise<void> {
  const { url, key, budget } = input;
  let refused: SmokeFailureError | null = null;
  let lastBody = "";
  const { verdict, timedOut } = await pollUntilReady({
    attempt: async () => {
      try {
        const result = await probe({ url, key, timeoutMs: 5_000 });
        lastBody = result.body;
        return readHealthProbe(result);
      } catch (e) {
        refused = routerDownFailure(url, e);
        return null;
      }
    },
    until: Date.now() + Math.min(COLD_START_MS, budget.remaining()),
    now: Date.now,
    sleep,
    pollMs: POLL_MS,
  });
  if (verdict !== null && !timedOut) {
    const failure = probeFailure({ verdict, url, body: lastBody });
    if (failure !== null) throw failure;
    return;
  }
  if (verdict !== null) {
    const failure = probeFailure({ verdict, url, body: lastBody });
    invariant(failure !== null, "a retryable verdict is never ok");
    throw new StillFailingAfterRestartError({
      message: failure.message,
      detail: failure.detail,
      coldStartSeconds: String(COLD_START_MS / 1000),
    });
  }
  throw (
    refused ??
    new NoAnswerAfterRestartError({ url, coldStartSeconds: String(COLD_START_MS / 1000) })
  );
}
