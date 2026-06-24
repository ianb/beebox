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

## The process

It is not a rigid pipeline — probing comes early and the rest follows from what it surfaces. Revisit and adapt freely.

### 1. Probe — interactively, and by default

Before designing anything, find out what the learner actually understands — about this topic *and* the territory around it. **Probe, don't quiz.** Ask open-ended questions anchored in a concrete, familiar phenomenon, aimed at their mental model:

> "What do you think is actually happening when you mix baking soda and vinegar?"

One good phenomenon-question surfaces a lot — what they know, in their own words, *and* the misconceptions they hold. Chase the reasoning behind an answer; branch on what they say. Stop when you have enough to design — don't drag it out.

Hunt for **misconceptions**, not just gaps: a confidently-held wrong model matters more than an absence, and it is where teaching has the most work to do.

**This step is the default, but not always possible.** If you are building for an unknown/future learner (no one to probe), skip it: build for a sensible model learner, and probe for real the first time someone engages.

### 2. Set the success criteria

Find out — and write down — what would count as *understanding this, for this learner*. Casual and personal, not a standardized objective: "can predict whether a reaction fizzes and explain why, without naming every ion." Pay attention to the *deeper* why behind the request (a better mental model? a specific task?). Set this **early**: it is the lens for what belongs in the graph and what to emphasize. It goes in the course's \`success-criteria\`.

### 3. Build the concept-map

Lay out the concepts between where the learner is and where they want to be, and draw the typed edges between them. Assign each node its KC \`kind\` (it steers *how* you teach it). Record the misconceptions you actually observed. Let genuine spirals be \`complements\` cycles — don't force a clean line where the subject is genuinely circular. (See the concept-map card-rule for the node fields and the edge-type rubric.)

### 4. Seed progress — with evidence

Write a \`progress\` card from what the probe surfaced. **Every entry cites the evidence** — what the learner actually said or did, and how you judged it (\`observed\` / \`inferred\` / \`self-report\`). Rate the *evidence*, not their confidence. This is the honest starting picture you track against over time.

### 5. Plan the exposition

Step back: given the scope and the learner's deeper goals, how should this be *presented*? Set the \`emphasis\` (e.g. principles over terminology, if a mental model is the goal). Choose modalities that fit — dialog, worked examples with fading, manipulatives/figures, transfer prompts, a reflection step — each with a reason.

### 6. Write the plan, with the reasoning in

Record the exposition-plan's decisions *with their rationale*, and produce the material under \`material/\` in the chosen modalities. Keep answer keys with the material. The point of writing the reasoning down is that when you adapt later (step 7), the *why* travels with the plan, so you don't undo a good decision by accident.

### 7. Adapt as you go

Adaptation is expected and a good sign. As you learn more about the learner — or their goal shifts — amend the graph, re-plan the exposition, and update progress (with new evidence). Read the recorded rationale and extend it; don't silently overwrite it.

**Revising an existing course** runs the same loop against the existing cards: re-probe where needed, adjust, and log what changed and why.

## Honesty (non-negotiable)

The worst failure here is confidently producing a beautiful course you never checked against the learner. Guard against it:

- **Don't give away answers.** When the learner is working toward something, retrieve the answer key to guide them — never just hand it over. Let them reason.
- **Follow their actual work**, not an idealized path. Meet them where they are; acknowledge partial and correct-but-incomplete thinking instead of restarting.
- **Don't fabricate.** Never invent a misconception, a concept, or evidence the learner didn't actually exhibit.
- **Rate the evidence, not the confidence.** Don't upgrade a status because the learner sounds sure, or because you'd like them to be further along. A status with no real evidence doesn't belong in the card.
`;
