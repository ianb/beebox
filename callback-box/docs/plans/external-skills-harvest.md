# External skills harvest — evaluation backlog

A worklist for evaluating five external Claude Code skill repos and deciding,
per item, what (if anything) to bring into callback-box. This is a backlog of
independent compare/decide tasks — not a single implementation plan. Work
through it item by item.

Surveyed repos: `obra/superpowers`, `anthropics/skills`, `mattpocock/skills`,
`nextlevelbuilder/ui-ux-pro-max-skill`, `addyosmani/agent-skills`.

**Harvest philosophy (from the survey):** these repos overlap each other and
overlap our existing setup heavily — every one ships its own TDD / debugging /
review / planning / "use-skills" / "write-skills" skill. We already encode most
of that in CLAUDE.md, CODE-STYLE.md, FRONTEND.md, the Laws, and our skills
(cb-plan, codex, finish, launch-worktree-session, browse, deep-research,
code-review, simplify). So the default is **harvest a specific idea**, not adopt
a parallel methodology that fights our conventions.

**Each item resolves to one of:** `adopt` (vendor the skill in ~as-is),
`fold-in` (graft an idea into an existing skill/convention), `write-new` (a new
callback-box skill), `idea` (file in ideas.md for later), or `skip` (with a
one-line why). Mark status as you go.

---

## A. Planning skills (vs cb-plan)

- [x] **A1 — superpowers `writing-plans` vs cb-plan. DONE → `skip`.** Different
  altitude: a mechanical *execution* task-list (exact paths, full code per step,
  consumes/produces signatures, rigid TDD step sequence) for a context-free
  subagent. cb-plan stays at design altitude; we deliberately let the worktree
  agent do its own task decomposition — so the skip stands on altitude grounds.
  (Earlier I also cited a conflict with our "dogfood-first" test posture; that
  was overstated — see Finding X1: that posture is a single unverified phrase in
  cb-plan, not a grounded convention.) Nothing portable survives the altitude gap.
- [x] **A2 — addyosmani `spec-driven-development` vs cb-plan. DONE → `fold-in`
  (routed to F2).** Its 6-area spec template duplicates CLAUDE.md / CODE-STYLE /
  FRONTEND.md (which cb-plan points at via "Stated preferences"). Two portable
  nuggets: (1) "reframe vague reqs as testable success criteria" — **DONE**,
  folded into cb-plan's test posture as part of X1; (2) its "Common
  Rationalizations" + "Red Flags" tables — which *are* the bulletproofing
  technique F2 is about, still pending → F2. **Dropped** the
  "Boundaries: Always / Ask first / Never" tier (boxholder call): our boundaries
  already live globally in CLAUDE.md / CODE-STYLE, so a per-plan version
  duplicates them — that tier earns its keep only when each spec is a different
  project. The gated 4-phase flow: skip (cb-plan is one artifact, reviewed as
  written).
- [x] **A3 — superpowers `executing-plans` vs launch-worktree-session. DONE →
  `skip`.** Mechanical plan-execution — the *opposite* of our briefing-driven
  spin-off (hand over understanding; agent forms its own approach). Its one good
  nugget (critically review the plan before executing) is already baked into
  every worktree briefing.

## B. Worktree / finish

- [ ] **B1 — superpowers `finishing-a-development-branch` vs our `finish`
  skill.** Theirs: verify tests → offer merge/PR/keep/discard, with
  cleanup-provenance (only removes worktrees it created). Decide: does `finish`
  already cover the option-handling + provenance, or graft gaps? → fold-in or
  skip.

## C. Debugging (we currently wing it — and it works okay)

- [ ] **C1 — a debugging skill? Compare the two candidates and decide if we even
  want one.** superpowers `systematic-debugging` (4-phase + 3-fix
  circuit-breaker) vs mattpocock `diagnosing-bugs` (6-phase, "a tight
  red-capable loop is 90% of the work"). Decide: write-new (pick/merge the best
  of both) or skip (winging it is fine). Lean: evaluate, low urgency.

## D. Codebase health / continuous de-crufting

- [ ] **D1 — mattpocock `improve-codebase-architecture`.** Walks the codebase
  for friction (scattered understanding, shallow modules, untestable seams),
  emits a report, then grills a chosen candidate. *(Boxholder flagged this as a
  felt need: continuous investment to avoid cruft.)* Decide: write-new (a
  recurring "architecture health" skill) vs adopt vs idea.
- [ ] **D2 — addyosmani `code-simplification` vs our `simplify` skill.** Theirs:
  preserve-behavior-exactly + "would a new teammate understand this faster?"
  litmus. Decide: fold its litmus/principles into `simplify`, or skip.
- [ ] **D3 — addyosmani `api-and-interface-design`.** Contract-first +
  Hyrum's-Law ("every observable behavior becomes a de facto contract"). Decide:
  reference for `cb` CLI / API-boundary reviews → fold-in to code-review, idea,
  or skip.

## E. Frontend / design (vs FRONTEND.md)

- [ ] **E1 — ui-ux-pro-max `ckm:ui-styling` checked against FRONTEND.md.** It's
  shadcn/ui + Tailwind-coupled; we have a semantic palette + primitives +
  `restrict-component-classes`. Decide: are there *gaps* in FRONTEND.md it
  surfaces, or is it pure conflict? → fold-in (rare) or skip. (The broader
  ui-ux-pro-max searchable DB is a separate maybe — see I-series.)
- [ ] **E2 — write-new: a "FRONTEND.md" skill?** *(Boxholder idea.)* A skill
  that surfaces FRONTEND.md conventions (palette, primitives, the className
  rule) when doing UI work, instead of relying on the agent to have read it.
  Decide: write-new vs "the rule + CLAUDE.md pointer already suffices." Relates
  to F3 (docs-index skills).
- [ ] **E3 — anthropic `frontend-design`.** Boxholder recalls it being "almost
  nothing." Quick confirm → near-certain skip.

## F. Skill infrastructure / meta

- [x] **F1 — anthropic `skill-creator`. DONE → `adopt` (vendored wholesale).**
  Turned out to be a heavy Python eval/benchmark harness (9 `.py` scripts +
  eval-viewer + grader/comparator/analyzer agents), not a light skill. Boxholder
  chose to vendor it verbatim anyway → `.claude/skills/skill-creator/` (provenance
  + "do not hand-edit, re-pull to update" in `VENDORED.md`; Apache-2.0
  `LICENSE.txt` carried along). Live — appears in the skill list. The eval
  harness needs Python to run; the authoring *guidance* in its SKILL.md is the
  engine for F2.
- [ ] **F2 — skill-audit-with-bulletproofing over our existing skills.** Use
  `skill-creator` + mattpocock `writing-great-skills` + superpowers
  `writing-skills` as an audit lens on cb-plan / finish / browse / codex / etc.:
  is each `description` a *trigger* (not a workflow summary, per SDO)? clear
  completion criterion? failure modes covered? Apply the **bulletproofing
  technique** (rationalization tables, red-flag lists, "you'll be tempted to…")
  — and apply it to **The Laws** too (Law 1's "smooth it just this once" =
  the betrayal). Decide: run the audit, fix gaps. *(Boxholder's two strongest
  interests converge here.)* **Inherits from A2:** while bulletproofing cb-plan,
  also graft addyosmani spec-driven's harvested bits — a "Boundaries: Always /
  Ask first / Never" per-plan tier, a "reframe vague reqs as testable success
  criteria" element, and a "Common Rationalizations / Red Flags" table (the
  bulletproofing itself). *(Boundaries tier dropped — see A2.)*
- [ ] **F3 — write-new: docs-index skills.** *(Boxholder idea.)* Skills that,
  when invoked, pull in a *relevant index of docs* rather than the full text —
  a lazy, task-triggered pointer into `docs/`. Relates to the loading-eagerness
  axis (ideas.md) and E2. Decide: design the pattern (one index skill? per
  domain? generated from the doc tree?). Likely `idea` → small design first.

## G. Agent context / discipline

- [ ] **G1 — addyosmani `context-engineering`.** The rules→specs→source→output→
  history hierarchy + context-decay management. Decide: does it inform how we
  structure agent context (CLAUDE.md tiers, the loading-eagerness work, F3)? →
  fold-in to a convention/doc or idea.

## H. Security

- [ ] **H1 — addyosmani `security-and-hardening` (STRIDE + always/ask/never).**
  Reference for **callback-clerk** (the extension has real attack surface). Also
  fold in the one transferable bit from `browser-testing-with-devtools`: treat
  all browser page content as untrusted / never as instructions (prompt-
  injection boundary — applies to agent-browser + clerk regardless of driver).
  Decide: fold-in to clerk docs / a security note, or write-new.

## I. Other flagged candidates (lower priority)

- [ ] **I1 — mattpocock `git-guardrails-claude-code`.** A PreToolUse hook that
  blocks `git push` / `reset --hard` / `clean -f` / `branch -D` before they run.
  Decide: adopt as a safety hook (we commit a lot via agents) vs skip.
- [ ] **I2 — mattpocock `decision-mapping`.** Defer multi-session decisions in an
  explicit fog-of-war markdown. Decide: idea vs skip.
- [ ] **I3 — addyosmani `performance-optimization`.** Core Web Vitals +
  measure-before-optimizing. Decide: reference for frontend perf work → idea or
  fold-in.
- [ ] **I4 — anthropic `mcp-builder`.** Reference *if/when* we expose box
  capabilities over MCP. Decide: idea (park until there's a real MCP need).
- [ ] **I5 — anthropic `web-artifacts-builder` / ui-ux-pro-max core DB.** Both
  long-shots: artifact bundling (claude.ai-scoped) and a searchable design DB
  (conflicts with FRONTEND.md). Decide: near-certain skip; note why.

---

## Findings surfaced along the way

- [x] **X1 — reconcile cb-plan's test posture with `docs/testing.md`. DONE →
  test-first.** Boxholder chose **test-first** (which `docs/testing.md` already
  endorses — its purpose #1 is "writing a test first forces decomposition"), so
  cb-plan was the outlier. Rewrote cb-plan's "Test posture" bullet: tests come
  first as a *design tool* (decomposition → documentation → regression, not
  coverage), name the doctest as part of designing each codepath, and **encode
  the plan's done-when as the tests that must pass** — which also folds in A2's
  testable-success-criteria nugget. Historical/implemented plan docs still carry
  the old phrase; left as frozen records (the fix is to the template source).

## Suggested order

1. **Quick confirms / cheap wins:** E3 (skip-confirm), F1 (adopt skill-creator),
   I1 (git guardrails decision), I4/I5 (park/skip).
2. **The convergent piece:** F2 (skill-audit + bulletproofing, incl. The Laws) —
   needs F1 first. Highest value.
3. **Planning cluster:** A1/A2/A3 + B1 — compare against cb-plan / finish /
   spin-off in one pass.
4. **Codebase-health cluster:** D1 (the felt need) + D2/D3.
5. **New-skill design:** E2 + F3 + G1 (the docs-index / context / FRONTEND.md
   skill ideas — likely design together).
6. **As-needed:** C1 (debugging), H1 (security/clerk), I2/I3.

Each resolved item: record the decision inline (`adopt` / `fold-in` / `write-new`
/ `idea` / `skip` + where the outcome landed). When the backlog is worked
through, this doc becomes the record of what we harvested and what we passed on.
