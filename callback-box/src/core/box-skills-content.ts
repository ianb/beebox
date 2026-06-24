/**
 * Content for the managed box skills installed by `generateSkills`
 * (box-skills.ts). Kept separate so the provisioning logic stays small and the
 * skill prose reads on its own. Authored as escaped-backtick template literals,
 * the same pattern as schema `instructions`.
 *
 * NOTE: this is agent-facing prose under review — the boxholder reviews the
 * skill before it ships. See docs/plans/courseware-phase1.md (Track 5).
 */

/** The `build-course` skill: the pedagogical process for building a course. */
export const BUILD_COURSE_SKILL = `---
name: build-course
description: Build or revise a learning experience (a course) WITH a learner — probe what they understand, map the knowledge, plan how to present it, and track evidence-backed progress. Use when asked to teach a topic, create a course/lesson/tutorial, help someone learn or understand something, or revise/extend an existing course.
---

# Building a course

A **course** is a learning experience you build *with* a learner on one bounded topic. You don't write it cold and hand it over — you probe, design, and adapt, keeping your reasoning in the cards so later changes stay coherent.

This skill orchestrates four card types. Each has its own card-rule with the field details — read the rule when you open a card of that type:

- \`course\` — the manifest that binds everything.
- \`concept-map\` — the knowledge graph (concepts as nodes, typed edges).
- \`exposition-plan\` — the plan for how to *present* the material, with the reasoning kept in.
- \`progress\` — a separate, per-learner, evidence-backed record of what the learner understands.

The actual teaching material (docs, figures, etc.) lives in the course's \`material/\` subdirectory.

Write all of these cards with **neutral pronouns** (they/them) for the learner, whoever they are.

## The process

It is not a rigid pipeline — probing comes early and the rest follows from what it surfaces. Revisit and adapt freely.

### 1. Probe — to understand, not to test

Before designing anything, understand what the learner knows — the full, real picture. You are **not** testing or challenging them, and this is not a quiz. Think of a Piagetian clinical interview: curious, following their thinking wherever it leads. Ask open-ended questions anchored in a concrete, familiar phenomenon, aimed at their mental model:

> "What do you think is actually happening when you mix baking soda and vinegar?"

One good phenomenon-question surfaces a lot, in their own words. Chase the reasoning behind an answer; branch on what they say.

Aim for the *fullness* of what they understand — including the parts they can't yet name. Some real understanding is **obscured by ignorance elsewhere**: a missing word, or a gap in a neighboring idea, can make a learner seem to know less than they do. Dig past that, and give them room to show what they grasp. Notice misconceptions too — not to correct on the spot, but because a confidently-held wrong model is part of the real picture and shapes what to teach. It's fine to gently check things they seem sure of, as well — not to catch them out, but so the picture is honest in both directions.

Stop when you have enough to design — don't drag it out.

**This step is the default, but not always possible.** If you are building for an unknown/future learner (no one to probe), skip it: build for a sensible model learner, and probe for real the first time someone engages.

### 2. Set the success criteria

Find out — and write down — what would count as *understanding this, for this learner*. Casual and personal, not a standardized objective: "can predict whether a reaction fizzes and explain why, without naming every ion." Pay attention to the *deeper* why behind the request (a better mental model? a specific task?). Set this **early**: it is the lens for what belongs in the graph and what to emphasize. It goes in the course's \`success-criteria\`.

### 3. Build the concept-map

Lay out the concepts between where the learner is and where they want to be, and draw the typed edges between them. Assign each node its KC \`kind\` (it steers *how* you teach it). On each node, note the **common** misconceptions for that concept — what learners *typically* get wrong, so the teaching can preempt them (the *specific* misconceptions this learner showed go in the \`progress\` card, not the map). Let genuine spirals be \`complements\` cycles — don't force a clean line where the subject is genuinely circular. (See the concept-map card-rule for the node fields and the edge-type rubric.)

### 4. Seed progress — grounded in what you saw

Write a \`progress\` card from what the probe surfaced. Each entry records what the learner actually said or did (the \`evidence\`) and how you read it (\`observed\` / \`inferred\` / \`self-report\`), so the record reflects your real understanding of where they are rather than a guess. This is the honest starting picture, and you update it as you learn more.

### 5. Plan the exposition

Work out how to *present* this material — in the \`exposition-plan\` card, in this order:

1. **Translate the learner into style first.** Turn what you know about them — and whether this is a \`generic\` course or for a specific person (set the course's \`audience\`) — into concrete implications for *how* to present. This guides the ratings below.
2. **Enumerate and rate approaches.** List the candidate ways to present, and rate each for *this* material and learner. **You over-reach for plain prose — deliberately consider non-textual options** (dialog, a figure/manipulable, a diagram, contrasting cases, an analogy) and say why each does or doesn't fit. But never use a technique just because it exists; each must earn its place, and **mostly-textual is a fine answer if it genuinely fits** — variety is not the goal.
3. **Distill into \`rules\`.** Write a short list of concrete, standalone rules you can follow later without re-reading — they're compiled into a box rule that auto-loads while you work in this course.

(See the exposition-plan card-rule for the field details.)

### 6. Produce the material

Author the material under \`material/\` following the exposition-plan's rules and rated approaches. Keep answer keys with the material, grounded in cited sources (see *Teaching well*). The reasoning stays in the exposition-plan and the cards' bodies, so when you adapt later (step 7) the *why* travels with the work — you don't undo a good decision by accident.

### 7. Adapt as you go

Adaptation is expected and a good sign. As you learn more about the learner — or their goal shifts — amend the graph, re-plan the exposition, and update progress (with new evidence). Read the recorded rationale and extend it; don't silently overwrite it.

**Revising an existing course** runs the same loop against the existing cards: re-probe where needed, adjust, and log what changed and why.

## Teaching well

- **Be Socratic.** Guide the learner to reason rather than handing them answers — use the answer key to steer your questions, don't just state it. Meet them where they are; build on partial and correct-but-incomplete thinking instead of restarting.
- **Ground what you teach in sources.** Don't assert facts from memory — especially in answer keys and explanations. Bring the authoritative material into the box (e.g. a \`doc\` or \`webpage\` card) and cite it with the \`{% source %}\` pattern, so the learner can trace what they're told and the content stays trustworthy:

  > Acids {% source ref="material/Acids_Bases.doc.card" %}donate protons{% /source %} in solution.

  A bare \`{% source ref="..." %}…{% /source %}\` anchors a span to a cited card; use \`href="..."\` to cite an external URL instead. (See the box's source-tagging convention for the full pattern.)
`;
