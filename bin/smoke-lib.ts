/**
 * The smoke run log: one JSON line per run, folded into the per-step report
 * that says which steps are paying for themselves.
 *
 * Pure — no fs, no network, no child processes — so every verdict here is unit
 * tested (bin/smoke-lib.test.ts) instead of being reachable only by breaking a
 * real box on purpose. bin/smoke.ts and bin/smoke-harness.ts own the reading
 * and appending; the router-response verdicts live in bin/smoke-probe.ts, the
 * snapshot readers in bin/smoke-snapshot.ts, and the failures in
 * bin/smoke-errors.ts.
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

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
  } catch (_e) {
    /* ignore: a truncated line from a killed run is not a record, by design */
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
  const sorted = values.toSorted((a, b) => a - b);
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
