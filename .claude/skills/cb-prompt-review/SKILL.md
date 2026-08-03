---
name: cb-prompt-review
description: Review or engineer callback-box's agent-facing prompt surface — the agent guide, chat/reactor system prompts, schema instructions, box skills, and rules. Use when auditing the assembled prompt stack for overlap/redundancy/staleness/contradiction, checking what an agent actually sees in some situation, or after any change to prompt-generating code. Triggers include "review the prompts", "prompt surface", "what does the chat/reactor agent see", "check for prompt overlap". (For routing a single new instruction to the right box surface, that's cb-context.)
---

# Reviewing the prompt surface

The prompts are how every agent comes to understand Callback Box — what it is, what its role is, what the rules are. They are generated code (`src/core/agent-guide/`, `src/core/chat/session/prompts.ts`, `src/core/reactor/prompts.ts`, schema `instructions`, `src/core/box/skills-content.ts`), assembled into a per-situation context stack. Review the *assembled stack*, not the source files: judge what an agent actually reads, end to end.

This skill audits the whole assembled surface; its sibling `cb-context` is the authoring/routing guide for placing an individual instruction on a box's own surfaces. Same attention-budget principle, opposite direction of work.

## See the assembled context

```bash
cd callback-box
pnpm agent-context --list                                  # the known situations
pnpm agent-context chat --box ~/src/boxes/test1            # full chat stack, layer by layer
pnpm agent-context reactor --box ~/src/boxes/test1 --card-type recipe
pnpm agent-context chat --box ~/src/boxes/test1 --skill calendar --output scratch/ctx.md
```

Each report shows every layer with its loading class and word count, plus the always-loaded total. `pnpm prompt-report` is the complementary flat *inventory* of every prompt in the system; `agent-context` is the per-situation *composition*.

**Boxes go stale.** The box-side layers (CLAUDE.md, agent guide, skills, rules) are what `cb init` last wrote — re-run `cb init` on the box after changing generator code, or the report shows the old world. That staleness being visible is a feature, not a bug.

## The layering model

Every agent's context is a stack; each layer has a loading class:

1. **Identity prompt** (always) — per situation: chat, chat-thread, reactor, procedure. Says what the agent *is* and covers only that situation's surface.
2. **Box knowledge** (always) — box CLAUDE.md → compiled briefing + the agent guide. Loaded by every agent; the scarcest budget.
3. **Situational** — schema `instructions` for the card types in play, `.claude/rules/` path globs, the per-turn `<chat-app>` snapshot.
4. **On-demand** — skill bodies, `docs/generated/*`, guide cards the agent is pointed at.

**Skills are two things at once:** the `description` is always-loaded (it's the trigger) and must be pure routing — no mechanics; the body is on-demand and owns its domain's mechanics. A guide mention of a skill's domain is usually the first overlap — the description *is* the pointer.

**The guide/skill boundary is read vs. write:** the always-loaded guide keeps the query surface (`cb calendar [timespan]`); the skill owns authoring mechanics (VTIMEZONE, conflict resolution).

## Principles

- **One home per concept.** ABOUT_CARDS/PROVENANCE own card concepts; a schema's `instructions` own that type's fields; a skill owns its domain. Everything else *points*, via the `SECTION` registry (`agent-guide/sections.ts`) so references can't drift from headings. Re-teaching is the disease; per-section drift is how prompts rot.
- **Deliberate duplication only.** The Laws may restate what a mechanics section carries — high-stakes, high-drift rules earn it. Anything else stated twice is a bug: fix at the canonical home, make the other site defer.
- **Judge cost-per-bit, not correctness alone.** Always-loaded words are the scarcest resource. A 39-line list where every line says the same thing (the old CARD_TYPES) is "correct" and still a bug. Cut what the agent can infer or load on demand.
- **Corrective framing where the model's prior is wrong.** "Cards are not XML; anything that says so is stale" inoculates; a neutral description doesn't. State the wrong default and correct it.
- **No archaeology, no dated status claims.** "now", "legacy", "replaced the old…", "not wired into X yet" address agents with stale priors (none exist) and become lies when the system moves. Phrase timelessly; describe behavior, not project status.
- **Check for self-contradiction.** Two statements about the same signal must agree ("absence means all healthy" vs "don't treat absence as all-clear" survived in one bullet). Read each section asking: does any sentence undercut another?
- **Examples do double duty.** Every example shows the mechanics AND models good behavior (real fields, honest values, the judgment call inline). No padding examples.
- **Role before mechanics.** Lead surfaces open with identity ("a personal workspace where the filesystem is state, Git is history, and you do the work") so every rule after it has a why.
- **Verify claims against code.** A prompt asserting a trailer, flag, or field that code doesn't emit is worse than silence. Audit prompt claims against the implementation; add `src/dev/knowledge-audits.yaml` entries for conventions agents must retain (`pnpm knowledge-audit`).
- **Never hardcode personal values** — resolve real per-box values (timezone, names) at `cb init` generation time instead of baking a sample into shared prose.

## Review pass, in order

1. Render the stacks (`agent-context` per situation) and read each end-to-end *as the agent*.
2. Hunt: overlap (same concept taught twice), contradiction, dated language, claims unverified against code, weight (cost-per-bit), missing role framing.
3. Fix at the canonical home; turn the duplicate sites into cross-references (`SECTION` / `xref`).
4. Re-render; compare layer word counts before/after.
5. New conventions get knowledge audits; run them before calling the work done.
6. Re-run `cb init` on live boxes so the change actually ships.

Prior art: `callback-box/docs/plans/prompt-surface-ia-review.md` is the worked example of a full-surface review (what was found, what each fix traded against). `callback-box/docs/prompt-audits.md` is the full lens catalog to work through during the "hunt" step above.

## Invariants: session/prompt cache

Two things any prompt-surface edit has to respect:

- The system prompt must stay time-invariant (no timestamps, no per-turn values) — the warm session-subprocess pool only reuses a prewarmed subprocess when the system prompt is byte-identical across turns.
- Resumed sessions never re-send the system prompt, so an edit to the prompt surface is invisible to an already-open thread until its session resets.
