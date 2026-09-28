/** Reproducible triage policy, separate from its editable guide and landmarks. */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import { parseGuide, parseGuideCard } from "../../schemas/guide/parse.js";
import { compileGuide } from "../../schemas/guide/compile.js";
import { parseLandmarkFields } from "../../schemas/landmark.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";
import { errnoCode } from "../../shared/error-guards.js";
import { deriveCategoryName, disambiguateCategoryNames } from "./instructions.js";
import { normalizeLandmarkDir } from "../landmark/root-dir.js";
import { findDestination } from "../landmark/destination.js";

export const INTAKE_GUIDE_REF = "/_config/intake.guide.card";
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const refSchema = z.string().refine((ref) => {
  const parsed = parseRef(ref);
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "card" });
  return resolved !== null && ref === `/${resolved}` && parsed.query === undefined && parsed.fragment === undefined;
}, "Expected a canonical box file ref");
const sourceSchema = z.object({ ref: refSchema, digest: z.string().regex(/^[\da-f]{64}$/).nullable(), overlay: z.string().optional() });
export const instructionSnapshotSchema = z.object({
  version: z.literal(1), compilerVersion: z.literal(1), policy: z.string(), trial: z.boolean(),
  sources: z.array(sourceSchema),
  destinations: z.array(z.object({ ref: refSchema, optionId: z.string(), name: z.string(), dir: z.string(), rules: z.string(), procedureRef: z.string().nullable() })),
}).superRefine((value, ctx) => {
  const keys = value.destinations.map((d) => d.optionId);
  if (new Set(keys).size !== keys.length || keys.some((key) => !/^destination_[\da-f]{64}$/.test(key))) {
    ctx.addIssue({ code: "custom", message: "Duplicate or invalid destination option IDs" });
  }
  for (const destination of value.destinations) {
    if (destination.optionId !== `destination_${digest(destination.ref)}` || destination.dir !== normalizeLandmarkDir(path.posix.dirname(destination.ref.slice(1))) || !value.sources.some((source) => source.ref === destination.ref)) ctx.addIssue({ code: "custom", message: `Destination identity does not match its source: ${destination.ref}` });
  }
  if (new Set(value.destinations.map((d) => d.ref)).size !== value.destinations.length) ctx.addIssue({ code: "custom", message: "Duplicate destination refs" });
});
export type InstructionSnapshot = z.infer<typeof instructionSnapshotSchema>;
export interface SnapshotOptions { guideOverlay?: string; landmarkOverlays?: Record<string, string> }
export class TriageInstructionsError extends Error {
  constructor({ kind, ref }: { kind: "ref" | "guide" | "landmark"; ref: string }) { super(`${kind === "ref" ? "Invalid instruction ref" : `Invalid ${kind} fields`}: ${ref}`); this.name = "TriageInstructionsError"; }
}

function canonicalRef(ref: string): string {
  const parsed = parseRef(ref);
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "card" });
  if (resolved === null || parsed.query !== undefined || parsed.fragment !== undefined) throw new TriageInstructionsError({ kind: "ref", ref: ref });
  return `/${resolved}`;
}

function overlayField(overlay: string | undefined): { overlay?: string } { return overlay === undefined ? {} : { overlay }; }

/** Candidates are explicit filesystem files; their keys remain canonical box refs. */
export async function compileInstructionSnapshot(boxRoot: string, options?: SnapshotOptions): Promise<InstructionSnapshot> {
  const sources: InstructionSnapshot["sources"] = [];
  const guidePath = options?.guideOverlay ?? path.join(boxRoot, INTAKE_GUIDE_REF.slice(1));
  let guide: string | null;
  try { guide = await fs.readFile(guidePath, "utf8"); }
  catch (error) {
    if (errnoCode(error) !== "ENOENT" || options?.guideOverlay !== undefined) throw error;
    // An absent canonical guide explicitly selects the documented built-in policy.
    guide = null;
  }
  sources.push({ ref: INTAKE_GUIDE_REF, digest: guide === null ? null : digest(guide), ...overlayField(options?.guideOverlay) });
  let policy = "No intake guide exists. Be conservative: choose unclear for uncertain placement or missing necessary evidence. Choose no-match only when readable evidence shows no category fits.";
  if (guide !== null) {
    const fields = parseGuideCard(guide);
    if (fields === null) throw new TriageInstructionsError({ kind: "guide", ref: INTAKE_GUIDE_REF });
    const parsed = parseGuide(fields);
    // Reuse the guide compiler, retaining only decision policy and current context.
    // Source labels are explicit: sorting alone cannot settle semantic conflicts.
    const trial = Boolean(options?.guideOverlay);
    const rules = parsed.triageRules.filter((rule) => trial || rule.confidence !== "hypothesis");
    const usedActions = new Set([...rules.map((rule) => rule.action), parsed.defaultAction?.action]);
    policy = compileGuide({ ...parsed, triageRules: rules.map((rule) => ({ ...rule, confidence: rule.confidence === "hypothesis" ? "low" : rule.confidence, text: `[source: ${rule.source}${rule.confidence === "hypothesis" ? "; trial hypothesis" : ""}] ${rule.text}` })), actions: parsed.actions.filter((action) => usedActions.has(action.name)), experiments: [], reactions: [] }, "intake");
  }
  policy += "\nSource precedence: user-stated > feedback > inferred > default. Never weaken user-stated policy to satisfy an inferred rule. Unresolved conflicting instructions mean unclear. Landmark rules describe destination boundaries; the intake guide governs how to decide. Best effort is permitted when the policy explicitly allows it.";
  const overlays = new Map(Object.entries(options?.landmarkOverlays ?? {}).map(([ref, file]) => [canonicalRef(ref), file]));
  const matches = await glob("{_content,_config}/**/*.landmark.card", { cwd: boxRoot, nodir: true });
  const refs = [...new Set([...matches.map((ref) => `/${ref}`), ...overlays.keys()])].toSorted();
  const destinations: InstructionSnapshot["destinations"] = [];
  for (const ref of refs) {
    const overlay = overlays.get(ref);
    const content = await fs.readFile(overlay ?? path.join(boxRoot, ref.slice(1)), "utf8");
    const fields = parseLandmarkFields(content);
    if (fields === null) throw new TriageInstructionsError({ kind: "landmark", ref: ref });
    const destination = findDestination(fields.destinations, "triage");
    // Include non-destinations too: removing a destination must invalidate apply.
    sources.push({ ref, digest: digest(content), ...overlayField(overlay) });
    if (destination === null) continue;
    const dir = normalizeLandmarkDir(path.posix.dirname(ref.slice(1)));
    destinations.push({ ref, optionId: `destination_${digest(ref)}`, name: deriveCategoryName(dir), dir, rules: destination.rules?.trim() ?? "", procedureRef: destination.procedure?.ref ?? null });
  }
  destinations.sort((a, b) => a.dir.localeCompare(b.dir));
  disambiguateCategoryNames(destinations);
  return instructionSnapshotSchema.parse({ version: 1, compilerVersion: 1, policy, sources, destinations, trial: options?.guideOverlay !== undefined || overlays.size > 0 });
}
