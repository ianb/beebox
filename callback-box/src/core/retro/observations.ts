/**
 * Observation vocabulary for the retrospective — what the observer
 * extracts from one chat session, before integration. See
 * `docs/plans/box-retrospectives.md` for the locked kind/sink vocabulary.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

export const ObservationKind = z.enum([
  "correction",
  "preference",
  "register",
  "recurring-ask",
  "context-gap",
  "experiment-evidence",
]);

export const ObservationSink = z.enum(["personality", "guide", "briefing", "question"]);

/**
 * One observation. `evidence` must be a literal quote — requiring the
 * quote to be *recorded* (not merely "based on") is the hallucination
 * guard; there is deliberately no automated re-verification.
 */
export const ObservationSchema = z.object({
  kind: ObservationKind,
  evidence: z
    .string()
    .min(1)
    .describe("Literal quote copied from the transcript — never a paraphrase"),
  proposal: z
    .string()
    .min(1)
    .describe("One sentence: what belief or rule this evidence suggests"),
  sink: ObservationSink.describe(
    "Where the belief belongs: personality (tone/traits/relationship), guide (domain rule), briefing (missing situational context), question (needs boxholder confirmation)"
  ),
  sinkRef: z
    .string()
    .optional()
    .describe("Box-relative card path when sink is guide, e.g. config/intake.guide.card"),
});
export type SessionObservation = z.infer<typeof ObservationSchema>;

/** The observer's structured output: zero or more observations. */
export const ObserverOutputSchema = z.object({
  observations: z.array(ObservationSchema),
});

/**
 * Whitespace-normalized hash of an evidence quote. Used to drop exact
 * duplicates — including re-presentations of the same turns when a
 * resumed session re-copies its history — so recurrence counts can't be
 * inflated by one conversation.
 */
export function evidenceHash(evidence: string): string {
  const normalized = evidence.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}
