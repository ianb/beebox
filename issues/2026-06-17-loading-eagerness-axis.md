---
needs: [design]
area: callback-box
---

# Where self-authored instructions live — the loading-eagerness axis

When the boxholder agent learns something durable and writes it down as
*instructions* (akin to CLAUDE.md), where should it land? Today the only home
is CLAUDE.md, which has one property that's both its value and its trap: Claude
Code auto-loads it natively. The real design question is a single axis — **how
eagerly is a piece of self-authored guidance loaded into context** — and the box
should route guidance onto the right tier rather than letting everything pile
into the always-on one.

The tiers, cheapest-to-load last:

- **Always-on** — root `CLAUDE.md` + the generated `agent-guide.md`. Paid for on
  *every* turn. This is where unbounded growth hurts most; a too-large always-on
  file silently crowds out the task and models start dropping instructions past
  ~200–300 lines. (A soft size lint on box CLAUDE.md files now guards this tier —
  `src/core/claude-md-lint.ts` — but a guardrail isn't a router.)
- **Path-scoped, lazy** — nested `CLAUDE.md` (auto-loads as the agent traverses
  into a directory) and `.claude/rules/*.md` with glob frontmatter (auto-loads
  when the agent touches a matching file — exactly how `init-rules.ts` turns each
  card type's `instructions` into a `card-<type>.md` rule). Loads only when you're
  working *near* the relevant files.
- **Task-scoped, lazy** — skills. Surfaced by their `description` and loaded on
  demand when the *task* matches; **not directory-scoped** — global to the
  session, lazy, heavier to author than a paragraph in CLAUDE.md.

Two sub-ideas that turn out to be the same question from opposite ends:

1. **A card type for instructions.** Self-written instructions (akin to
   CLAUDE.md) marked as a distinct, validated type — so they're auditable as
   agent-authored guidance, listable, and reachable by tooling (e.g. the size
   lint, freshness checks). **Caveat:** marking something a card *type* is
   orthogonal to *loading*. CLAUDE.md's whole value is native auto-load; a card
   wouldn't reach context unless wired into assembly — most likely via the
   path-scoped `.claude/rules/` machinery the box already generates from schema
   `instructions`. So a type buys audit/validation/listing, but you still pick a
   loading mechanism underneath it.
2. **Be more eager to mint skills.** Good instinct *for procedural knowledge*
   ("when you're doing this kind of task, here's how") — it moves guidance off
   the always-on tier into something that costs nothing until triggered. But
   skills are global and heavier to author, so they're overkill for a one-line
   "remember X about this directory," which wants a nested CLAUDE.md or a rule.

Natural mapping: *"when you're working **here**, know this"* → nested CLAUDE.md /
a path-scoped rule; *"when you're doing **this kind of task**, here's the
procedure"* → a skill; *"this is always true about this box"* → root CLAUDE.md
(kept lean). The real artifact worth building is a **router** — guidance the
agent gives the boxholder on which tier a new durable instruction belongs on,
analogous to the memory-writing guidance above (which routes *facts*; this routes
*instructions*). Open questions: does the instructions-type earn its keep over
just-use-a-rule; should the box actively *suggest* promoting an oversized
CLAUDE.md section into a rule/skill when the size lint fires; how does this
interact with `agent-guide.md` generation (another always-on consumer).
