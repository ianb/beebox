---
name: cb-codehealth
description: Use for a deliberate codebase-health pass — when cruft has accumulated, an area feels tangled or hard to test, you're about to make a big change in a messy area, or cb-debug's circuit-breaker flagged the architecture. Surfaces deepening opportunities and dead code; not every-refactor cleanup. Triggers include "codebase health", "this feels crufty/tangled", "reduce cruft", "is this architecture okay", "de-cruft X".
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# cb-codehealth

A recurring pass to keep the codebase **deep, testable, AI-navigable, and free
of accumulating cruft**. Code is a *liability*, not an asset — every line has
ongoing cost (bugs, deps, onboarding), so this is the discipline of paying that
debt down on purpose, a bit at a time. Not a one-shot cleanup, and not every
refactor (normal cleanup-as-you-go + the `simplify` skill cover those) — a
deliberate health pass you run when cruft has built up or an area resists change.

## The aim — deep modules

A **deep module** hides a lot of behaviour behind a small interface, placed at a
clean **seam**, testable through that interface. **Shallow** is the enemy:
interface nearly as complex as the implementation. Depth buys **leverage** for
callers (more capability per unit of interface they learn) and **locality** for
maintainers (change, bugs, and verification concentrate in one place). Use this
vocabulary *exactly* — module / interface / implementation / depth / seam /
adapter / leverage / locality — not "component / service / API / boundary."

**The deletion test** (your sharpest probe): would deleting this *concentrate*
complexity or just *move* it? "Concentrates" means it earns its keep; a thing
you could delete by smearing its job across callers was shallow.

## 1. Scan for friction

**Run our tooling first — these are concrete, runnable signals, not vibes:**

- `pnpm lint:knip` — **dead code** (unused files, exports, deps). The clearest
  "code is a liability" hit; removing it is free health. (knip also enforces
  "only export what's used.")
- `pnpm lint:circular` — value import cycles (madge). Tangled seams; type-only
  cycles are fine.
- `pnpm lint:oxlint` — useless spreads, identical ternary branches, ambiguous
  constructors, and other structural smells.
- Files near the 300-line cap / functions near 150 — pressure to split *by
  responsibility* (things that change together live together), not by layer.

**Then explore organically** — use `Agent` (`subagent_type=Explore`) over the
suspect subsystems; don't follow rigid heuristics, note where *you* feel
friction:

- Understanding one concept requires bouncing between many tiny modules.
- A module is **shallow** — apply the deletion test.
- A pure function was extracted *only* for testability, but the real bugs hide in
  how it's called (no **locality**) — that's a shallow split, not a deep module.
- Tightly-coupled modules leak across their seams.
- A part is untested or hard to test *through its current interface*.
- Tech-debt markers the code already admits ("older raw routes are tech debt —
  migrate when you touch the area"), duplicated logic, or routinely-noisy command
  output (a bug per CLAUDE.md, not background).

Read `docs/glossary.md` for the domain's real names; don't re-litigate decisions
already recorded in `docs/implemented-plans/`.

## 2. Report candidates (Markdown, not a repo artifact)

Summarize in chat (or a `scratch/` file) — **no HTML, no new repo files.** Per
candidate:

- **Files** — what's involved.
- **Problem** — the friction, in depth / seam / locality terms.
- **Deepening** — what would change, plain English (don't design the full
  interface yet).
- **Why** — the payoff in leverage + locality, and how testing improves.
- **Strength** — `Strong` / `Worth exploring` / `Speculative`.

End with a **Top recommendation**: which one you'd tackle first, and why.

## 3. Pick one → plan it → ship it

The boxholder picks. Then design the deepening properly — **don't free-hand a big
refactor:**

1. **`cb-plan`** it — the design altitude (what reuses, what can fail, what's
   NOT in scope). One deepening per plan; don't bundle candidates.
2. **`launch-worktree-session`** to execute it in isolation.

When you change a module, remember **Hyrum's Law**: every observable behaviour —
error text, ordering, timing, undocumented quirks — is a *de facto contract* once
something depends on it. Be intentional about what the new interface exposes;
"safe" changes can still break a caller relying on old behaviour, so tests alone
aren't a guarantee. Removing dead code means removing the code **and** its tests,
docs, and config — not just the code.

## Principles when deepening

- **Preserve behaviour exactly** when simplifying — change *how* it's expressed,
  never *what* it does (same inputs, outputs, side effects, ordering, errors).
- **Clarity over cleverness** — litmus: *"would a new teammate understand this
  faster than the original?"* If not, it's not simpler.
- **Shrink the interface, not the implementation** — fewer methods, simpler
  params, more complexity *hidden inside*. Depth, not surface.
- **One adapter = a hypothetical seam; two = a real one.** Don't introduce the
  interface until a second implementation actually exists.
- **Follow project conventions** — make code consistent with its neighbours, not
  with an external ideal.
- **Maintain balance** — don't over-abstract or simplify clean code; scope to
  what's genuinely crufty.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "It works, leave it." | Working ≠ healthy. Cruft compounds silently; this pass is the deliberate paydown before it forces a rewrite. |
| "I'll extract a pure function for testability." | If the bug hides in *how it's called*, you've added a shallow module and lost locality. Deepen the real seam, don't shave a helper off. |
| "More files = cleaner." | Not if you bounce between them to understand one concept. Split by responsibility; things that change together live together. |
| "One adapter, let me add the interface now." | One adapter is a hypothetical seam. Wait for the second before abstracting — premature interfaces are their own cruft. |
| "While I'm here, I'll simplify all of it." | Scope to the cruft. Churning clean code adds review burden and risk for no health gain. |
| "Tests pass, the refactor is safe." | Hyrum's Law: a caller may depend on behaviour no test covers. Be intentional about the interface; don't assume green = safe. |

## Red flags — you're shaving, not deepening

"Extract this for testability" (when the bug is in the caller) · proposing an
interface for a single implementation · splitting a file just to get under the
line cap (rather than by responsibility) · bundling three refactors into one ·
"simplifying" code that was already clear · deleting code without deleting its
tests/docs/config.
