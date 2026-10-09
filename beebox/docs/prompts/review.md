# Prompt surface review

Rendering what an agent actually reads, the layering model, the structural rules, and the review pass in order.

## What it is

The workflow for reviewing or engineering beebox's agent-facing prompt surface — the agent guide, chat/reactor system prompts, schema instructions, box skills, and rules. Read this when auditing the assembled prompt stack for overlap/redundancy/staleness/contradiction, checking what an agent actually sees in some situation, or after any change to prompt-generating code. [Prompt lenses](lenses.md) is the companion lens catalog for the hunt step. (For routing a single new instruction to the right box surface, use the `bbx-context` skill.)

The prompts are how every agent comes to understand Bee Box — what it is, what its role is, what the rules are. They are generated code (`src/core/agent-guide/`, `src/core/chat/session/prompts.ts`, `src/core/reactor/prompts.ts`, schema `instructions`, `src/core/box/guidance-sync/skills-content.ts`), assembled into a per-situation context stack. Review the *assembled stack*, not the source files: judge what an agent actually reads, end to end.

## See the assembled context

```bash
cd beebox
pnpm agent-context --list                                  # the known situations
pnpm agent-context chat --box ~/src/boxes/test1            # full chat stack, layer by layer
pnpm agent-context reactor --box ~/src/boxes/test1 --card-type recipe
pnpm agent-context chat --box ~/src/boxes/test1 --skill calendar --output scratch/ctx.md
```

Each report shows every layer with its loading class and word count, plus the always-loaded total. `pnpm prompt-report` is the complementary flat *inventory* of every prompt in the system; `agent-context` is the per-situation *composition*.

**Boxes go stale.** The box-side layers (AGENTS.md, agent guide, skills, rules) are what `bbx init` last wrote — re-run `bbx init` on the box after changing generator code, or the report shows the old world. That staleness being visible is a feature, not a bug.

## The layering model

Every agent's context is a stack; each layer has a loading class:

1. **Identity prompt** (always) — per situation: chat, chat-thread, reactor, procedure. Says what the agent *is* and covers only that situation's surface.
2. **Box knowledge** (always) — box AGENTS.md → compiled briefing + the agent guide. Loaded by every agent; the scarcest budget.
3. **Situational** — schema `instructions` for the card types in play, `.claude/rules/` path globs, the per-turn `<chat-app>` snapshot.
4. **On-demand** — skill bodies, the package docs (`node_modules/beebox/box-docs/*`) and box-compiled docs (`_content/docs/generated/*`), guide cards the agent is pointed at.

### Skills: description and body

**Skills are two things at once:** the `description` is always-loaded (it's the trigger) and must be pure routing — no mechanics; the body is on-demand and owns its domain's mechanics. A guide mention of a skill's domain is usually the first overlap — the description *is* the pointer. Name a skill rather than its `SKILL.md` path: a Read of the file and an invocation each load the body, so the agent can pay for it twice.

### The guide/skill boundary

**The guide/skill boundary is read vs. write:** the always-loaded guide keeps the query surface (`bbx calendar [timespan]`); the skill owns authoring mechanics (VTIMEZONE, conflict resolution).

## Principles

- **One home per concept.** ABOUT_CARDS/PROVENANCE own card concepts; a schema's `instructions` own that type's fields; a skill owns its domain. Everything else *points*, via the handle registry (`agent-guide/ledger.yaml`, read by `section()`/`xref()` in `agent-guide/sections.ts`) so references can't drift from headings. Re-teaching is the disease; per-section drift is how prompts rot.
- **Deliberate duplication only.** The Laws may restate what a mechanics section carries — high-stakes, high-drift rules earn it. Anything else stated twice is a bug: fix at the canonical home, make the other site defer.
- **Role before mechanics.** Lead surfaces open with identity ("a personal workspace where the filesystem is state, Git is history, and you do the work") so every rule after it has a why.
- **Verify claims against code.** A prompt asserting a trailer, flag, or field that code doesn't emit is worse than silence. Audit prompt claims against the implementation; add `src/dev/knowledge-audits.yaml` entries for conventions agents must retain (`pnpm knowledge-audit`).
- **Never hardcode personal values** — resolve real per-box values (timezone, names) at `bbx init` generation time instead of baking a sample into shared prose.

What a review hunts for (cost per bit, corrective framing, dated language,
self-contradiction, examples that earn their place) is in the
[lens catalog](lenses.md).

## Writing rules that get followed

The [lens catalog](lenses.md) covers giving reasons, earning examples, and separating hard rules from defaults. In addition:

- **Write it down on the right tier.** An unwritten convention cannot be followed, and a rule on the always-on tier that only sometimes applies dilutes the rest (route with the `bbx-context` skill).
- **Point at a real example by path.** It is shorter and less ambiguous than prose, and it does not drift the way a pasted copy does.
- **Altitude matches use.** A rarely used command gets a reference entry and at most one pointer sentence on an always-on surface. Never mention environment variables the harness always sets.
- **Pointers, not copies.** Never paste content that changes on its own (a schema, a list, command output); point at its source.

When a rule on the correct tier is still ignored, the agent is usually rationalizing past it:

- **Bulletproof it.** Name the excuse and rebut it inline. "Never paraphrase the user" held only after it named the temptation ("it basically says the same thing") and called that the violation.
- **Pressure-test it.** Add a knowledge-audit scenario that gives the agent a tempting reason to break the rule and confirms it refuses.
- **Elevate only the inviolable.** A truly inviolable rule moves into The Laws (the `## THE_LAWS` section of `src/core/agent-guide/guide.md`): placed first, framed as law, bulletproofed, and pressure-tested. Do not bold it in place. Elevating a rule that is not inviolable recreates the emphasis-dilution problem one tier up.

## Review pass, in order

1. Render the stacks (`agent-context` per situation) and read each end-to-end *as the agent*.
2. Hunt: overlap (same concept taught twice), contradiction, dated language, claims unverified against code, weight (cost-per-bit), missing role framing. [Prompt lenses](lenses.md) is the full lens catalog for this step.
3. Fix at the canonical home; turn the duplicate sites into cross-references (`SECTION` / `xref`).
4. Re-render; compare layer word counts before/after.
5. New conventions get knowledge audits; run them before calling the work done.
6. Re-run `bbx init` on live boxes so the change actually ships.

Prior art: [plans/prompt-surface-cleanup-evaluation.md](../plans/prompt-surface-cleanup-evaluation.md) is the worked example of a full-surface review (what was found, what each fix traded against).

## Invariants: session/prompt cache

Two things any prompt-surface edit has to respect:

- The system prompt must stay time-invariant (no timestamps, no per-turn values) — the warm session-subprocess pool only reuses a prewarmed subprocess when the system prompt is byte-identical across turns.
- Resumed sessions never re-send the system prompt, so an edit to the prompt surface is invisible to an already-open thread until its session resets.
