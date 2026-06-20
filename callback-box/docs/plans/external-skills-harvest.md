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

- [x] **B1 — superpowers `finishing-a-development-branch` vs our `finish`.
  DONE → `skip`.** `finish` is more opinionated + deeper-integrated (ship by
  merge-to-main → auto-deploy; no PRs) and its test gate is stronger (the
  "NEVER acceptable" + anti-rationalization; and because it pulls main into the
  worktree *before* testing, the tested tree == what fast-forwards onto main).
  Theirs adds a 4-option menu (merge/PR/keep/discard) that's N/A for our
  merge-only model, and mechanical worktree-removal pitfalls (cd-to-main-root
  before remove, prune after, merge-before-branch-delete, provenance) — **all
  already handled by `.claude/hooks/session-end.sh`, more robustly** (it also
  survives an interrupted mid-removal). Nothing to fold. Its Common-Mistakes /
  Red-Flags structure is another bulletproofing example → F2.

## C. Debugging (we currently wing it — and it works okay)

- [x] **C1 — a debugging skill. DONE → `write-new`: `cb-debug`.** Merged the
  best of both into `.claude/skills/cb-debug/SKILL.md`: mattpocock's "the
  feedback loop *is* the skill" (tight, red-capable signal first) as the spine,
  superpowers' Iron Law (no fix without root cause) + the 3-fix circuit-breaker
  (3 failures = wrong architecture → boxholder). Made the loop menu
  callback-box-native (doctests-as-loop-and-regression per our test-first stance,
  `cb scenario`, curl the router / Fastify `inject()`, `bin/browse`,
  `client-debug.log`, knowledge-audits for agent-behavior bugs, git-as-history),
  scoped to **hard bugs only** (winging the easy ones is fine — boxholder's
  note), and applied the F2 discipline (trigger-only SDO description +
  rationalizations table + red flags). Added (boxholder) a **"search the web for
  known library/platform quirks"** section — the under-used move for bugs in
  someone else's code (deps, browser APIs, ESM/CJS, runtimes), with this
  session's `canvas.toBlob`/macOS-timers/ESM examples. The circuit-breaker hands
  off to D1 (codebase-health) when that lands.

## D. Codebase health / continuous de-crufting

- [x] **D1 — mattpocock `improve-codebase-architecture`. DONE → `write-new`:
  `cb-codehealth`.** Built `.claude/skills/cb-codehealth/SKILL.md` — a recurring
  health pass. Spine = the deepening-opportunities framing + the deletion test +
  the depth vocabulary (module/interface/depth/seam/adapter/leverage/locality,
  from `codebase-design`). **Dropped** the HTML/Tailwind/Mermaid report (→
  Markdown), the CONTEXT.md/ADR coupling (→ `docs/glossary.md` + git history +
  `docs/implemented-plans/`), and the grilling/codebase-design/domain-modeling
  skill chain (→ pick a candidate, `cb-plan` it, `launch-worktree-session`).
  Native killer angle: the scan *runs* our existing de-cruft tooling
  (`lint:knip` dead code, `lint:circular` madge, `lint:oxlint`, the 300-line
  caps). Lands `cb-debug`'s circuit-breaker handoff. F2 discipline applied.
- [x] **D2 — addyosmani `code-simplification`. DONE → `fold-in` (cb-codehealth).**
  Its "Principles when deepening" section carries the keepers: preserve-behaviour-
  exactly, "would a new teammate understand this faster?" litmus, clarity over
  cleverness, follow project conventions, maintain balance / scope to the cruft.
  Our `simplify` skill stays for inline cleanup; cb-codehealth is the deliberate
  pass.
- [x] **D3 — addyosmani `api-and-interface-design`. DONE → `fold-in`
  (cb-codehealth).** Folded **Hyrum's Law** ("every observable behaviour — error
  text, ordering, timing — is a de facto contract; tests alone aren't a safety
  guarantee") + "shrink the interface, not the implementation" into the deepening
  principles + a rationalization. Also harvested deprecation-and-migration's
  "code is a liability" framing + "delete the tests/docs/config too." (No
  standalone API skill — the seam/contract discipline lives where modules get
  reshaped.)

## E. Frontend / design (vs FRONTEND.md)

- [ ] **E1 — ui-ux-pro-max `ckm:ui-styling` checked against FRONTEND.md.** It's
  shadcn/ui + Tailwind-coupled; we have a semantic palette + primitives +
  `restrict-component-classes`. Decide: are there *gaps* in FRONTEND.md it
  surfaces, or is it pure conflict? → fold-in (rare) or skip. (The broader
  ui-ux-pro-max searchable DB is a separate maybe — see I-series.)
- [x] **E2 — write-new: a behavioral frontend skill. DONE → `write-new`:
  `cb-frontend`.** Boxholder's split: FRONTEND.md **stays as the reference
  catalog** (palette, primitive index, the `className` rule); the new skill is
  the *behavioral* half it can't enforce, and points at FRONTEND.md rather than
  duplicating it. Built `.claude/skills/cb-frontend/SKILL.md` (smallish, as
  asked), harvesting the portable discipline from addyosmani
  `frontend-ui-engineering`: reach-for-primitives-first + semantic-palette-only
  (mapped to our `restrict-component-classes` rule), compose-over-configure,
  separate data from presentation (so the three states can't be forgotten),
  one-job-per-component (tied to our 300-line cap), the simplest-state ladder
  (mapped to URL state + tRPC/`useWSS`, not React Query), the
  loading/empty/error trio (mapped to skeletons + `client-debug.log` +
  `StatusBadge`), the WCAG-AA baseline (keyboard, labels, contrast, focus,
  not-color-alone), and "avoid the AI aesthetic." Two callback-box-native
  anchors the source lacked: **components own their own a11y landmarks** (memory
  `feedback_components_own_a11y`) and **verify in a real browser via `bin/browse`
  + report visible errors** (memories `feedback_report_visible_errors`,
  the `browse` skill). F2 discipline applied (trigger-only SDO description +
  rationalizations table + red flags). Relates to F3 (docs-index skills) — this
  is the "skill that fronts a reference doc" pattern in the concrete.
- [x] **E3 — anthropic `frontend-design`. DONE → `skip`.** Confirmed the
  boxholder's recollection: ~55 lines of greenfield *visual-design* process
  (pick fonts, establish a palette, set up tokens from scratch) for a project
  with no design system. callback-box already has one (semantic palette +
  primitives + FRONTEND.md), so the whole skill is N/A — nothing portable that
  cb-frontend doesn't already cover behaviorally.

## F. Skill infrastructure / meta

- [x] **F1 — anthropic `skill-creator`. DONE → `adopt` (vendored wholesale).**
  Turned out to be a heavy Python eval/benchmark harness (9 `.py` scripts +
  eval-viewer + grader/comparator/analyzer agents), not a light skill. Boxholder
  chose to vendor it verbatim anyway → `.claude/skills/skill-creator/` (provenance
  + "do not hand-edit, re-pull to update" in `VENDORED.md`; Apache-2.0
  `LICENSE.txt` carried along). Live — appears in the skill list. The eval
  harness needs Python to run; the authoring *guidance* in its SKILL.md is the
  engine for F2.
- [x] **F2 — skill-audit-with-bulletproofing over our existing skills. DONE.**
  Planned at `docs/plans/` (approved). Outcomes:
  - **SDO descriptions trimmed to triggers-only** for `finish` (was spelling out
    the whole merge flow — highest risk), `cb-plan`, `codex`, `browse`. All
    trimmed prose already lived in the skill bodies. `launch-worktree-session`
    left as-is (already trigger-first).
  - **The Laws / Law 1 bulletproofed** — added a "you will be tempted, every
    excuse is the betrayal in disguise" block (rebuts "basically what they said",
    "reads better cleaned up", "just the gist", "long ramble") + the genuine
    transcription exception. Verified: re-ran `law-never-paraphrase` (no
    regression) and added a **pressure-scenario audit** `law-paraphrase-pressure`
    ("just save the gist") — both pass `knows_directly`, 0 reads; the agent
    refuses the summary and offers quote-trimmed + framing outside the tag.
  - **cb-plan bulletproofing already existed** (its "Failure modes for this skill
    itself" section is the rationalization list, and the template already calls
    an open-question-in-the-first-chunk a missing decision) — so A2's
    rationalizations nugget was satisfied; just added the punchy "shortcuts
    you'll be tempted to take" framing. A2 nugget 1 (testable success criteria)
    already folded in X1. Boundaries tier dropped (see A2).
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
