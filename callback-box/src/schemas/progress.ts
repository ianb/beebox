/**
 * Progress card schema — a per-learner, evidence-backed record of understanding.
 *
 * Tracked SEPARATELY from a course's content (its own card; may live in another
 * tree), so one learner's progress can be kept apart from shared material. Each
 * entry is a qualitative status for one concept-map node, and — the load-bearing
 * rule — **every status must cite the evidence and the basis that produced it**.
 * That is the guard against an LLM sycophantically rating a learner "solid".
 *
 * It is a present-state snapshot, NOT a decay/forgetting model. The running
 * session log lives as a plain file in the card's `<basename>.attach/` scope.
 *
 * See docs/implemented-plans/courseware-phase1.md.
 */

import { body, cardSchema, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";
import { z } from "zod";

/** Qualitative status for a node — judged against the course's success-criteria. */
const NodeStatus = z.enum(["unfamiliar", "partial", "working", "solid"]);

/** How a rating was reached. */
const EvidenceBasis = z.enum(["observed", "inferred", "self-report"]);

/** A reference to the course this progress tracks (the `ref` key is lint-checked). */
const CourseRef = z.object({ ref: z.string() });

/**
 * One node's state. `status`, `basis`, and at least one `evidence` item are all
 * REQUIRED: there is no anonymous rating — a status without the learner's actual
 * words/work and how it was judged won't parse.
 */
const ProgressEntry = z.object({
  node: z.string(),
  status: NodeStatus,
  basis: EvidenceBasis,
  evidence: z.array(z.string()).min(1),
  "last-assessed": z.string().optional(),
  "next-probe": z.string().optional(),
  misconception: z.string().optional(),
});

const progressFields = {
  course: CourseRef.optional(),
  learner: z.string().optional(),
  entries: z.array(ProgressEntry).optional(),
  body: body(z.string()),
};

export const ProgressSchema: CardSchema = cardSchema("progress", {
  description: "A per-learner, evidence-backed record of understanding against a course's concept-map nodes",
  category: "authored",
  fields: progressFields,
  instructions: `# Progress Cards

A progress card is a per-learner, **evidence-backed** record of what a learner understands. It is tracked **separately** from a course's content — its own card, which may live in the course's attach scope or in its own tree (it points back at the course by \`ref\`). Each entry is a qualitative status for one **concept-map node** (named by the node's \`id\`).

## Keep it sparse — record only what you have signal on

It is a **sparse overlay on the concept-map, not a mirror of it.** Add an entry only for a node you actually have signal on — something you observed, or a genuine inference worth keeping. **A node with no entry simply means "not assessed yet"** — that's the default, and it's fine. **Do not enumerate the whole map** or manufacture "not directly probed; inferred from…" entries; that's tedious noise, not knowledge. A handful of real entries beats a full sweep of filler.

## No status without evidence

Every entry must cite the learner's actual words/work and how the rating was reached:

- \`status\`: \`unfamiliar | partial | working | solid\` — qualitative, and **judged against the course's \`success-criteria\`**. Understanding the mechanism with fuzzy terminology can be \`working\`/\`solid\` when names aren't the goal.
- \`basis\`: \`observed | inferred | self-report\` — how you know.
- \`evidence\`: at least one concrete item — what the learner said or did. **Rate the evidence, not the learner's confidence.** Don't upgrade a status just because they sound sure.
- \`next-probe\` (optional): what would test or change this rating.
- \`misconception\` (optional): an active wrong model to address.

This is a **present-state snapshot, not a decay model** — it records where the learner is now, not forgetting over time.

\`\`\`yaml
course: { ref: ../Acids.course.card }
learner: the-learner
entries:
  - node: electron-transfer        # a concept-map node id
    status: partial
    basis: observed
    evidence:
      - "Said acids 'give away' something but couldn't say what; didn't mention protons"
    next-probe: Ask what's actually moving when an acid reacts
    misconception: Thinks acidity is about taste/corrosiveness, not proton donation
\`\`\`

## Session log

The running narrative of each sitting — what was covered, notable utterances, ratings changed and why — lives as a plain file in this card's \`<basename>.attach/\` scope, **not** in the card body. The body is a short running summary.`,
});

/**
 * Starter progress card for \`cb create\`: one example entry showing the required
 * evidence contract, plus a summary body. The agent sets the \`course\` ref and
 * seeds real entries from the probe.
 */
export function createProgressTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    entries: [
      {
        node: "some-concept-id",
        status: "partial",
        basis: "observed",
        evidence: ["What the learner said or did that supports this status."],
      },
    ],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const bodyText = "A short running summary of where the learner is. The blow-by-blow session log is an attachment.\n";
  return renderFrontmatterBlock(fields, bodyText);
}
