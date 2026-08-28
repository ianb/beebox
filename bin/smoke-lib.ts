/**
 * The parts of the smoke tier that are decisions rather than effects: how a
 * pidfile becomes a restart plan, what a router response means, and what an
 * accessibility snapshot has to contain for a step to pass.
 *
 * Pure — no fs, no network, no child processes — so every verdict here is unit
 * tested (bin/smoke-lib.test.ts) instead of being reachable only by breaking a
 * real box on purpose. bin/smoke.ts owns the I/O and calls into this.
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

/** A step that failed, with enough context to act on without re-running. */
export class SmokeFailure extends Error {
  /** The page/HTTP evidence, printed under the message. Empty when there is none. */
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "SmokeFailure";
    this.detail = detail;
  }
}

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
  const message = /<div class="err">([\s\S]*?)<\/div>/.exec(body)?.[1]?.trim() ?? "";
  const blocks = [...body.matchAll(/<pre>([\s\S]*?)<\/pre>/g)]
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
  const status = typeof parsed === "object" && parsed !== null ? (parsed as { status?: unknown }).status : undefined;
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
}): SmokeFailure | null {
  const { verdict, url } = input;
  switch (verdict.kind) {
    case "ok":
      return null;
    case "failed":
      return new SmokeFailure(
        `the box failed to start (router phase: ${verdict.phase}) — ${url}`,
        [verdict.message, verdict.stderr].filter((part) => part !== "").join("\n\n"),
      );
    case "unauthorized":
      return new SmokeFailure(
        `the router refused our credential at ${url}` +
          " — CB_BROWSE_API_KEY is missing or stale in callback-box/.env",
      );
    case "unexpected":
      return new SmokeFailure(
        `${url} answered ${String(verdict.status)}, expected 200`,
        input.body.slice(0, 2000),
      );
    case "not-backend":
      return new SmokeFailure(
        `${url} answered 200 but not with a health payload — the request did not reach the backend`,
        input.body.slice(0, 2000),
      );
    default:
      return neverProbe(verdict);
  }
}

function neverProbe(verdict: never): never {
  throw new Error(`unhandled probe verdict: ${JSON.stringify(verdict)}`);
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
  if (typeof statusJson !== "object" || statusJson === null) return "unknown";
  const worktrees = (statusJson as { worktrees?: unknown }).worktrees;
  if (typeof worktrees !== "object" || worktrees === null) return "unknown";
  const entry = (worktrees as Record<string, unknown>)[name];
  if (typeof entry !== "object" || entry === null) return "unknown";
  const state = (entry as { state?: unknown }).state;
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
  if (typeof statusJson !== "object" || statusJson === null) return null;
  const worktrees = (statusJson as { worktrees?: unknown }).worktrees;
  if (typeof worktrees !== "object" || worktrees === null) return null;
  const entry = (worktrees as Record<string, unknown>)[name];
  if (typeof entry !== "object" || entry === null) return null;
  const startedAt = (entry as { startedAt?: unknown }).startedAt;
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

// ── reading accessibility snapshots ─────────────────────────────────────────

/**
 * A `[ref=eN]` for a role + accessible name in an agent-browser snapshot.
 *
 * Duplicated intent with tour-lib's `findRef`, but not its implementation: this
 * one is given the snapshot text rather than fetching it, which is what makes
 * it testable and lets one snapshot answer several questions without a second
 * browser round-trip (the tier's whole time budget is round-trips).
 */
export function refFor(snapshot: string, role: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${role}\\s+"${escaped}"\\s+\\[(?:[^\\]]*?,\\s*)?ref=(e\\d+)`);
  return pattern.exec(snapshot)?.[1] ?? null;
}

/** Every `menuitem "…"` name in a snapshot, in document order. */
export function menuItemNames(snapshot: string): string[] {
  return [...snapshot.matchAll(/\bmenuitem\s+"([^"]*)"/g)].map((m) => m[1] ?? "");
}

/** Is the element carrying this DOM id expanded? Null when it is not present. */
export function expandedState(snapshot: string, domId: string): boolean | null {
  const line = snapshot
    .split("\n")
    .find((candidate) => candidate.includes(`id=${domId}`));
  if (line === undefined) return null;
  return /\bexpanded=true\b/.test(line);
}

/**
 * The place menu's fixed rows (bin-independent: they carry stable DOM ids in
 * PlacePill-panels.tsx). Landmark rows are everything else, and "at least one
 * landmark row" is the assertion that the menu's data actually resolved.
 */
const FIXED_MENU_IDS = [
  "cb-switch-menu-box",
  "cb-switch-menu-landmarks",
  "cb-switch-menu-recent-files",
];

/** The exact copy the menu shows when its landmark query failed (Retry row). */
export const MENU_ERROR_TEXT = "Couldn’t load this menu";

export interface PlaceMenuReading {
  expanded: boolean;
  fixedRowsPresent: boolean;
  landmarkNames: string[];
  errored: boolean;
}

export function readPlaceMenu(snapshot: string): PlaceMenuReading {
  const fixedNames = new Set(
    FIXED_MENU_IDS.map((id) => nameForId(snapshot, id)).filter(
      (name): name is string => name !== null,
    ),
  );
  return {
    expanded: expandedState(snapshot, "cb-nav-place") === true,
    fixedRowsPresent: fixedNames.size === FIXED_MENU_IDS.length,
    landmarkNames: menuItemNames(snapshot).filter((name) => !fixedNames.has(name)),
    // The apostrophe is a typographic one in the JSX and renders as such;
    // accept the ASCII spelling too rather than let a copy edit blind us.
    errored:
      snapshot.includes(MENU_ERROR_TEXT) || snapshot.includes("Couldn't load this menu"),
  };
}

function nameForId(snapshot: string, domId: string): string | null {
  const line = snapshot.split("\n").find((candidate) => candidate.includes(`id=${domId}`));
  if (line === undefined) return null;
  return /"([^"]*)"/.exec(line)?.[1] ?? null;
}

/** The failure the place-menu reading deserves; null when it passed. */
export function placeMenuFailure(reading: PlaceMenuReading, snapshot: string): SmokeFailure | null {
  if (reading.errored) {
    return new SmokeFailure(
      "the place menu opened but could not load its landmarks" +
        " — the menu is showing its error row, not a list",
      snapshot,
    );
  }
  if (!reading.expanded) {
    return new SmokeFailure(
      "clicking the place pill did not open the menu (#cb-nav-place is still collapsed)",
      snapshot,
    );
  }
  if (!reading.fixedRowsPresent) {
    return new SmokeFailure("the place menu is missing its fixed rows", snapshot);
  }
  if (reading.landmarkNames.length === 0) {
    return new SmokeFailure(
      "the place menu lists no landmarks — the box has none, or the query returned empty",
      snapshot,
    );
  }
  return null;
}

/**
 * The landmark the place pill currently names, or null if it is not rendered.
 *
 * The pill's accessible name is `Place: <label>` (PlacePill.tsx), and that
 * label is the user-visible answer to "where am I" — which makes it the thing
 * to assert a switch against.
 */
export function currentPlaceLabel(snapshot: string): string | null {
  const line = snapshot.split("\n").find((candidate) => candidate.includes("id=cb-nav-place"));
  if (line === undefined) return null;
  return /"Place:\s*([^"]*)"/.exec(line)?.[1]?.trim() ?? null;
}

/**
 * A landmark worth switching TO — the first one the menu lists that is not
 * where we already are.
 *
 * Switching to the place you are already in asserts nothing: the pill would
 * read the same afterwards whether or not the navigation worked.
 */
export function switchTarget(input: {
  landmarks: readonly string[];
  current: string | null;
}): string | null {
  return input.landmarks.find((name) => name !== input.current) ?? null;
}

/**
 * Did selecting a landmark actually take us there?
 *
 * Asserts the consequence, never the click: `bin/browse click` dispatches a
 * mouse event at the element's box centre and reports success whether or not
 * anything happened (issues/closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md).
 *
 * Both conditions matter and they fail differently. The pill still naming the
 * old place is the 2026-08-20 bug's shape — the menu worked, the selection did
 * not move you. An unchanged URL is a click that never navigated at all.
 */
export function placeSwitchFailure(input: {
  target: string;
  urlBefore: string;
  urlAfter: string;
  labelAfter: string | null;
  snapshot: string;
}): SmokeFailure | null {
  if (input.urlAfter === input.urlBefore) {
    return new SmokeFailure(
      `selecting the landmark "${input.target}" did not navigate — the URL is unchanged (${input.urlAfter})`,
      input.snapshot,
    );
  }
  if (input.labelAfter !== input.target) {
    return new SmokeFailure(
      `selected the landmark "${input.target}" and the page moved, but the place pill still names` +
        ` "${input.labelAfter ?? "nothing"}" — the switch did not take`,
      input.snapshot,
    );
  }
  return null;
}

/** Does the snapshot contain an element carrying this DOM id? */
export function hasDomId(snapshot: string, domId: string): boolean {
  return snapshot.includes(`id=${domId}`);
}

/**
 * Directory rows in the browse sidebar, which the box's real content produces
 * (`button "store directory, 46 items"`). Counting them is how this tier
 * checks that a card read reached the browser: an empty list is what a backend
 * that answered but returned nothing looks like.
 */
export function directoryRowCount(snapshot: string): number {
  return [...snapshot.matchAll(/\bbutton\s+"[^"]* directory(?:,[^"]*)?"/g)].length;
}

/**
 * Did the card detail pane actually render the card, or just its frame?
 *
 * The open-card link exists as soon as the pane mounts, so asserting on it
 * alone passes for a card whose body failed to load. A rendered card also
 * carries its own title as a heading.
 */
export function cardViewRendered(snapshot: string): boolean {
  return /\bheading\s+"[^"]+"\s+\[level=2/.test(snapshot);
}

/** The first card row in the browse sidebar, as a role + name pair to click. */
export function firstCardRow(snapshot: string): { role: "button"; name: string } | null {
  const match = /\bbutton\s+"([^"]* card)"\s+\[/.exec(snapshot);
  const name = match?.[1];
  return name === undefined ? null : { role: "button", name };
}

// ── the run log ─────────────────────────────────────────────────────────────

/**
 * One step's outcome in one run.
 *
 * `not-run` is recorded, not omitted: the walk stops at the first failure, so a
 * step late in the walk has a smaller denominator than an early one. Dropping
 * those rows would make a late step look like it had passed every run it never
 * saw — the exact reading that would get it trimmed for "never failing".
 */
export interface SmokeStepRecord {
  id: string;
  outcome: "ok" | "fail" | "not-run";
  ms: number;
}

/** One run, appended as a line to the shared log. */
export interface SmokeRunRecord {
  ts: string;
  commit: string;
  branch: string;
  worktree: string;
  box: string;
  verdict: "green" | "red";
  ms: number;
  /** The step that failed, when one did. */
  failedStep?: string;
  /** Its message, first line only — the log is a tally, not an error store. */
  failure?: string;
  /**
   * Why this run was deliberately broken, when it was (`CB_SMOKE_FAULT_INJECTION`).
   *
   * Proving the tier can go red means breaking something on purpose, and the
   * resulting red is indistinguishable in the log from one the tier caught in
   * the wild. The first weekly review read exactly such a run as "restart
   * contention worth a second look if it recurs" — a real conclusion drawn from
   * a manufactured failure. A run that says why it was broken cannot be
   * misread; one that stays silent will be, every week, forever.
   */
  faultInjected?: string;
  steps: SmokeStepRecord[];
}

/**
 * The log lives beside the test ledger, in the shared git dir, for the same
 * reasons: every worktree on the machine is answering questions about the same
 * tier, and a worktree cull must not take the history with it. Append-only, so
 * two runs in different worktrees cannot lose each other's entries.
 */
/**
 * One log line as a record, or null if it is not one.
 *
 * The single parse boundary for the log: readers get a validated record and
 * never a cast. A line that does not parse (a run killed mid-append leaves a
 * truncated one) is null rather than an exception — a partial write must not
 * take a whole report with it.
 */
export function parseRunRecord(line: string): SmokeRunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  const { ts, verdict, steps } = record;
  if (typeof ts !== "string") return null;
  if (verdict !== "green" && verdict !== "red") return null;
  if (!Array.isArray(steps)) return null;
  return {
    ts,
    verdict,
    commit: typeof record["commit"] === "string" ? record["commit"] : "",
    branch: typeof record["branch"] === "string" ? record["branch"] : "",
    worktree: typeof record["worktree"] === "string" ? record["worktree"] : "",
    box: typeof record["box"] === "string" ? record["box"] : "",
    ms: typeof record["ms"] === "number" ? record["ms"] : 0,
    ...(typeof record["failedStep"] === "string" ? { failedStep: record["failedStep"] } : {}),
    ...(typeof record["failure"] === "string" ? { failure: record["failure"] } : {}),
    ...(typeof record["faultInjected"] === "string" && record["faultInjected"] !== ""
      ? { faultInjected: record["faultInjected"] }
      : {}),
    steps: steps.filter(isStepRecord),
  };
}

function isStepRecord(value: unknown): value is SmokeStepRecord {
  if (typeof value !== "object" || value === null) return false;
  const step: Record<string, unknown> = { ...value };
  const outcome = step["outcome"];
  return (
    typeof step["id"] === "string" &&
    (outcome === "ok" || outcome === "fail" || outcome === "not-run") &&
    typeof step["ms"] === "number"
  );
}

export function smokeLogPath(gitCommonDir: string): string {
  return `${gitCommonDir}/callback-smoke-log.jsonl`;
}

export interface StepStats {
  id: string;
  /** Runs in which this step executed, fault injections excluded. */
  ran: number;
  /** Failures in the wild — what the step has actually caught. */
  failed: number;
  /**
   * Failures under deliberate fault injection.
   *
   * Kept apart from {@link StepStats.failed} rather than added to it, because
   * the two answer different questions. An injected failure proves the step is
   * wired up and can fire; only a real one proves it catches anything. Folding
   * them together would let a step that has only ever fired on demand look like
   * it is earning its place.
   */
  injected: number;
  /** Median duration over the runs it executed, in seconds. */
  medianSeconds: number;
  /** ISO timestamp of the most recent failure, or null if it has never failed. */
  lastFailure: string | null;
}

export interface SmokeSummary {
  /** Runs in the wild. Fault injections are not a sample of anything. */
  runs: number;
  red: number;
  /** Deliberately broken runs, excluded from every rate above. */
  injectedRuns: number;
  steps: StepStats[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Fold the log into per-step counts.
 *
 * Steps are keyed by their stable `id`, never by the human-facing name — names
 * get reworded and a rename must not silently restart a step's history at zero,
 * which would read as "new step, no data yet" rather than "unchanged step, 200
 * clean runs". Order follows first appearance, so the report reads in walk
 * order. {@link parseRunRecord} drops anything that is not a record.
 */
export function summarizeSmokeLog(lines: readonly string[]): SmokeSummary {
  const order: string[] = [];
  const ran = new Map<string, number[]>();
  const failed = new Map<string, number>();
  const injected = new Map<string, number>();
  const lastFailure = new Map<string, string>();
  let runs = 0;
  let red = 0;
  let injectedRuns = 0;

  for (const line of lines) {
    const record = parseRunRecord(line);
    if (record === null) continue;
    // A deliberately broken run measures the tier, not the app. It is counted,
    // and then kept out of every rate — its duration is a timeout, its failure
    // was ordered, and its later steps never ran for a reason that says nothing
    // about them.
    const wasInjected = record.faultInjected !== undefined;
    if (wasInjected) injectedRuns += 1;
    else {
      runs += 1;
      if (record.verdict === "red") red += 1;
    }
    for (const step of record.steps) {
      if (!ran.has(step.id)) {
        ran.set(step.id, []);
        order.push(step.id);
      }
      if (step.outcome === "not-run") continue;
      if (wasInjected) {
        if (step.outcome === "fail") injected.set(step.id, (injected.get(step.id) ?? 0) + 1);
        continue;
      }
      ran.get(step.id)?.push(step.ms);
      if (step.outcome === "fail") {
        failed.set(step.id, (failed.get(step.id) ?? 0) + 1);
        lastFailure.set(step.id, record.ts);
      }
    }
  }

  return {
    runs,
    red,
    injectedRuns,
    steps: order.map((id) => ({
      id,
      ran: ran.get(id)?.length ?? 0,
      failed: failed.get(id) ?? 0,
      injected: injected.get(id) ?? 0,
      medianSeconds: Math.round(median(ran.get(id) ?? []) / 100) / 10,
      lastFailure: lastFailure.get(id) ?? null,
    })),
  };
}

/**
 * How many runs a step must have survived before "it never fails" is evidence
 * rather than noise. Below this the report shows the counts and says nothing
 * about trimming — after one green run every step has a spotless record.
 */
export const TRIM_EVIDENCE_RUNS = 20;

/**
 * The report, written to answer one question: which steps are paying for
 * themselves.
 *
 * It prints what a step COSTS next to how often it has caught something,
 * because that is the trade — a step that has never failed in 200 runs and
 * takes 5s is a different call from one that has never failed and takes 0.4s.
 */
export function formatSmokeReport(summary: SmokeSummary): string {
  if (summary.runs === 0 && summary.injectedRuns === 0) {
    return "smoke: no runs logged yet.\n";
  }
  const forced =
    summary.injectedRuns === 0
      ? ""
      : ` ${String(summary.injectedRuns)} fault-injected run${summary.injectedRuns === 1 ? "" : "s"}` +
        " excluded from every count below.";
  const lines = [
    `smoke: ${String(summary.runs)} run${summary.runs === 1 ? "" : "s"} logged,` +
      ` ${String(summary.red)} red.${forced}`,
    "",
    `${"step".padEnd(14)}${"ran".padStart(6)}${"failed".padStart(8)}${"forced".padStart(8)}` +
      `${"p50".padStart(8)}   last failure`,
  ];
  for (const step of summary.steps) {
    const never = step.ran === 0 ? "never ran" : "never failed";
    lines.push(
      step.id.padEnd(14) +
        String(step.ran).padStart(6) +
        String(step.failed).padStart(8) +
        String(step.injected).padStart(8) +
        `${step.medianSeconds.toFixed(1)}s`.padStart(8) +
        `   ${step.lastFailure ?? never}`,
    );
  }
  const idle = summary.steps.filter(
    (step) => step.failed === 0 && step.ran >= TRIM_EVIDENCE_RUNS,
  );
  if (idle.length > 0) {
    const seconds = idle.reduce((sum, step) => sum + step.medianSeconds, 0);
    lines.push(
      "",
      `Never caught anything in ${String(TRIM_EVIDENCE_RUNS)}+ runs, costing` +
        ` ${seconds.toFixed(1)}s of every walk: ${idle.map((step) => step.id).join(", ")}.`,
      "Read `ran`, not the run count, as the denominator — the walk stops at the",
      "first failure, so a late step has seen fewer runs than an early one.",
      "`forced` is failures under deliberate fault injection: it proves the step",
      "can fire, never that it has caught anything.",
    );
  }
  return `${lines.join("\n")}\n`;
}
