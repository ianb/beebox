/** Immutable declaration + durable receipt; per-ID locking arbitrates processes. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { withFileLock } from "../../lib/file-lock.js";
import { readJsonIfPresent } from "../../lib/json-state.js";
import { errnoCode } from "../../shared/error-guards.js";
import { quickCaptureDeclarationSchema, quickCaptureDeclarationFieldsSchema, QUICK_CAPTURE_STATES, type QuickCaptureDeclaration } from "../../shared/quick-capture.js";
import { invariant } from "../../shared/invariant.js";

const captureRecordSchema = z.object({
  id: z.string().uuid(), owner: z.string().nullable(), digest: z.string(),
  declaration: quickCaptureDeclarationFieldsSchema.partial({ source: true }), acceptedAt: z.string(),
  state: z.enum(QUICK_CAPTURE_STATES), sourceRef: z.string().optional(),
  sourceCommitted: z.boolean().optional(), transcript: z.string().optional(),
  transcriptionTerminal: z.boolean().optional(),
  transcriptionLanguage: z.string().optional(), transcriptionAttemptedAt: z.string().optional(),
  error: z.string().optional(), attempts: z.number().int().nonnegative().default(0),
  discardedBeforeAcceptance: z.boolean().optional(),
  nextAttemptAt: z.string().optional(), blockedByGone: z.boolean().optional(),
  filingRequested: z.literal(true).optional(), filingKicks: z.number().int().nonnegative().optional(), filingKickAt: z.string().optional(),
}).superRefine((record, ctx) => {
  if (record.state !== "gone" && !quickCaptureDeclarationSchema.safeParse(record.declaration).success) {
    ctx.addIssue({ code: "custom", message: "A live capture needs its complete declaration." });
  }
});
export type CaptureRecord = z.infer<typeof captureRecordSchema>;
export class QuickCaptureError extends Error {
  readonly reason: keyof typeof CAPTURE_FAILURES;
  readonly code: "invalid" | "conflict" | "forbidden" | "not-found" | "gone";
  constructor(args: { reason: keyof typeof CAPTURE_FAILURES }) {
    const failure = CAPTURE_FAILURES[args.reason];
    super(failure.message); this.name = "QuickCaptureError"; this.code = failure.code; this.reason = args.reason;
  }
}
export function captureDirectory(boxRoot: string, id: string): string {
  invariant(z.string().uuid().safeParse(id).success, "Capture ids must be UUIDs");
  return path.join(boxRoot, ".beebox", "quick-capture", id);
}
export function captureDigest(declaration: QuickCaptureDeclaration): string {
  // Zod fixes field order at the untrusted boundary; JSON property order from a client is irrelevant.
  return createHash("sha256").update(JSON.stringify(quickCaptureDeclarationSchema.parse(declaration))).digest("hex");
}
export async function readCapture(boxRoot: string, id: string): Promise<CaptureRecord | null> {
  return (await readJsonIfPresent(path.join(captureDirectory(boxRoot, id), "record.json"), captureRecordSchema)) ?? null;
}
export async function writeCapture(boxRoot: string, record: CaptureRecord): Promise<void> {
  if (record.state === "gone") {
    // Keep only identity/ownership/timestamps so stale upload cannot undo a human deletion.
    delete record.declaration.input; delete record.declaration.material; delete record.transcript;
  }
  await writeFileAtomic(path.join(captureDirectory(boxRoot, record.id), "record.json"), { content: JSON.stringify(record), mode: 0o600 });
  if (record.state === "gone") await fs.rm(path.join(captureDirectory(boxRoot, record.id), "material"), { force: true });
}
export async function withCaptureLock<T>(args: { boxRoot: string; id: string }, fn: () => Promise<T>): Promise<T> {
  return withFileLock({ lockPath: `${captureDirectory(args.boxRoot, args.id)}.lock`, metadata: { purpose: "quick-capture", id: args.id }, waitMs: 35000 }, fn);
}
export async function listCaptures(boxRoot: string): Promise<CaptureRecord[]> {
  let names: string[];
  try { names = await fs.readdir(path.join(boxRoot, ".beebox", "quick-capture")); }
  catch (error) { if (errnoCode(error) === "ENOENT") return []; throw error; }
  const records: CaptureRecord[] = [];
  for (const name of names) {
    if (!z.string().uuid().safeParse(name).success) continue;
    const record = await readCapture(boxRoot, name);
    if (record !== null) records.push(record);
  }
  return records.toSorted((a, b) => b.declaration.capturedAt.localeCompare(a.declaration.capturedAt));
}
export function requireCaptureOwner(record: CaptureRecord, owner: string | null): void {
  if (record.owner !== owner) throw new QuickCaptureError({ reason: "different-owner" });
}

const CAPTURE_FAILURES = {
  "self-context": { code: "invalid", message: "A capture cannot refer to itself." },
  "incomplete-material": { code: "invalid", message: "The complete declared material was not received." },
  "undeclared-file": { code: "invalid", message: "This declaration does not accept a file." },
  "deleted-capture": { code: "gone", message: "This capture was deleted. It cannot be recreated by retrying." },
  "changed-content": { code: "conflict", message: "This capture ID already belongs to different content." },
  "missing-parent": { code: "not-found", message: "Wait for the original capture to be accepted before sending context." },
  "deleted-parent": { code: "gone", message: "The original capture was deleted." },
  "invalid-source-ref": { code: "invalid", message: "The saved source reference is invalid." },
  "duplicate-source": { code: "conflict", message: "The source capture ID appears on more than one saved source." },
  "migration-pending": { code: "conflict", message: "The saved source is waiting for a box data migration. Retry after the box is migrated." },
  "missing-source": { code: "gone", message: "The saved source was deleted." },
  "different-owner": { code: "forbidden", message: "This capture belongs to another user." },
  "context-without-parent": { code: "invalid", message: "Context needs an original capture." },
  "parent-gone": { code: "gone", message: "The original capture is gone." },
  "nested-context": { code: "invalid", message: "Add context to an original capture, not another context event." },
  "unsaved-recording": { code: "invalid", message: "Recording source has not been saved." },
  "empty-transcript": { code: "invalid", message: "No words were transcribed. The audio is saved; retry transcription if needed." },
  "source-unavailable": { code: "invalid", message: "Capture source is unavailable." },
  "unsupported-file-part": { code: "invalid", message: "Only the declared material file is supported." },
  "truncated-file": { code: "invalid", message: "Material exceeded the upload limit." },
  "invalid-declaration-part": { code: "invalid", message: "Expected one complete declaration." },
  "invalid-declaration-json": { code: "invalid", message: "Invalid declaration JSON." },
  "unsupported-declaration": { code: "invalid", message: "Unsupported capture declaration or material." },
} as const;
