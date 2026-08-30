/**
 * `runFieldScenario` — one whole field run (`docs/plans/agent-field-tests.md`,
 * Track 2, the activity loop).
 *
 * Everything a run owns is created here and torn down here: the run directory,
 * the disposable box, the dedicated server, the operator session and the browse
 * session. The per-item work lives in `run-item.ts`; this module is setup,
 * the loop, the mutable run state (server handle + box clock) and teardown.
 *
 * Two things are deliberate and were learned the expensive way in the v0 spine
 * run:
 *
 * - **The operator's env is the FULL process env plus the overlay.** The SDK
 *   subprocess inherits exactly what it is given, and a bare overlay costs it
 *   the Claude login ("Not logged in") several minutes into the first activity.
 * - **`BROWSE_BASE_URL` is the box's base URL** (`<origin>/<slug>`), never the
 *   bare origin: browse rewrites `/`-leading paths against it, and an
 *   origin-only value silently drives the wrong box's URL space.
 *
 * Teardown runs in a `finally` and the run directory is always left behind —
 * a run that failed is exactly the one whose screenshots and transcript
 * someone wants to read.
 */

import * as os from "node:os";
import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import { execa } from "execa";
import { randomBytes } from "node:crypto";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { errorMessage } from "../lib/error-guards.js";
import { createChatBackend, type ChatBackend } from "../services/claude-chat.js";
import { createFieldBox } from "./run-box.js";
import { startFieldServer, type FieldServer } from "./run-server.js";
import { loadFieldScenario, type FieldScenario } from "./scenario.js";
import { seedFieldBox, scenarioNeedsGmail } from "./run-seed.js";
import { tagBaseline, BASELINE_TAG, checkpointTag } from "./checkpoints.js";
import { assembleOperatorPrompt } from "./operator-prompt.js";
import { startOperatorSession, type OperatorSession } from "./operator.js";
import { advanceDays, baselineGmailSync } from "./pre-actions.js";
import { runChecklistItem } from "./run-item.js";
import { resolveBrowseCommand, resolveBrowseKey } from "./run-env.js";
import { writeRunResults, type FieldRunResult, type ItemResult } from "./results.js";
import { writeFieldReport } from "./report.js";
import type { FieldRunContext, QuiescenceBudget } from "./run-context.js";

/** Where runs land unless the caller says otherwise. Outside the repo: run
 *  artifacts are disposable and sometimes large. */
export const DEFAULT_RUNS_ROOT = path.join(os.homedir(), "src/boxes/field-runs");

/** Generous by design (real activities take 20-40 minutes) and all
 *  caller-overridable; a cap exists so a stuck run ends, not to hurry anyone. */
const DEFAULT_QUIESCENCE: QuiescenceBudget = {
  timeoutMs: 10 * 60_000,
  pollMs: 5_000,
  settleMs: 5_000,
};

/** The operator drives everything through the browser; `Read` is for its own
 *  screenshots and asset files. Nothing else is available to it. */
const OPERATOR_TOOLS = ["Bash", "Read"];

export interface RunFieldScenarioOptions {
  /** Scenario directory (`beebox/field-tests/<name>/`). */
  scenarioDir: string;
  /** Parent of the run directory. Defaults to {@link DEFAULT_RUNS_ROOT}. */
  runsRoot?: string | undefined;
  /** Run directory name. Defaults to `<scenario>-<timestamp>`. */
  runDirName?: string | undefined;
  /** Chat backend for the operator. Defaults to the real SDK one; doctests
   *  pass the fake, which is the whole reason this is injectable. */
  backend?: ChatBackend | undefined;
  browseCommand?: string | undefined;
  browseKey?: string | undefined;
  quiescence?: Partial<QuiescenceBudget> | undefined;
  /** Per-activity operator limits (see `operator.ts` for the defaults). */
  operator?:
    | {
        maxTurnsPerActivity?: number | undefined;
        activityTimeoutMs?: number | undefined;
        drainGraceMs?: number | undefined;
        timeoutPollMs?: number | undefined;
      }
    | undefined;
  serverReadyTimeoutMs?: number | undefined;
  /** Progress sink. Defaults to stdout, which is what a `bbx` invocation wants. */
  onEvent?: ((message: string) => void) | undefined;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
}

/** Close the run's browse session. Best-effort: a failure here costs a stray
 *  headless browser, never the run's results. */
async function closeBrowseSession(opts: { browseCommand: string; session: string }): Promise<void> {
  await execa(opts.browseCommand, ["--session", opts.session, "close"], { reject: false, timeout: 30_000 });
}

/** Everything a run owns before the operator exists. */
interface PreparedRun {
  runDir: string;
  screenshotsRoot: string;
  browseCommand: string;
  browseKey: string;
  browseSession: string;
  fakeGmailStatePath: string;
  diagKey: string;
  box: Awaited<ReturnType<typeof createFieldBox>>;
  server: FieldServer;
}

/**
 * Build the run's world: directory, disposable box (seeded and baselined), and
 * the dedicated server on the scenario's start time. Split out of
 * `runFieldScenario` so the loop below reads as the loop.
 */
async function prepareRun(opts: {
  options: RunFieldScenarioOptions;
  scenario: FieldScenario;
  emit: (message: string) => void;
}): Promise<PreparedRun> {
  const { options, scenario, emit } = opts;
  const runDir = path.join(
    options.runsRoot ?? DEFAULT_RUNS_ROOT,
    options.runDirName ?? `${scenario.name}-${timestamp()}`,
  );
  const screenshotsRoot = path.join(runDir, "screenshots");
  const browseCommand = options.browseCommand ?? (await resolveBrowseCommand());
  const browseKey = options.browseKey ?? (await resolveBrowseKey());
  const browseSession = `field-${path.basename(runDir)}`;
  const fakeGmailStatePath = path.join(runDir, "fake-gmail.json");
  // One diagnostic key for the whole run, so a restarted server keeps answering
  // the quiescence poll without the harness re-reading anything.
  const diagKey = randomBytes(24).toString("hex");

  await mkdir(screenshotsRoot, { recursive: true });
  emit(`run directory: ${runDir}`);

  const box = await createFieldBox(runDir);
  await seedFieldBox({ box, scenario });
  if (scenarioNeedsGmail(scenario)) {
    await baselineGmailSync({
      statePath: fakeGmailStatePath,
      packageRoot: box.packageRoot,
      env: { BBX_TIME: scenario.startTime },
    });
  }
  await tagBaseline(box.packageRoot);
  emit(`box: ${box.packageRoot} (slug ${box.slug})`);

  const server = await startFieldServer(box, {
    env: {
      BBX_TIME: scenario.startTime,
      BBX_BROWSE_API_KEY: browseKey,
      BBX_FAKE_GMAIL: fakeGmailStatePath,
      BBX_DIAG_API_KEY: diagKey,
    },
    readyTimeoutMs: options.serverReadyTimeoutMs,
  });
  emit(`server: ${server.baseUrl}`);

  return {
    runDir,
    screenshotsRoot,
    browseCommand,
    browseKey,
    browseSession,
    fakeGmailStatePath,
    diagKey,
    box,
    server,
  };
}

/**
 * Run a scenario end to end. Resolves with the run's raw result — also written
 * to `results.json` in the run directory after every item, so a run that dies
 * mid-way still leaves the completed items' evidence behind.
 *
 * Throws only for a failure that prevents a run existing at all (an invalid
 * scenario, no browse key, a server that will not start). Everything after the
 * operator session opens is captured in the result, including an abort.
 */
export async function runFieldScenario(options: RunFieldScenarioOptions): Promise<FieldRunResult> {
  const scenario = await loadFieldScenario(options.scenarioDir);
  const emit = options.onEvent ?? ((message: string) => console.log(`[field-test] ${message}`));
  const prepared = await prepareRun({ options, scenario, emit });
  const { runDir, screenshotsRoot, browseCommand, browseKey, browseSession, box } = prepared;
  const { fakeGmailStatePath, diagKey } = prepared;

  // The run's simulated clock. It is passed explicitly everywhere it matters
  // (`BBX_TIME` for children, `now` for an email fixture's arrival date) rather
  // than set on this process's environment — a harness that mutated its own
  // `BBX_TIME` would reach into anything else sharing the process, doctests
  // included.
  const state: { boxTime: Date; server: FieldServer } = {
    boxTime: new Date(scenario.startTime),
    server: prepared.server,
  };

  const childEnv = (): NodeJS.ProcessEnv => ({
    BBX_TIME: state.boxTime.toISOString(),
    BBX_BROWSE_API_KEY: browseKey,
    BBX_FAKE_GMAIL: fakeGmailStatePath,
    BBX_DIAG_API_KEY: diagKey,
  });
  // Every restart re-binds the SAME port. The operator's base URL is baked into
  // a system prompt written once, and `BROWSE_BASE_URL` into a subprocess env
  // set once — a restart on a fresh port would leave the persona driving a
  // browser at a dead address with no way to learn the new one.
  const { port } = state.server;
  const startAgain = async (): Promise<FieldServer> =>
    startFieldServer(box, { env: childEnv(), port, readyTimeoutMs: options.serverReadyTimeoutMs });

  const restartServer = async (): Promise<void> => {
    await state.server.stop();
    state.server = await startAgain();
    emit(`server restarted: ${state.server.baseUrl}`);
  };

  const result: FieldRunResult = {
    scenario: scenario.name,
    scenarioDir: scenario.dir,
    runDir,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    boxTimeStart: scenario.startTime,
    boxTimeEnd: scenario.startTime,
    models: scenario.models,
    serverBaseUrl: state.server.baseUrl,
    browseSession,
    items: [],
    aborted: null,
    events: [],
  };

  // The system-prompt write, the operator session, and the loop all live inside
  // the try. A live box and server already exist by this point (prepareRun
  // built them), so a failure starting the operator is a real teardown gap, not
  // a "run never existed" case: it must still stop the server, close the browse
  // session, and write results.json + report.md recording the abort. Only
  // prepareRun (before this) throws outright, and it owns cleanup of whatever it
  // half-built.
  let operator: OperatorSession | null = null;
  try {
    const systemPrompt = assembleOperatorPrompt({
      persona: scenario.persona,
      browseCommand,
      browseSession,
      appBaseUrl: state.server.baseUrl,
      screenshotsDir: screenshotsRoot,
      assetsDir: scenario.assetsDir,
    });
    await writeFileAtomic(path.join(runDir, "operator-system-prompt.md"), { content: systemPrompt });

    const op = startOperatorSession({
      backend: options.backend ?? createChatBackend(),
      systemPrompt,
      cwd: runDir,
      model: scenario.models.operator,
      tools: OPERATOR_TOOLS,
      // The FULL env, not just the overlay: an SDK subprocess handed a bare
      // overlay loses the Claude login it needs to exist at all.
      env: { ...process.env, BROWSE_BASE_URL: state.server.baseUrl, BBX_BROWSE_API_KEY: browseKey },
      screenshotsDir: screenshotsRoot,
      ...options.operator,
    });
    operator = op;

    const ctx: FieldRunContext = {
      scenario,
      box,
      runDir,
      screenshotsRoot,
      operator: op,
      server: () => state.server,
      boxTime: () => state.boxTime,
      fakeGmailStatePath,
      quiescence: { ...DEFAULT_QUIESCENCE, ...options.quiescence },
      childEnv,
      restartServer,
      advanceDays: async (days: number): Promise<Date> => {
        await state.server.stop();
        try {
          state.boxTime = await advanceDays({
            days,
            from: state.boxTime,
            packageRoot: box.packageRoot,
            env: childEnv(),
          });
          result.boxTimeEnd = state.boxTime.toISOString();
        } finally {
          // Restart even when the day's maintenance failed: leaving the run
          // without a server would turn one bad wakeup into a dead run.
          state.server = await startAgain();
        }
        emit(`advanced ${String(days)} day(s) to ${state.boxTime.toISOString()}`);
        return state.boxTime;
      },
      event: (message: string) => {
        result.events.push(message);
        emit(message);
      },
    };

    let previousTag = BASELINE_TAG;
    for (const [index, item] of scenario.checklist.entries()) {
      emit(`item ${String(index + 1)}/${String(scenario.checklist.length)}: ${item.id}`);
      let itemResult: ItemResult;
      try {
        itemResult = await runChecklistItem({
          ctx,
          item,
          index,
          total: scenario.checklist.length,
          previousTag,
        });
      } catch (e) {
        // The operator session died, or something equally structural. Record
        // where and stop: there is no persona left to run the rest.
        result.aborted = { itemId: item.id, reason: errorMessage(e) };
        emit(`aborted at ${item.id}: ${result.aborted.reason}`);
        break;
      }
      result.items.push(itemResult);
      previousTag = checkpointTag({ index, itemId: item.id });
      await writeRunResults(result);
      emit(
        `item ${item.id}: activity ${itemResult.activity.status}, ` +
          `outcome ${itemResult.debrief?.outcome ?? "(no debrief)"}, ` +
          `checks ${String(itemResult.checks.filter((c) => c.passed).length)}/${String(itemResult.checks.length)}`,
      );
    }
  } catch (e) {
    // A failure in setup (prompt write, operator session) or in the loop's own
    // control flow rather than one item. Record it as an abort with no item id
    // (the report renders that as "(setup)") unless something more specific was
    // already recorded, then fall through to teardown.
    if (result.aborted === null) {
      result.aborted = { itemId: null, reason: errorMessage(e) };
      emit(`aborted during setup: ${result.aborted.reason}`);
    }
  } finally {
    result.finishedAt = new Date().toISOString();
    if (operator !== null) {
      await operator.stop().catch((e: unknown) => {
        result.events.push(`operator stop failed: ${errorMessage(e)}`);
      });
    }
    await state.server.stop().catch((e: unknown) => {
      result.events.push(`server stop failed: ${errorMessage(e)}`);
    });
    await closeBrowseSession({ browseCommand, session: browseSession }).catch((e: unknown) => {
      // Nothing about closing a browser may cost the run its results, which are
      // written on the next line.
      result.events.push(`browse session close failed: ${errorMessage(e)}`);
    });
    await writeRunResults(result);
    // A report is written even after an abort: the whole point of writing
    // results.json after every item is that a run that dies at item five
    // still leaves four items' evidence behind, and that evidence is worth
    // nothing to a weekly triage read if it never becomes a report.
    await writeFieldReport(result);
    emit(`run finished; results in ${path.join(runDir, "results.json")}, report in ${path.join(runDir, "report.md")}`);
  }

  return result;
}
