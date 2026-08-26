/**
 * The smoke tier: boot a real box and walk it, so a landing that typechecks,
 * lints and passes its selected tests still has to prove the app runs.
 *
 * Three escapes on 2026-08-25/26 passed every other gate because the code was
 * right and the *state* was wrong — a server that 404s page navigations, a
 * place menu killed by broken global Codex state, a chat turn that crashed on
 * an unknown SDK item. Only a real box on the real machine shows those. See
 * issues/exploration/2026-08-26-merge-time-smoke-tier.md and
 * issues/exploration/2026-08-26-post-test-economics-retro.md.
 *
 *   bin/smoke                 # walk this worktree's box through the dev router
 *   bin/smoke --box <slug>    # a box other than test1
 *   bin/smoke --no-restart    # skip the cold start (debugging the walk itself)
 *
 * It restarts the checkout's dev-server generation first, on purpose: the
 * router runs TypeScript straight off disk and nothing reloads it
 * (bin/router-lifecycle.ts), so without a restart this would test whatever
 * source was on disk whenever the generation happened to start. That restart is
 * also the floor the tier exists for — a server that cannot boot fails here.
 *
 * Deliberately model-free: no agent turns, nothing that spends tokens or waits
 * on a model. Budget is a hard wall-clock kill, not a target.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { BrowseSession } from "../callback-box/test/tours/tour-lib/browse.js";
import {
  SmokeFailure,
  directoryRowCount,
  firstCardRow,
  generationStartedAt,
  hasDomId,
  isFreshGeneration,
  placeMenuFailure,
  probeFailure,
  readPlaceMenu,
  readProbe,
  refFor,
} from "./smoke-lib.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Hard wall-clock ceiling. A walk that has not finished by here is a failure. */
const BUDGET_MS = 120_000;

/** How long the box gets to answer its first request after the restart. */
const COLD_START_MS = 90_000;

/** How long the router gets to tear down the generation we signalled. */
const TEARDOWN_MS = 20_000;

const POLL_MS = 250;

interface Options {
  box: string;
  restart: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const boxIndex = argv.indexOf("--box");
  const box = boxIndex === -1 ? "test1" : argv[boxIndex + 1];
  if (box === undefined || box.startsWith("-")) throw new Error("--box needs a slug");
  return { box, restart: !argv.includes("--no-restart") };
}

/**
 * The worktree segment the router routes by — the checkout directory's name,
 * NOT the git branch. `worktree-<name>` is the branch; the router serves
 * `/<name>/`, and a URL built from the branch name hits nothing.
 */
function worktreeName(): string {
  return REPO_ROOT.includes("/callback-worktrees/") ? basename(REPO_ROOT) : "main";
}

function routerPort(): string {
  return process.env["ROUTER_PORT"] ?? "3210";
}

/**
 * The dev credential, read with the SAME parser the router and bin/browse use.
 * Absent is not an error here — the probe then gets a 401 and says so, which is
 * a clearer report than a guess about why.
 */
function browseKey(): string | null {
  try {
    const parsed = parseEnv(readFileSync(join(REPO_ROOT, "callback-box/.env"), "utf8"));
    const key = parsed["CB_BROWSE_API_KEY"];
    return typeof key === "string" && key !== "" ? key : null;
  } catch {
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
  const stateDir = process.env["CALLBACK_STATE_DIR"] ?? join(homedir(), ".cache", "callback-box");
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
      request.destroy(new Error(`no answer within ${String(input.timeoutMs)}ms`));
    });
    request.on("error", (e) => {
      reject(
        new SmokeFailure(
          `the dev router is not answering on its socket (${routerSocket()})` +
            " — start it with `pnpm dev` in the main checkout (it is shared; do not restart a running one)",
          e.message,
        ),
      );
    });
    request.end();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A deadline shared by every step, so one slow step cannot eat the whole budget. */
class Budget {
  private readonly endsAt: number;

  constructor(ms: number) {
    this.endsAt = Date.now() + ms;
  }

  remaining(): number {
    return this.endsAt - Date.now();
  }

  check(step: string): void {
    if (this.remaining() <= 0) {
      throw new SmokeFailure(
        `budget exhausted (${String(BUDGET_MS / 1000)}s) before "${step}" could finish`,
      );
    }
  }
}

interface Probe {
  status: number;
  body: string;
}

async function probe(url: string, key: string | null, timeoutMs: number): Promise<Probe> {
  const headers: Record<string, string> = {};
  if (key !== null) headers["cookie"] = `cb_browse_key=${key}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.text() };
}

/** A router that is not listening at all, told apart from a box that is broken. */
function routerDownFailure(url: string, cause: unknown): SmokeFailure {
  return new SmokeFailure(
    `the dev router is not answering at ${url}` +
      " — start it with `pnpm dev` in the main checkout (it is shared; do not restart a running one)",
    cause instanceof Error ? cause.message : String(cause),
  );
}

/**
 * Replace the running generation through the router's own control plane, and
 * report the instant the old one was gone.
 *
 * `retry` first: it clears a parked `failed` entry, without which every later
 * request is answered from the cached error and the tier stays red after the
 * bug is fixed. Then `stop`, which the router performs and awaits — the handle
 * is unlinked before teardown, so once it answers, nothing can still be served
 * by the generation we replaced. The returned timestamp is what the cold-start
 * step checks the new generation against.
 */
async function restartGeneration(name: string, budget: Budget): Promise<number> {
  const timeoutMs = Math.min(TEARDOWN_MS, Math.max(budget.remaining(), 1_000));
  await control({ path: `/__router/retry/${name}`, method: "POST", timeoutMs });
  const stopped = await control({ path: `/__router/stop/${name}`, method: "POST", timeoutMs });
  if (stopped.status !== 200) {
    throw new SmokeFailure(
      `the router refused to stop ${name} (${String(stopped.status)})`,
      stopped.body.slice(0, 2000),
    );
  }
  return Date.now();
}

/** The router's start time for this worktree, or null if it reports none. */
async function generationAge(name: string): Promise<number | null> {
  const status = await control({ path: "/__router/status", method: "GET", timeoutMs: 5_000 });
  return generationStartedAt(JSON.parse(status.body) as unknown, name);
}

/** Poll the box root until it serves, or until it answers with a real verdict. */
async function waitForBox(url: string, key: string | null, budget: Budget): Promise<void> {
  const until = Date.now() + Math.min(COLD_START_MS, budget.remaining());
  let last: SmokeFailure | null = null;
  while (Date.now() < until) {
    let result: Probe;
    try {
      result = await probe(url, key, 5_000);
    } catch (e) {
      // Mid-restart the router briefly refuses; only a persistent refusal is
      // the router being down, which the timeout below reports.
      last = routerDownFailure(url, e);
      await sleep(POLL_MS);
      continue;
    }
    const verdict = readProbe(result);
    // A rendered failed-to-start page is terminal: retrying re-reads the same
    // captured error. Everything else gets the rest of the window.
    if (verdict.kind === "failed" || verdict.kind === "unauthorized") {
      throw probeFailure({ verdict, url, body: result.body }) ?? new Error("unreachable");
    }
    if (verdict.kind === "ok") return;
    last = probeFailure({ verdict, url, body: result.body });
    await sleep(POLL_MS);
  }
  throw (
    last ??
    new SmokeFailure(`${url} did not serve within ${String(COLD_START_MS / 1000)}s of the restart`)
  );
}

interface Step {
  name: string;
  run: () => Promise<void>;
}

function buildSteps(input: {
  baseUrl: string;
  key: string | null;
  worktree: string;
  budget: Budget;
  session: BrowseSession;
  options: Options;
}): Step[] {
  const { baseUrl, key, worktree, budget, session, options } = input;
  const steps: Step[] = [];

  // Set by the restart step and read by the cold-start step, which is how the
  // second one can prove the generation answering it is the one the first
  // asked for.
  let stoppedAt: number | null = null;

  if (options.restart) {
    steps.push({
      name: "restart the dev-server generation",
      run: async () => {
        // A browser tab left open from an earlier walk keeps issuing HTTP, and
        // every request lazy-starts the worktree again — so the browser goes
        // away before the teardown, not after it.
        await session.close();
        stoppedAt = await restartGeneration(worktree, budget);
      },
    });
  }

  steps.push({
    name: "the box serves its root after a cold start",
    run: async () => {
      await waitForBox(`${baseUrl}/`, key, budget);
      if (stoppedAt === null) return;
      const startedAt = await generationAge(worktree);
      if (!isFreshGeneration({ startedAt, stoppedAt })) {
        throw new SmokeFailure(
          `the box served, but the router reports a generation that predates this run's restart` +
            ` — it is running older source than the code under test`,
          `stopped at ${String(stoppedAt)}, generation started at ${String(startedAt)}`,
        );
      }
    },
  });

  steps.push({
    name: "the backend answers behind the frontend",
    run: async () => {
      const url = `${baseUrl}/chat`;
      const result = await probe(url, key, Math.min(30_000, budget.remaining())).catch(
        (e: unknown) => {
          throw routerDownFailure(url, e);
        },
      );
      const failure = probeFailure({ verdict: readProbe(result), url, body: result.body });
      if (failure !== null) throw failure;
    },
  });

  steps.push({
    name: "the chat page renders its shell",
    run: async () => {
      await session.open(`${baseUrl}/chat`);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      if (!hasDomId(snapshot, "cb-composer-input") || !hasDomId(snapshot, "cb-nav-place")) {
        throw new SmokeFailure(
          "the chat page loaded but rendered neither its composer nor its app bar",
          snapshot,
        );
      }
    },
  });

  steps.push({
    name: "the place menu opens and lists landmarks",
    run: async () => {
      // The click's exit status means nothing — agent-browser dispatches a
      // mouse event at the box centre and reports success either way — so the
      // assertion is on the consequence, never on the click.
      await session.run(["click", "#cb-nav-place"]);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      const failure = placeMenuFailure(readPlaceMenu(snapshot), snapshot);
      if (failure !== null) throw failure;
    },
  });

  steps.push({
    name: "browse lists the box's real content",
    run: async () => {
      await session.open(`${baseUrl}/browse`);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      if (!hasDomId(snapshot, "cb-browse-crumb-root") || directoryRowCount(snapshot) === 0) {
        throw new SmokeFailure(
          "the browse page rendered no directories — the box's content did not reach the browser",
          snapshot,
        );
      }
    },
  });

  steps.push({
    name: "a card opens and renders",
    run: async () => {
      const listing = await session.snapshot({ interactiveOnly: true });
      const row = firstCardRow(listing);
      if (row === null) {
        throw new SmokeFailure("the browse listing offered no card to open", listing);
      }
      const ref = refFor(listing, row.role, row.name);
      if (ref === null) {
        throw new SmokeFailure(`could not resolve a ref for ${row.role} "${row.name}"`, listing);
      }
      await session.clickRef(ref);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      const url = await session.getUrl();
      if (!url.includes("/browse/") || !hasDomId(snapshot, "cb-browse-open-card")) {
        throw new SmokeFailure(
          `opening the card "${row.name}" did not render a card view (at ${url})`,
          snapshot,
        );
      }
    },
  });

  steps.push({
    name: "the walk raised no uncaught page errors",
    run: async () => {
      const { stdout } = await session.run(["errors"]);
      if (stdout.trim() !== "") {
        throw new SmokeFailure("the page raised uncaught errors during the walk", stdout.trim());
      }
    },
  });

  return steps;
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const worktree = worktreeName();
  const baseUrl = `http://localhost:${routerPort()}/${worktree}/${options.box}`;
  const key = browseKey();
  const budget = new Budget(BUDGET_MS);
  const session = new BrowseSession("smoke");
  const startedAt = Date.now();

  process.stdout.write(`smoke: ${baseUrl}\n`);
  // Page errors accumulate per session; clear first so the last step reports
  // this walk's errors rather than whatever an earlier browse left behind.
  await session.run(["errors", "--clear"]).catch(() => {
    // No live session yet — there is nothing to clear, and `open` starts one.
  });

  const steps = buildSteps({ baseUrl, key, worktree, budget, session, options });
  for (const step of steps) {
    budget.check(step.name);
    const at = Date.now();
    try {
      await step.run();
    } catch (e) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stdout.write(`FAIL ${step.name} (${elapsed}s)\n`);
      const failure =
        e instanceof SmokeFailure
          ? e
          : new SmokeFailure(e instanceof Error ? e.message : String(e));
      process.stdout.write(`\n  ${failure.message}\n`);
      if (failure.detail !== "") {
        process.stdout.write(`\n${indent(failure.detail)}\n`);
      }
      process.stdout.write(`\nSMOKE: red\n`);
      return 1;
    }
    process.stdout.write(
      `ok   ${step.name} (${((Date.now() - at) / 1000).toFixed(1)}s)\n`,
    );
  }
  process.stdout.write(`\nSMOKE: green (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n`);
  return 0;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`smoke: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    });
}
