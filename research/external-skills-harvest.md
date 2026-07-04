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
of that in CLAUDE.md, code-style.md, frontend.md, the Laws, and our skills
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
  frontend.md (which cb-plan points at via "Stated preferences"). Two portable
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

## E. Frontend / design (vs frontend.md)

- [x] **E1 — ui-ux-pro-max ckm skills vs frontend.md/cb-frontend. DONE →
  `skip` ckm:ui-styling; `fold-in` four tidbits from `ui-ux-pro-max`.** Surveyed
  the whole `nextlevelbuilder/ui-ux-pro-max-skill` repo:
  - `ckm:ui-styling` → **skip** (pure conflict): shadcn/ui + Radix + raw-Tailwind
    (`bg-white dark:bg-gray-900`, arbitrary values, dynamic class names) — the
    opposite of our semantic palette + primitives + `restrict-component-classes`.
  - `ckm:design-system` → **skip**: half token-architecture we already have
    (semantic roles in `tailwind.config.js`; `restrict-component-classes` already
    bans raw hex in components), half slide-deck generation. The three-layer
    primitive→semantic→component model isn't worth restructuring our two-layer
    palette for.
  - `design` / `brand` / `banner-design` / `slides` → **skip** by category
    (greenfield identity + visual-asset generation; N/A for our app).
  - The **searchable design DB** (161 palettes / 57 font pairings / 50 styles via
    a Python BM25 script) → **skip**: it's the *opposite* of "we have one design
    system" — this is the I5 conflict, now confirmed concrete.
  - **`ui-ux-pro-max`** (the main skill) is a strong UI/UX *review checklist*;
    most of it is iOS-HIG / Material / React-Native (we're desktop-first web), but
    **four web-applicable gaps in `cb-frontend` got folded in**: (1) a compact
    **"Motion, sparingly"** section (150–300ms, transform/opacity-only to avoid
    reflow, 1–2 elements, honor `prefers-reduced-motion`); (2) **heading
    hierarchy** (one h1/page, no level-skipping, level≠size — added to the a11y
    baseline); (3) **one primary action per area** (per region, not per screen — our screens are
    dashboard-style mishmashes; added to component structure);
    (4) a **forms** bullet (field primitives give label+error+helper; validate on
    blur, error below field, focus first invalid on submit — added to the
    three-states section). Rejected the rest as mobile/native-specific or
    conflicting with our one design system. Closes E1 + the I5 design-DB question.
- [x] **E2 — write-new: a behavioral frontend skill. DONE → `write-new`:
  `cb-frontend`.** Boxholder's split: frontend.md **stays as the reference
  catalog** (palette, primitive index, the `className` rule); the new skill is
  the *behavioral* half it can't enforce, and points at frontend.md rather than
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
  primitives + frontend.md), so the whole skill is N/A — nothing portable that
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

- [x] **G1 — addyosmani `context-engineering`. DONE → `write-new`: `cb-context`.**
  Boxholder's sharper framing: a context-engineering skill **targeted at the
  prompts given to boxes** (box `CLAUDE.md`, nested CLAUDE.md, `.claude/rules/`,
  schema `instructions`, box docs) — not the generic agent-context skill the
  source is. Built `.claude/skills/cb-context/SKILL.md` around the **loading-
  eagerness tier router** (ideas.md "Where self-authored instructions live" — which
  explicitly names a router as "the real artifact worth building"): a table
  mapping the *shape* of a durable instruction → the right tier (always-true →
  lean root CLAUDE.md; when-working-here → nested CLAUDE.md / path rule;
  per-card-type → schema `instructions` → auto `card-<type>.md` via
  `init-rules.ts`; big reference → box doc + pointer; procedure → box procedure).
  Same skill/reference split as cb-frontend: points at
  `docs/generated/reducing-claude-md.md` for the trimming playbook (the delete-
  this-line test) rather than restating it. Box-native verification spine =
  **knowledge audits** (`knows_directly`, 0 reads = it landed). Folded the
  portable bits of the source skill (attention-budget≠window, write-it-down-or-it-
  doesn't-exist, why-not-just-what, example-beats-prose, pointers-not-copies) and
  its **untrusted-content boundary** (inbound card/connector text is data, not
  directives — shares H1's prompt-injection surface). Noted accurately that boxes
  get **no skills installed** (rules + agent-guide are the box's lazy tiers). F2
  discipline (trigger-only description + rationalizations + red flags). Relates to
  F3 (this is the third concrete "skill fronts a reference doc" instance) — the
  shared pattern across cb-frontend/cb-context is worth naming when F3 is designed.

## H. Security

- [ ] **H1 — addyosmani `security-and-hardening` (STRIDE + always/ask/never).**
  Reference for **callback-clerk** (the extension has real attack surface). Also
  fold in the one transferable bit from `browser-testing-with-devtools`: treat
  all browser page content as untrusted / never as instructions (prompt-
  injection boundary — applies to agent-browser + clerk regardless of driver).
  Decide: fold-in to clerk docs / a security note, or write-new.

## I. Other flagged candidates (lower priority)

- [x] **I1 — mattpocock `git-guardrails-claude-code`. DONE → `skip`** (boxholder
  call). A narrow tailored hook (block the irreversible work-destroyers +
  force-push) was defensible and fits the project's mechanical-safeguard ethos,
  but for this repo the genuinely-scary action is commit-to-main (auto-deploys to
  prod), which can't be hook-blocked because it's the intended flow; plain
  `git push` is low-value (deploy is rsync, not push). Boxholder: "you're good at
  this, don't need extra instructions." Skip.
- [x] **I2 — mattpocock `decision-mapping`. DONE → `skip`** (nothing to harvest).
  Its core artifact (a compact git-tracked numbered-ticket map resolved
  one-per-session) is something we **already do informally** — the harvest
  backlog itself is one, `launch-worktree-session` is "one ticket = one session,"
  and cb-plan already has Subplans + Open-design-questions. Its skill machinery is
  wired to mattpocock's `/grilling` `/domain-modelling` `/prototype` `/to-prd`
  chain we don't have. The one portable idea — the **fog-of-war / investigate-
  iteratively-because-you-can't-design-ahead** framing — is the *opposite* of how
  the boxholder works: they push to plan *more and end-to-end*, not less (see
  memory `feedback_plan_more_not_less`). cb-plan's "a plan is a complete unit,
  designed end-to-end" stance already matches them, so there's no gap to fill.
  Pure skip — no fold-in.
- [x] **I3 — addyosmani `performance-optimization`. DONE → `fold-in`
  (cb-frontend) + one finding.** Most of it was already covered or N/A: the
  measure-first/profile-then-fix **methodology already lives in cb-debug**
  (Phase 4 "measure first, fix second"); the backend anti-patterns (N+1, indexes,
  connection pools) are **N/A** for a filesystem-card backend; CWV budgets /
  Lighthouse CI / hero-image art-direction are **overkill** for an internal tool.
  Folded the narrow web-applicable bits into cb-frontend as a tight "Performance
  — measure before you optimize" section: **reserve image space to avoid CLS** +
  lazy-load offscreen, and **don't memoize on reflex** (the skill's own red flag
  — memoize only when profiling proves it; the common real win is not passing a
  fresh `{}`/`[]` literal as a prop), cross-linking cb-debug for "is it actually
  slow." **Finding surfaced (cb-codehealth candidate):** the `<Image>` primitive
  only reserves both dimensions for `size="thumb"` (`w-16 h-16`); `sm/md/chat/lg`
  are `max-w`/`max-h` only, so images shift the layout as they load — a real CLS
  source worth fixing in the primitive (accept intrinsic dims / aspect-ratio).
- [x] **I4 — anthropic `mcp-builder`. DONE → `skip`** (boxholder call). No real
  MCP-authoring need; revisit from scratch if we ever expose box capabilities
  over MCP.
- [ ] **I5 — anthropic `web-artifacts-builder` / ui-ux-pro-max core DB.** Both
  long-shots: artifact bundling (claude.ai-scoped) and a searchable design DB
  (conflicts with frontend.md). Decide: near-certain skip; note why.

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
5. **New-skill design:** E2 + F3 + G1 (the docs-index / context / frontend.md
   skill ideas — likely design together).
6. **As-needed:** C1 (debugging), H1 (security/clerk), I2/I3.

Each resolved item: record the decision inline (`adopt` / `fold-in` / `write-new`
/ `idea` / `skip` + where the outcome landed). When the backlog is worked
through, this doc becomes the record of what we harvested and what we passed on.
