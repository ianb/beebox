import { z } from "zod";
import { invariant } from "../../../lib/invariant.js";

export interface RoutingRule {
  when: string;
  avoid?: string | undefined;
  examples?: string[] | undefined;
}

export const routingCandidateSchema = z.object({
  id: z.string(), label: z.string(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing-session"), sessionId: z.string(), contextDir: z.string() }),
    z.object({ kind: z.literal("new-session"), contextDir: z.string() }),
  ]),
  landmark: z.object({ path: z.string(), label: z.string() }).optional(),
  lastActivity: z.string().optional(), recentContext: z.string().optional(),
  contextTruncated: z.boolean().optional(),
  rubric: z.array(z.object({ when: z.string(), avoid: z.string().optional(), examples: z.array(z.string()).optional() })).optional(),
});
export type RoutingCandidate = z.infer<typeof routingCandidateSchema>;

export interface RankedRoutingCandidate {
  candidate: RoutingCandidate;
  probability: number;
}

/** Trial preference, not a calibrated correctness threshold. Keep the raw ranking. */
export function selectRoutingDestination(args: {
  candidates: RoutingCandidate[];
  probabilities: Record<string, number>;
  existingMargin?: number;
}): {
  selected: RoutingCandidate;
  ranked: RankedRoutingCandidate[];
  preferenceApplied: boolean;
} {
  const existingMargin = args.existingMargin ?? 0.1;
  invariant(Number.isFinite(existingMargin) && existingMargin >= 0 && existingMargin <= 1,
    "Routing preference margin must be between zero and one");
  const ranked = args.candidates.map((candidate) => {
    const probability = args.probabilities[candidate.id];
    invariant(probability !== undefined, "Validated judgment must include every candidate");
    return { candidate, probability };
  }).toSorted((a, b) => b.probability - a.probability
    || Number(b.candidate.target.kind === "existing-session") - Number(a.candidate.target.kind === "existing-session")
    || a.candidate.id.localeCompare(b.candidate.id));
  const first = ranked[0];
  invariant(first !== undefined, "Routing requires at least one candidate");
  const existing = ranked.find((entry) => entry.candidate.target.kind === "existing-session");
  const preferred = first.candidate.target.kind === "new-session" && existing !== undefined
    && first.probability - existing.probability <= existingMargin ? existing : first;
  return { selected: preferred.candidate, ranked, preferenceApplied: preferred !== first };
}
