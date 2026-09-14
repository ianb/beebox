import { z } from "zod";

const resultSchema = z.object({
  status: z.enum(["status", "current", "applied", "attention", "no-manifest", "deferred-repair", "needs-procedure", "failed", "commit-failed"]),
  pending: z.array(z.string()).optional(), questions: z.array(z.string()).optional(),
  manifest: z.boolean().optional(), failed: z.string().optional(),
  procedure: z.string().optional(), recoveryRef: z.string().optional(),
  question: z.string().optional(), error: z.string().optional(), sessionId: z.string().optional(),
  applied: z.array(z.object({ name: z.string(), partial: z.boolean(), question: z.string().optional(), sessionId: z.string().optional() })).optional(),
});
export const RESULT_PREFIX = "BBX_CONVERGENCE_RESULT ";

/** Diagnostics precede the final framed stdout JSON. Invalid output is unknown. */
export function resultDetail(output: string, exitCode: number | null): string | null {
  const line = output.trimEnd().split("\n").at(-1);
  if (!line?.startsWith(RESULT_PREFIX)) return `Unknown result (exit ${String(exitCode)}): ${output.slice(-1500)}`;
  let result: z.infer<typeof resultSchema>;
  try { result = resultSchema.parse(JSON.parse(line.slice(RESULT_PREFIX.length))); }
  catch (error) { return `Invalid convergence JSON: ${String(error).slice(0, 500)}`; }
  if (result.status === "status") {
    if (result.manifest === undefined || !result.pending || !result.questions) return "Incomplete migration status";
    if (exitCode !== 0) return `Status command failed (exit ${String(exitCode)})`;
    if (result.manifest && result.pending.length === 0 && result.questions.length === 0) return null;
    return `manifest=${String(result.manifest)}; pending: ${result.pending.join(", ") || "none"}; questions: ${result.questions.join(", ") || "none"}`;
  }
  const partial = result.applied?.filter((entry) => entry.partial) ?? [];
  if (partial.length > 0) return `Partial conversion: ${partial.map((entry) => [entry.name, entry.question, entry.sessionId].filter(Boolean).join("; ")).join(", ")}`;
  if (result.status === "applied" && !result.applied) return "Incomplete applied result";
  if ((result.status === "current" || result.status === "applied") && exitCode === 0 && !result.questions?.length) return null;
  return [result.status, result.failed, result.procedure, result.error, result.recoveryRef,
    result.question, result.sessionId, ...(result.questions ?? []), `exit ${String(exitCode)}`].filter(Boolean).join("; ");
}

/** Shell arguments are data, including paths read from the remote registry. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function framedCommand(command: string): string {
  return `result=$(${command}); code=$?\nprintf '%s%s\\n' ${shellQuote(RESULT_PREFIX)} "$result"\nexit "$code"`;
}
