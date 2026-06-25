/**
 * Lesson-plan card schema — the ordered DELIVERY FLOW of a course.
 *
 * Where the concept-map says *what* to learn and the exposition-plan says *how*
 * to present it, the lesson-plan is the missing *what-to-do, in order*: a
 * sequence of segments, each either `interactive` (happens live in chat —
 * dialog, prediction probes) or `material` (uses a pre-made material card).
 * A segment names the concept-map node(s) it advances and, for a material
 * segment, refs the material card it uses.
 *
 * Incompleteness is visible, not silent: a `material` segment either has its
 * card (`status: ready`) or is explicitly deferred (`status: planned`). The
 * box-aware lint (card-lint.ts → lint-node-refs.ts) warns on a material segment
 * that is neither, and on a `concepts` id that names no node in the course's
 * concept-map.
 *
 * The lesson-plan carries NO course/concept-map back-ref: it lives in the
 * course's attach scope alongside the concept-map, so the lint resolves the map
 * as the sibling `*.concept-map.card` — no optional ref that silently no-ops
 * when absent.
 *
 * See docs/plans/courseware-lesson-plan.md.
 */

import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** Whether a segment plays out live in chat or leans on a pre-made material card. */
const SegmentMode = z.enum(["interactive", "material"]);

/** A material segment's authoring state: its card exists, or it's outlined-but-deferred. */
const SegmentStatus = z.enum(["planned", "ready"]);

/** One step in the delivery flow. */
const Segment = z.object({
  do: z.string(),
  mode: SegmentMode,
  status: SegmentStatus.optional(),
  concepts: z.array(z.string()).optional(),
  material: z.object({ ref: z.string() }).optional(),
  note: z.string().optional(),
});

const lessonPlanFields = {
  segments: z.array(Segment).optional(),
  body: body(z.string()),
};

export const LessonPlanSchema: CardSchema = cardSchema("lesson-plan", {
  fields: lessonPlanFields,
  instructions: `# Lesson-Plan Cards

A lesson-plan is the **ordered delivery flow** of a course: the sequence of segments that says *what to do, in order*. It is the third course component alongside the other two, and the line between them matters:

- the **concept-map** says *what* to learn (the knowledge graph),
- the **exposition-plan** says *how* to present it and **why** (the rated approaches + rules),
- the **lesson-plan** just *sequences* it — what happens, in what order, live-or-material.

So the rationale for a choice lives in the exposition-plan; here, \`do\` is **terse** (the activity, not the argument for it).

## Segments

Each segment commits to one \`mode\`:

- **interactive** — the learning is in the back-and-forth: eliciting the learner's model, predict-and-explain, Socratic dialog. It happens live in chat; there's no pre-made artifact.
- **material** — a pre-made artifact carries it better than live talk: a \`figure\` to manipulate, a \`doc\` to read. The segment refs that card.

**Most early-course segments are interactive.** Reach for \`material\` only where a made artifact genuinely earns it (something worth re-reading, or a manipulable that beats description). A \`material\` segment may still carry an interactive \`note\` (e.g. "have them predict before revealing the figure") — that's how "both" is expressed without a third mode.

\`\`\`yaml
segments:
  - do: Elicit their model — "what's actually moving when an acid reacts?"
    mode: interactive
    concepts: [proton-transfer]          # concept-map node id(s) this advances
  - do: Walk the proton-transfer figure; have them predict each step first
    mode: material
    status: ready                        # the card exists
    concepts: [proton-transfer, conjugate-pairs]
    material: { ref: material/Proton_Transfer.figure.card }
    note: Predict-then-reveal; don't just show it
  - do: Written recap of strong-vs-weak acids to re-read later
    mode: material
    status: planned                      # outlined, not built yet
    concepts: [acid-strength]
\`\`\`

## Status — make deferral visible, never silent

A build does **not** author all the material up front. Most material segments stay outlined. Mark each material segment honestly:

- **ready** — the \`material\` card exists; ref it.
- **planned** — the card is outlined here but not built yet (authored later, during teaching).

The lint **warns** on a \`material\` segment that has neither a \`material\` ref nor \`status: planned\` — so "incomplete material" is a stated fact, not a hidden gap. A complete build is *not* "every segment authored"; it's "every material segment is \`ready\` or explicitly \`planned\`." A mostly-interactive, mostly-\`planned\` course is a complete plan.

## Concepts

\`concepts\` lists concept-map node \`id\`s the segment advances. They're checked against the course's concept-map (the sibling \`*.concept-map.card\`); a stale id warns, naming the segment.

## Body

The framing: the arc of the course, where it goes live vs material-backed, and why this ordering. Living — amend it as the course adapts. Use **neutral pronouns** (they/them) for the learner.`,
});

/**
 * Starter lesson-plan for \`cb create\`: one interactive and one material segment
 * showing both modes and the \`status\` convention, plus a framing body.
 */
export function createLessonPlanTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    segments: [
      {
        do: "Elicit the learner's current model of the first concept.",
        mode: "interactive",
        concepts: ["first-concept"],
      },
      {
        do: "A made artifact (figure/doc) for the part that earns one.",
        mode: "material",
        status: "planned",
        concepts: ["first-concept"],
      },
    ],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = "The arc of the course: where it goes live vs material-backed, and why. Use neutral pronouns for the learner.\n";
  return `---\n${yamlText}---\n${bodyText}`;
}
