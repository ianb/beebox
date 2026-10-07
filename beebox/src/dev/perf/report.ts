/**
 * Result files and text reports for `pnpm perf:load` and `pnpm perf:compare`.
 *
 * A result file holds every run of one invocation plus the conditions it ran
 * under, so two files can be compared later (`compare-cli.ts`). Files live in
 * `~/.cache/beebox/perf/results/`, outside the repository: request paths are
 * query-stripped, but a production run still names a real box.
 */
import { FIRST_LOAD_MARKS } from "../../shared/first-load-marks.js";
import { z } from "zod";

const requestTimingSchema = z.object({
  path: z.string(), type: z.string(), status: z.number().optional(), protocol: z.string().optional(),
  startMs: z.number(), ttfbMs: z.number().optional(), endMs: z.number().optional(), encodedBytes: z.number().optional(),
  encoding: z.string().optional(), fromCache: z.boolean(), failed: z.string().optional(),
});

const serverStartSchema = z.object({
  /** Hub: launch start to child spawned / to readiness probe answered. */
  hub: z.object({ spawnMs: z.number(), readyMs: z.number() }).optional(),
  /** Child `bbx serve`: ms from its process start to the end of each phase. */
  phases: z.array(z.object({ phase: z.string(), atMs: z.number() })).optional(),
});
export type ServerStart = z.infer<typeof serverStartSchema>;

const runRecordSchema = z.object({
  location: z.string(),
  ttfbMs: z.number().optional(), domContentLoadedMs: z.number().optional(), loadMs: z.number().optional(),
  fcpMs: z.number().optional(), lcpMs: z.number().optional(),
  marks: z.record(z.string(), z.number()),
  longTaskCount: z.number(), longTaskMs: z.number(), blockingMs: z.number(),
  networkQuietMs: z.number().optional(), requestCount: z.number(), transferredBytes: z.number(),
  scriptMs: z.number(), layoutMs: z.number(),
  requests: z.array(requestTimingSchema),
  timedOut: z.boolean(),
  documentTtfbMs: z.number().optional(),
  serverStart: serverStartSchema.optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

const resultFileSchema = z.object({
  meta: z.object({
    label: z.string(), at: z.string(), git: z.string(), target: z.string(), url: z.string(),
    profile: z.string(), cpuRate: z.number(), cache: z.string(), boxState: z.string(),
  }),
  runs: z.array(runRecordSchema),
});
export type ResultFile = z.infer<typeof resultFileSchema>;

export function parseResultFile(json: string): ResultFile {
  return resultFileSchema.parse(JSON.parse(json));
}

interface Metric { name: string; unit: "ms" | "KB" | "n"; get: (r: RunRecord) => number | undefined }

const mark = (name: string) => (r: RunRecord): number | undefined => r.marks[name];

/** The rows of a summary, in first-load order. */
export const METRICS: Metric[] = [
  { name: "html ttfb", unit: "ms", get: (r) => r.documentTtfbMs },
  { name: "first paint (fcp)", unit: "ms", get: (r) => r.fcpMs },
  { name: "entry evaluated", unit: "ms", get: mark(FIRST_LOAD_MARKS.entry) },
  { name: "react render", unit: "ms", get: mark(FIRST_LOAD_MARKS.render) },
  { name: "box validated", unit: "ms", get: mark(FIRST_LOAD_MARKS.boxValidated) },
  { name: "shell", unit: "ms", get: mark(FIRST_LOAD_MARKS.shell) },
  { name: "composer", unit: "ms", get: mark(FIRST_LOAD_MARKS.composer) },
  { name: "history", unit: "ms", get: mark(FIRST_LOAD_MARKS.history) },
  { name: "dom: react mounted", unit: "ms", get: mark("dom:mounted") },
  { name: "dom: composer", unit: "ms", get: mark("dom:composer") },
  { name: "lcp", unit: "ms", get: (r) => r.lcpMs },
  { name: "network quiet", unit: "ms", get: (r) => r.networkQuietMs },
  { name: "main-thread script", unit: "ms", get: (r) => r.scriptMs },
  { name: "blocking (>50ms tasks)", unit: "ms", get: (r) => r.blockingMs },
  { name: "box start: hub ready", unit: "ms", get: (r) => r.serverStart?.hub?.readyMs },
  { name: "box start: serve listening", unit: "ms", get: (r) => r.serverStart?.phases?.find((p) => p.phase === "listening")?.atMs },
  { name: "requests", unit: "n", get: (r) => r.requestCount },
  { name: "transferred", unit: "KB", get: (r) => Math.round(r.transferredBytes / 1024) },
];

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export function metricValues(runs: RunRecord[], metric: Metric): number[] {
  return runs.map((r) => metric.get(r)).filter((v): v is number => v !== undefined);
}

const pad = (s: string, n: number): string => s.padStart(n);

export function formatSummary(result: ResultFile): string {
  const { meta, runs } = result;
  const lines = [
    `${meta.label}: ${meta.target} ${meta.url}`,
    `  network=${meta.profile} cpu=${meta.cpuRate}x cache=${meta.cache} box=${meta.boxState} runs=${runs.length} git=${meta.git}`,
    `  ${"metric".padEnd(28)}${pad("median", 9)}${pad("min", 9)}${pad("max", 9)}`,
  ];
  for (const metric of METRICS) {
    const values = metricValues(runs, metric);
    if (values.length === 0) continue;
    const unit = metric.unit === "n" ? "" : metric.unit;
    lines.push(`  ${metric.name.padEnd(28)}${pad(`${median(values)}${unit}`, 9)}${pad(`${Math.min(...values)}`, 9)}${pad(`${Math.max(...values)}`, 9)}`);
  }
  const timedOut = runs.filter((r) => r.timedOut).length;
  if (timedOut > 0) lines.push(`  WARNING: ${timedOut} run(s) never reached the wait mark; their milestones are partial`);
  return lines.join("\n");
}

/** The run whose `history` mark is the median: a representative waterfall. */
export function medianRun(runs: RunRecord[]): RunRecord | undefined {
  const key = (r: RunRecord): number => r.marks[FIRST_LOAD_MARKS.history] ?? r.networkQuietMs ?? 0;
  const sorted = runs.toSorted((a, b) => key(a) - key(b));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function formatWaterfall(run: RunRecord): string {
  const lines = [`  ${"start".padStart(6)}${"ttfb".padStart(7)}${"end".padStart(7)}${"KB".padStart(7)}  type      path`];
  for (const r of run.requests) {
    const kb = r.encodedBytes === undefined ? "" : (r.encodedBytes / 1024).toFixed(r.encodedBytes < 10_240 ? 1 : 0);
    const flags = [r.fromCache ? "cache" : "", r.encoding ?? "", r.failed ?? "", r.status !== undefined && r.status >= 400 ? String(r.status) : ""].filter(Boolean).join(" ");
    const path = r.path.length > 90 ? `${r.path.slice(0, 87)}...` : r.path;
    lines.push(`  ${pad(String(r.startMs), 6)}${pad(String(r.ttfbMs ?? ""), 7)}${pad(String(r.endMs ?? ""), 7)}${pad(kb, 7)}  ${r.type.slice(0, 8).padEnd(8)}  ${path}${flags ? `  [${flags}]` : ""}`);
  }
  const marks = Object.entries(run.marks).toSorted((a, b) => a[1] - b[1]).map(([k, v]) => `${k}=${v}`).join(" ");
  lines.push(`  marks: ${marks}`);
  if (run.serverStart?.phases) lines.push(`  serve phases (ms from process start): ${run.serverStart.phases.map((p) => `${p.phase}=${p.atMs}`).join(" ")}`);
  if (run.serverStart?.hub) lines.push(`  hub launch: spawned=${run.serverStart.hub.spawnMs} ready=${run.serverStart.hub.readyMs}`);
  return lines.join("\n");
}
