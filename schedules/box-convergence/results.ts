import { z } from "zod";

const resultSchema = z.object({
  status: z.enum(["status", "current", "applied", "attention", "deferred", "no-manifest", "deferred-repair", "needs-procedure", "failed", "commit-failed"]),
  holders: z.array(z.object({ pid: z.number(), reason: z.string(), since: z.string() })).optional(),
  pending: z.array(z.string()).optional(), questions: z.array(z.string()).optional(),
  manifest: z.boolean().optional(), failed: z.string().optional(),
  procedure: z.string().optional(), recoveryRef: z.string().optional(),
  question: z.string().optional(), error: z.string().optional(), sessionId: z.string().optional(),
  applied: z.array(z.object({ name: z.string(), partial: z.boolean(), question: z.string().optional(), sessionId: z.string().optional() })).optional(),
});
export const RESULT_PREFIX = "BBX_CONVERGENCE_RESULT ";
/** A box may defer to its own live work for this long before the deferral is reported. */
const DEFERRAL_REPORT_MS = 24 * 60 * 60_000;

/** `--status --json` (dry run): quiet only for a seeded manifest with nothing pending or asked. */
function statusDetail(result: z.infer<typeof resultSchema>, exitCode: number | null): string | null {
  if (result.manifest === undefined || !result.pending || !result.questions) return "Incomplete migration status";
  if (exitCode !== 0) return `Status command failed (exit ${String(exitCode)})`;
  if (result.manifest && result.pending.length === 0 && result.questions.length === 0) return null;
  return `manifest=${String(result.manifest)}; pending: ${result.pending.join(", ") || "none"}; questions: ${result.questions.join(", ") || "none"}`;
}

/** A deferral is routine until the same box has held work for a day. */
function deferredDetail(holders: { pid: number; reason: string; since: string }[] | undefined, exitCode: number | null): string | null {
  if (!holders || exitCode !== 0) return `Incomplete deferred result (exit ${String(exitCode)})`;
  const heldMs = Date.now() - Math.min(...holders.map((holder) => Date.parse(holder.since)));
  if (!(heldMs >= DEFERRAL_REPORT_MS)) return null;
  const held = holders.map((holder) => `${holder.reason} (pid ${String(holder.pid)}, since ${holder.since})`).join(", ");
  return `deferred; the box has held work for ${String(Math.round(heldMs / 3_600_000))}h: ${held}`;
}

/** Diagnostics precede the final framed stdout JSON. Invalid output is unknown. */
export function resultDetail(output: string, exitCode: number | null): string | null {
  const line = output.trimEnd().split("\n").at(-1);
  if (!line?.startsWith(RESULT_PREFIX)) return `Unknown result (exit ${String(exitCode)}): ${output.slice(-1500)}`;
  let result: z.infer<typeof resultSchema>;
  try { result = resultSchema.parse(JSON.parse(line.slice(RESULT_PREFIX.length))); }
  catch (error) { return `Invalid convergence JSON: ${String(error).slice(0, 500)}`; }
  if (result.status === "status") return statusDetail(result, exitCode);
  if (result.status === "deferred") return deferredDetail(result.holders, exitCode);
  const partial = result.applied?.filter((entry) => entry.partial) ?? [];
  if (partial.length > 0) return `Partial conversion: ${partial.map((entry) => [entry.name, entry.question, entry.sessionId].filter(Boolean).join("; ")).join(", ")}`;
  if (result.status === "applied" && !result.applied) return "Incomplete applied result";
  if ((result.status === "current" || result.status === "applied") && exitCode === 0 && !result.questions?.length) return null;
  return [result.status, result.failed, result.procedure, result.error, result.recoveryRef,
    result.question, result.sessionId, ...(result.questions ?? []), `exit ${String(exitCode)}`].filter(Boolean).join("; ");
}

// ssh exits 255 for its own failures. Only a failure to reach the host means the
// machine is offline; "Connection refused" means the host answered, so it is real.
const SSH_UNREACHABLE = /^ssh: (?:connect to host \S+ port \d+: (?:Network is unreachable|No route to host|Operation timed out|Connection timed out)|Could not resolve hostname \S+: .+)$/mu;
/** Unreachable production is routine (this laptop is offline) until it lasts this long. */
const UNREACHABLE_REPORT_MS = 24 * 60 * 60_000;

/** The ssh diagnostic line when the server was never reached, else null. */
export function sshUnreachable(exitCode: number | null, output: string): string | null {
  return exitCode === 255 ? (SSH_UNREACHABLE.exec(output)?.[0] ?? null) : null;
}

/** Quiet while production has been unreachable for less than a day. */
export function unreachableDetail(since: number, opts: { now: number; line: string }): string | null {
  const elapsed = opts.now - since;
  return elapsed < UNREACHABLE_REPORT_MS ? null : `Production unreachable for ${String(Math.round(elapsed / 3_600_000))}h: ${opts.line}`;
}

export interface ConvergenceAlert {
  condition: "unconverged" | "prod-unreachable";
  title: string;
  message: string;
}

/**
 * What a run reports, as standing conditions the alert store updates in
 * place. The keys never include the finding text: the set of boxes that need
 * work changes run to run (and prod lines drop out whenever the laptop is
 * offline), and a key built from it made every change a new alert — ten open
 * for one `needs-procedure` condition in two days.
 *
 * `keep` is every condition that stays open; the run resolves the rest. A run
 * that could not reach production has not checked the prod boxes, so it keeps
 * `unconverged` open even when every local box is clean.
 */
export function reportPlan(input: {
  findings: readonly string[];
  unreachableDetail: string | null;
  prodChecked: boolean;
}): { alerts: ConvergenceAlert[]; keep: string[] } {
  const alerts: ConvergenceAlert[] = [];
  if (input.findings.length > 0) {
    alerts.push({
      condition: "unconverged",
      title: `Box convergence: ${String(input.findings.length)} finding${input.findings.length === 1 ? "" : "s"}`,
      message: input.findings.map((finding) => `- ${finding}`).join("\n"),
    });
  }
  if (input.unreachableDetail !== null) {
    alerts.push({ condition: "prod-unreachable", title: "Box convergence: production unreachable", message: input.unreachableDetail });
  }
  const keep = alerts.map((alert) => alert.condition);
  if (!input.prodChecked && !keep.includes("unconverged")) keep.push("unconverged");
  return { alerts, keep };
}

/** Shell arguments are data, including paths read from the remote registry. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function framedCommand(command: string): string {
  return `result=$(${command}); code=$?\nprintf '%s%s\\n' ${shellQuote(RESULT_PREFIX)} "$result"\nexit "$code"`;
}
