import { z } from "zod";
import { invariant } from "../../../shared/invariant.js";

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
  totalEntries: z.number().int().nonnegative().optional(),
  lastMessageAt: z.string().datetime().optional(),
  rubric: z.array(z.object({ when: z.string(), avoid: z.string().optional(), examples: z.array(z.string()).optional() })).optional(),
});
export type RoutingCandidate = z.infer<typeof routingCandidateSchema>;

export interface RankedRoutingCandidate {
  candidate: RoutingCandidate;
  probability: number;
}

/**
 * True when a thought opens with the words "new chat" (any case, after any
 * leading whitespace): the person asked the box for a new chat, so an existing
 * chat must not win by preference.
 */
export function thoughtAsksForNewChat(message: string): boolean {
  return /^\s*new\s+chat\b/i.test(message);
}

/**
 * Trial preference, not a calibrated correctness threshold. Keep the raw ranking.
 * `newChatRequested` (see {@link thoughtAsksForNewChat}) skips the existing-chat preference.
 */
export function selectRoutingDestination(args: {
  candidates: RoutingCandidate[];
  probabilities: Record<string, number>;
  existingMargin?: number;
  newChatRequested?: boolean;
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
  const preferred = args.newChatRequested !== true && first.candidate.target.kind === "new-session" && existing !== undefined
    && first.probability - existing.probability <= existingMargin ? existing : first;
  return { selected: preferred.candidate, ranked, preferenceApplied: preferred !== first };
}

/** Provisional: posts the clear samples and asks on the debatable ones. Calibrate from stored records. */
const QUICK_CHAT_POST_FLOOR = 0.9;

/**
 * Where a candidate lands: its landmark, or its own context directory when it
 * has none. Two landmark-less candidates are one place only when they work in
 * the same directory.
 */
function routingPlace(candidate: RoutingCandidate): string {
  return candidate.landmark === undefined ? `dir:${candidate.target.contextDir}` : `landmark:${candidate.landmark.path}`;
}

/**
 * Post when the judged probability of `selected`'s place reaches the floor;
 * otherwise ask the person. A place's mass sums every candidate in it, so a
 * split between a landmark's chat and a new chat in that landmark is not doubt.
 */
export function routingDisposition(args: {
  selected: RoutingCandidate;
  ranked: RankedRoutingCandidate[];
  postFloor?: number;
}): "post" | "ask" {
  const postFloor = args.postFloor ?? QUICK_CHAT_POST_FLOOR;
  invariant(Number.isFinite(postFloor) && postFloor >= 0 && postFloor <= 1, "Routing post floor must be between zero and one");
  const place = routingPlace(args.selected);
  const mass = args.ranked
    .filter((entry) => routingPlace(entry.candidate) === place)
    .reduce((sum, entry) => sum + entry.probability, 0);
  // Summation error must not move a place that sits exactly on the floor.
  return mass + 1e-9 >= postFloor ? "post" : "ask";
}
