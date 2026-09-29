/** Versioned, Git-backed snapshots. Evaluated inputs are immutable after creation. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { evidenceSchema, type Evidence } from "../evidence/core.js";
import { instructionSnapshotSchema, type InstructionSnapshot } from "../snapshot.js";
import { type TriageJudgment, triageJudgmentSchema } from "../judge.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path/core.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { withFileLock } from "../../../lib/file-lock.js";

export class TriageReceiptError extends Error {
  constructor({ detail }: { detail: string }) { super(`Triage receipt: ${detail}`); this.name = "TriageReceiptError"; }
}
export const outcomeAssertionSchema = z.object({ label: z.string(), actor: z.enum(["user", "agent", "unknown"]), sourceRef: z.string(), at: z.string() });
export const decisionReceiptSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), at: z.string(),
  evidence: evidenceSchema, instructions: instructionSnapshotSchema, judgment: triageJudgmentSchema,
  originalDecisionId: z.string().uuid().optional(),
  application: z.object({ state: z.enum(["pending", "applied", "incomplete"]), from: z.string(), to: z.string(), questionRef: z.string().optional(), error: z.string().optional() }),
  outcomes: z.array(outcomeAssertionSchema),
  resolution: z.object({ destinationRef: z.string(), sourceRef: z.string(), actor: z.enum(["user", "agent", "unknown"]) }).optional(),
  provenanceRepair: z.object({ observedCommit: z.string(), at: z.string() }).optional(),
});
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;

export async function withDecisionReceiptLock<T>(opts: { boxRoot: string; id: string; fn: () => Promise<T> }): Promise<T> {
  const { boxRoot, id, fn } = opts;
  const lockPath = path.join(boxRoot, ".beebox/locks", `triage-receipt-${z.string().uuid().parse(id)}`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return withFileLock({ lockPath, metadata: { decision: id }, waitMs: 10_000 }, fn);
}

export function receiptRef(id: string): string {
  return `/_bookkeeping/triage/decisions/${z.string().uuid().parse(id)}.json`;
}
export function containedPath(boxRoot: string, ref: string): string {
  const parsed = parseRef(ref);
  if (parsed.fragment || parsed.query) throw new TriageReceiptError({ detail: `Expected a file ref: ${ref}` });
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "write-target" });
  if (!resolved) throw new TriageReceiptError({ detail: `Invalid box ref: ${ref}` });
  return path.join(boxRoot, resolved);
}
export async function assertContained(boxRoot: string, file: string): Promise<void> {
  const root = await fs.realpath(boxRoot);
  let ancestor = file;
  for (;;) {
    try {
      const actual = await fs.realpath(ancestor);
      const rel = path.relative(root, actual);
      if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) throw new TriageReceiptError({ detail: "Ref resolves through a symlink outside the box" });
      return;
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      // A write target need not exist; validate its nearest existing parent.
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}
export function receiptFingerprint(receipt: DecisionReceipt): string {
  return createHash("sha256").update(JSON.stringify({ id: receipt.id, at: receipt.at, evidence: receipt.evidence, instructions: receipt.instructions, judgment: receipt.judgment, resolution: receipt.resolution, originalDecisionId: receipt.originalDecisionId })).digest("hex");
}
export function createDecisionReceipt(opts: { boxRoot: string; evidence: Evidence; instructions: InstructionSnapshot; judgment: TriageJudgment; originalDecisionId?: string }): DecisionReceipt {
  const id = randomUUID();
  const destination = opts.instructions.destinations.find((d) => d.ref === opts.judgment.destinationRef);
  if (opts.judgment.outcome === "destination" && !destination) throw new TriageReceiptError({ detail: "Judgment destination is absent from its instruction snapshot" });
  const category = destination?.name ?? "_unsure";
  if (!/^[\w.-]+$/.test(category) || category === "." || category === "..") throw new TriageReceiptError({ detail: "Unsafe category name" });
  return decisionReceiptSchema.parse({ version: 1, id, at: getBoxTimeISO(opts.boxRoot), evidence: opts.evidence, instructions: opts.instructions, judgment: opts.judgment, originalDecisionId: opts.originalDecisionId, application: { state: "pending", from: opts.evidence.source.ref, to: `/_content/inbox/triaged/${category}/${path.basename(opts.evidence.source.ref)}`, ...(!destination ? { questionRef: `/_bookkeeping/questions/Triage_${id}.question.card` } : {}) }, outcomes: [] });
}
export async function readDecisionReceipt(boxRoot: string, id: string): Promise<DecisionReceipt> {
  const file = containedPath(boxRoot, receiptRef(id));
  await assertContained(boxRoot, file);
  const receipt = decisionReceiptSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  if (receipt.id !== id) throw new TriageReceiptError({ detail: "Receipt ID does not match its filename" });
  return receipt;
}
export async function saveDecisionReceipt(boxRoot: string, receipt: DecisionReceipt): Promise<void> {
  const parsed = decisionReceiptSchema.parse(receipt);
  const file = containedPath(boxRoot, receiptRef(parsed.id));
  await assertContained(boxRoot, file);
  try {
    const existing = await readDecisionReceipt(boxRoot, parsed.id);
    if (receiptFingerprint(existing) !== receiptFingerprint(parsed)) throw new TriageReceiptError({ detail: "Evaluated receipt inputs are immutable; create a new decision" });
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    // A first application creates the receipt before moving anything.
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, { content: `${JSON.stringify(parsed, null, 2)}\n` });
}
async function findUnavailableSources(boxRoot: string, receipt: DecisionReceipt): Promise<string[]> {
  const unavailableSources: string[] = [];
  for (const part of receipt.evidence.parts) {
    const oldAttach = receipt.evidence.source.attachmentRef;
    const mapped = part.ref === receipt.evidence.source.ref ? receipt.application.to : oldAttach ? part.ref.replace(`${oldAttach}/`, `${attachDirFor(receipt.application.to)}/`) : part.ref;
    let available = false;
    for (const ref of [part.ref, mapped]) {
    try { await fs.access(containedPath(boxRoot, ref)); available = true; break; }
    catch (error) { if (errnoCode(error) !== "ENOENT") throw error; /* Try the applied location next. */ }
    }
    if (!available) unavailableSources.push(part.ref);
  }
  return unavailableSources;
}
export async function listDecisionReceipts(boxRoot: string, filters?: { destination?: string; instructionRef?: string; outcome?: "user-confirmed" | "agent-asserted" | "corrected" | "unknown" }): Promise<Array<DecisionReceipt & { unavailableSources: string[] }>> {
  const dir = path.join(boxRoot, "_bookkeeping/triage/decisions");
  let entries: string[];
  try { entries = await fs.readdir(dir); } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    return []; // No decisions have been applied in this box yet.
  }
  const receipts: Array<DecisionReceipt & { unavailableSources: string[] }> = [];
  for (const entry of entries.toSorted()) {
    if (!entry.endsWith(".json")) continue;
    const receipt = await readDecisionReceipt(boxRoot, entry.slice(0, -5));
    if (filters?.instructionRef && !receipt.instructions.sources.some((s) => s.ref === filters.instructionRef)) continue;
    if (filters?.destination && (receipt.resolution?.destinationRef ?? receipt.judgment.destinationRef) !== filters.destination) continue;
    if (filters?.outcome === "corrected" && !receipt.originalDecisionId) continue;
    const actor = filters?.outcome === "user-confirmed" ? "user" : filters?.outcome === "agent-asserted" ? "agent" : filters?.outcome === "unknown" ? "unknown" : undefined;
    if (actor && !receipt.outcomes.some((o) => o.actor === actor)) continue;
    const unavailableSources = await findUnavailableSources(boxRoot, receipt);
    receipts.push({ ...receipt, unavailableSources });
  }
  return receipts;
}
