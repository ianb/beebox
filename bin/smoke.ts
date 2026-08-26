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
 *   bin/smoke --report        # what each step has caught, and what it costs
 *
 * Proving the tier can still go red means breaking something on purpose. Say so
 * when you do:
 *
 *   CB_SMOKE_FAULT_INJECTION="hub throws at import" bin/smoke
 *
 * That reason is stamped on the run, and every count in `--report` and in the
 * weekly review excludes it. Without it a manufactured red is indistinguishable
 * from one the tier caught, and the first weekly review duly read one as a real
 * intermittent worth watching.
 *
 * Every run appends to a shared log beside the test ledger, and `--report`
 * folds it into per-step counts. That exists to be acted on: a step that has
 * never caught anything is paying rent out of a two-minute budget, and the
 * report is what says so.
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

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { BrowseSession } from "../callback-box/test/tours/tour-lib/browse.js";
import { VIEWPORTS } from "../callback-box/test/tours/tour-lib/types.js";
import { invariant } from "../callback-box/src/lib/invariant.js";
import {
  SmokeFailure,
  cardViewRendered,
  directoryRowCount,
  formatSmokeReport,
  smokeLogPath,
  summarizeSmokeLog,
  firstCardRow,
  generationStartedAt,
  hasDomId,
  isFreshGeneration,
  placeMenuFailure,
  probeFailure,
  readPlaceMenu,
  readProbe,
  refFor,
  type SmokeRunRecord,
  type SmokeStepRecord,
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
  report: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const boxIndex = argv.indexOf("--box");
  const box = boxIndex === -1 ? "test1" : argv[boxIndex + 1];
  if (box === undefined || box.startsWith("-")) throw new Error("--box needs a slug");
  return {
    box,
    restart: !argv.includes("--no-restart"),
    report: argv.includes("--report"),
  };
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
}

/**
 * The reason this run was deliberately broken, if it was.
 *
 * A reason rather than a flag: `=1` records that someone was testing the tier
 * but not what they broke, and the value is the only thing a later reader has.
 */
function faultInjection(): string | null {
  const reason = process.env["CB_SMOKE_FAULT_INJECTION"];
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
function record(entry: SmokeRunRecord): void {
  try {
    appendFileSync(logPath(), `${JSON.stringify(entry)}\n`);
  } catch (e) {
    process.stdout.write(
      `smoke: could not append to the run log (${e instanceof Error ? e.message : String(e)})\n`,
    );
  }
}

function report(): number {
  let lines: string[] = [];
  try {
    lines = readFileSync(logPath(), "utf-8").split("\n");
  } catch {
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
        reject(
          new SmokeFailure(
            `"${step}" did not finish within the remaining budget` +
              ` (${String(BUDGET_MS / 1000)}s total)`,
          ),
        );
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
 * report the identity of the one that was replaced.
 *
 * `retry` first: it clears a parked `failed` entry, without which every later
 * request is answered from the cached error and the tier stays red even after
 * the bug is fixed. Then `stop`, which the router performs and awaits.
 */
async function restartGeneration(name: string, budget: Budget): Promise<number | null> {
  const before = await generationAge(name);
  const timeoutMs = () => Math.min(TEARDOWN_MS, Math.max(budget.remaining(), 1_000));
  await control({ path: `/__router/retry/${name}`, method: "POST", timeoutMs: timeoutMs() });
  const stopped = await control({
    path: `/__router/stop/${name}`,
    method: "POST",
    timeoutMs: timeoutMs(),
  });
  if (stopped.status !== 200) {
    throw new SmokeFailure(
      `the router refused to stop ${name} (${String(stopped.status)})`,
      stopped.body.slice(0, 2000),
    );
  }
  return before;
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
  /**
   * Stable across rewordings — the run log is keyed by this, so a renamed step
   * keeps its history instead of looking like a new one with no data.
   */
  id: string;
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

  // Recorded by the restart step and read by the cold-start step, which is how
  // the second one proves the generation answering it is not the one the first
  // replaced. `undefined` means the restart step did not run.
  let replaced: { before: number | null } | undefined;

  if (options.restart) {
    steps.push({
      id: "restart",
      name: "restart the dev-server generation",
      run: async () => {
        // A browser tab left open from an earlier walk keeps issuing HTTP, and
        // every request lazy-starts the worktree again — so the browser goes
        // away before the teardown, not after it.
        await session.close();
        replaced = { before: await restartGeneration(worktree, budget) };
      },
    });
  }

  steps.push({
    id: "cold-start",
    name: "the box serves its root after a cold start",
    run: async () => {
      await waitForBox(`${baseUrl}/`, key, budget);
      if (replaced === undefined) return;
      const now = await generationAge(worktree);
      if (!isFreshGeneration({ before: replaced.before, now })) {
        throw new SmokeFailure(
          "the box served, but the router still reports the generation this run replaced" +
            " — it is running older source than the code under test",
          `generation before: ${String(replaced.before)}, now: ${String(now)}`,
        );
      }
    },
  });

  steps.push({
    id: "backend",
    name: "the box's backend answers",
    // `/api/…`, not a page path. Vite serves every non-API path itself, so a
    // 200 on `/chat` proves only that vite is up — it never reaches the box's
    // Fastify process. `/api/health` is proxied through to the backend, so it
    // is the cheapest request that actually crosses into the app.
    run: async () => {
      const url = `${baseUrl}/api/health`;
      const result = await probe(url, key, Math.min(30_000, budget.remaining())).catch(
        (e: unknown) => {
          throw routerDownFailure(url, e);
        },
      );
      const failure = probeFailure({ verdict: readProbe(result), url, body: result.body });
      if (failure !== null) throw failure;
      // The verdict itself is deliberately not asserted: a real box reports
      // "degraded" for ordinary content reasons, and failing a landing over the
      // state of someone's test box would be a false red. That the backend
      // composed and returned its own health payload is the assertion.
      const parsed: unknown = JSON.parse(result.body);
      const status = (parsed as { status?: unknown }).status;
      if (typeof status !== "string") {
        throw new SmokeFailure(
          `${url} answered 200 but not with a health payload — the request did not reach the backend`,
          result.body.slice(0, 2000),
        );
      }
    },
  });

  steps.push({
    id: "chat-shell",
    name: "the chat page renders its shell",
    run: async () => {
      // The first real navigation after `restart`'s session.close() launches a
      // fresh Chrome window at whatever size the browser defaults to, which is
      // narrower than this app's desktop breakpoint — every step below reads
      // the composer and app bar as they render on desktop. about:blank first,
      // same as tour-lib's own runner, so the viewport applies before anything
      // real ever paints.
      const desktopViewport = VIEWPORTS.find((v) => v.name === "desktop");
      invariant(desktopViewport !== undefined, "tour-lib dropped its desktop viewport spec");
      await session.open("about:blank", { noWait: true });
      await session.setViewport(desktopViewport.width, desktopViewport.height);

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
    id: "place-menu",
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
    id: "browse-list",
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
    id: "card-open",
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
      if (!cardViewRendered(snapshot)) {
        throw new SmokeFailure(
          `the card view for "${row.name}" mounted but rendered no card — its content did not load`,
          snapshot,
        );
      }
    },
  });

  steps.push({
    id: "page-errors",
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
  if (options.report) return report();
  const worktree = worktreeName();
  const baseUrl = `http://localhost:${routerPort()}/${worktree}/${options.box}`;
  const key = browseKey();
  const budget = new Budget(BUDGET_MS);
  const session = new BrowseSession("smoke");
  const startedAt = Date.now();

  // Last resort. `race` above fails the step, but a spawned `bin/browse` that
  // never exits keeps the event loop alive and this process with it — so the
  // deadline is also enforced by leaving. `unref` so a normal run is not held
  // open by the timer itself.
  const killer = setTimeout(() => {
    process.stdout.write(
      `\nFAIL smoke exceeded its ${String(BUDGET_MS / 1000)}s budget and was killed\n\nSMOKE: red\n`,
    );
    process.exit(1);
  }, BUDGET_MS + 5_000);
  killer.unref();

  process.stdout.write(`smoke: ${baseUrl}\n`);
  if (faultInjection() !== null) {
    // Loud, because the whole point is that this run must not be mistaken for a
    // real one — by a reader now or by the weekly review later.
    process.stdout.write(
      `smoke: FAULT INJECTION DECLARED — "${faultInjection() ?? ""}".` +
        " This run is excluded from every count in --report.\n",
    );
  }
  // Page errors accumulate per session; clear first so the last step reports
  // this walk's errors rather than whatever an earlier browse left behind.
  await session.run(["errors", "--clear"]).catch(() => {
    // No live session yet — there is nothing to clear, and `open` starts one.
  });

  const steps = buildSteps({ baseUrl, key, worktree, budget, session, options });
  // Seeded with every step as `not-run`, so a walk that stops early still
  // records what it never reached rather than leaving those rows absent.
  const outcomes = new Map<string, SmokeStepRecord>(
    steps.map((step) => [step.id, { id: step.id, outcome: "not-run", ms: 0 }]),
  );
  const injected = faultInjection();
  const finish = (verdict: "green" | "red", failure?: { step: string; message: string }): void => {
    record({
      ts: new Date().toISOString(),
      commit: git(["rev-parse", "HEAD"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      worktree,
      box: options.box,
      verdict,
      ms: Date.now() - startedAt,
      ...(failure === undefined
        ? {}
        : { failedStep: failure.step, failure: failure.message.split("\n")[0] ?? "" }),
      ...(injected === null ? {} : { faultInjected: injected }),
      steps: [...outcomes.values()],
    });
  };

  for (const step of steps) {
    budget.check(step.name);
    const at = Date.now();
    try {
      await budget.race(step.name, step.run());
    } catch (e) {
      outcomes.set(step.id, { id: step.id, outcome: "fail", ms: Date.now() - at });
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
      finish("red", { step: step.id, message: failure.message });
      process.stdout.write(`\nSMOKE: red\n`);
      return 1;
    }
    outcomes.set(step.id, { id: step.id, outcome: "ok", ms: Date.now() - at });
    process.stdout.write(
      `ok   ${step.name} (${((Date.now() - at) / 1000).toFixed(1)}s)\n`,
    );
  }
  finish("green");
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
