---
name: bbx-codehealth
description: Run a deliberate codebase-health pass to find cruft, dead code, shallow modules, and hard-to-test seams. Use for accumulated architectural friction, before large changes in messy areas, or when bbx-debug flags the architecture; not for routine refactoring.
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# bbx-codehealth

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

**A module can be a whole directory** — and those are often the highest-leverage
ones. A deep *subsystem* has a small public surface (an `index.ts` re-exporting
only the intended API; `knip` keeps it honest by flagging exports nothing uses)
and a short usage doc at its root (a directory `CLAUDE.md` / README — like
`src/services/CLAUDE.md`, `src/connectors/CLAUDE.md`), so a caller — human or
agent — can use it correctly *from the surface alone*. **The real test of depth:
investigation at depth isn't necessary to use it.** If you had to read the
implementation to learn how to call it, the interface is too big, undocumented,
or both — that's a top deepening candidate, and creating these is the
codehealth move the boxholder most wants to make.

**The deletion test** (your sharpest probe): would deleting this *concentrate*
complexity or just *move* it? "Concentrates" means it earns its keep; a thing
you could delete by smearing its job across callers was shallow.

## 1. Scan for friction

Choose the audit scope first: a named area and its directly coupled seams, or
an explicitly package-wide health pass. Use existing current results when they
cover that scope; run the tools needed to answer the question. The `pnpm lint:*`
scripts run from `beebox/`. Ground each candidate in current tool findings or
concrete source/caller evidence, not an impression alone:

- `pnpm lint:knip` — unused files, exports, and dependencies. Its reachability
  analysis needs the whole package; do not restrict its graph to a directory.
- `pnpm lint:circular` — value-import cycles; type-only cycles are fine. Keep
  cross-directory edges when inspecting a subsystem's cycles.
- `pnpm lint:oxlint` — structural smells such as useless spreads and identical
  ternary branches.
- Files near the 300-line cap / functions near 150 — inspect responsibility
  boundaries; do not split solely to satisfy a count.

For a package-wide audit, run all three tools. For a named-area audit, run only
applicable tools, retaining whole-package analysis where required and triaging
hits in the requested area or its directly coupled seams. Do not rerun a tool
later in this checklist if its current result already covers the question.

**Optional deep-scan — near-duplicate detection (slopo).** For a duplication
pass over a whole package (the "same thing written twice under different names"
drift that knip/oxlint can't see), run `slopo` — an embedding-based
near-duplicate detector. It's opt-in and package-scoped, **never a CI gate**
(≈⅓ of its raw output is idiomatic-one-liner noise that needs a judgment pass).
Prereqs: `uv tool install slopo` and an OpenAI embeddings key; if no key is
available, skip this scan. Run it from its pinned config dir so the cluster
hashes stay stable (~$0.02, ~1 min):

```bash
cd beebox/tools/slopo
SLOPO_EMBEDDING_API_KEY=$THINKING_OPENAI_API_KEY slopo index && slopo embed && slopo analyze
```

Read the ranked report at `slopo-report/index.md` and triage top-down, by this
filter (it exists because mechanical dedup fights depth — a shared `utils`
grab-bag is *anti*-health):

1. **Drifted duplicates first** — same function, diverged bodies. These are
   latent bugs, the highest-value find.
2. **Systemic duplication second** — many clusters pointing at one seam (e.g.
   the parallel `webapp/routes/*` ⇄ `webapp/trpc/routers/*` handlers) is an
   architecture conversation, not N edits. Take it to `bbx-plan`.
3. **Trivial one-liners, within-file repetition, and semantic false positives**
   (embeddings rate *opposite* predicates as similar) → **dismiss**: add the
   cluster hash to `tools/slopo/slopo.ignore.txt` (committed) with a one-line
   why, and re-run `slopo analyze` to confirm it drops. Dismissed clusters stay
   quiet on future runs, so signal improves over time. Leave real-but-unaddressed
   duplicates *out* of the ignore list so they stay visible.

When you do consolidate, it's a normal deepening (below): give the shared helper
a real home, don't just hoist it into a junk drawer.

**Recurring-pattern checks (architectural-review regressions).** These are the
patterns the 2026-07 architectural review found *regrowing in new code* — a
one-time cleanup didn't hold, so they get a cheap recurring grep instead of a
17-agent pass. Use only the probes relevant to the audit scope, from `beebox/`.
Call something a regression or trend only against a named earlier result or
commit; otherwise report the current offending sites.

- **Dead code — `pnpm lint:knip`.** Healthy is a small handful of genuine
  unused files; a regression is a jump into the dozens (usually a broken entry
  in `knip.json`, not real dead code) or a newly-orphaned file.
- **Cycles — `pnpm lint:circular`** (madge). Healthy: only `import type` cycles.
  A regression is any new value-import cycle.
- **Unsafe casts — `rg -n "as unknown as|as never" src`.** Inspect sites in
  scope outside the two blessed helpers (`cardFields`, `parseCommandArgs`).
  `as never` evades the `as unknown as` count and the `.tsx` lint ban. A raw
  count without a comparable baseline does not establish a trend.
- **Silent catches, all forms —**
  `grep -rnE "\.catch\(\s*\(\s*_?\w*\s*\)\s*=>\s*\{\s*\}\s*\)|catch\s*\{\s*\}" src`.
  The arrow form `.catch(() => {})` is the one that slips past the catch-must-log
  convention. Healthy: zero, or each surviving hit carrying a `/* ignore: … */`
  reason. A regression is a new empty catch on any poll, hot path, or
  user-initiated action.
- **Exhaustiveness inventory.** The `switch-exhaustiveness-check` lint rule
  (live) covers `switch`; `pnpm lint` clean means switches are handled. If-chains
  over a union aren't linted — scan for a union dispatch whose final `else` lacks
  `assertNever`. Judge whether each dispatch handles its union, not how many
  `assertNever` calls exist.
- **Regrown consolidated helpers.** Each of these was consolidated once and grew
  hand-rolled copies back; grep for the *formula* reappearing outside its home:
  - content-hash: `createHash("sha256")` outside `lib/content-hash.ts`.
  - file-exists: an `access(...)`/`fs.access` existence probe (or
    `.then(() => true).catch(() => false)`) outside `lib/file-exists.ts`.
  - public-url: a `config/box.json` + `PUBLIC_URL`/`BBX_PUBLIC_URL` cascade
    outside `lib/public-url.ts` (a copy that bypasses it silently ignores
    `BBX_PUBLIC_URL`).
  - mimetype: an extension→MIME map literal outside `lib/mimetype.ts`.
  - multipart: a `multipart/form-data` boundary builder outside the shared one.

  Healthy: the formula appears only in its home module. A regression is a fresh
  copy — pair the re-consolidation with the enforcement hook where one is
  feasible (that's the point of consolidating these specifically).
- **Doc prose-ref staleness.** `doc-check` validates markdown *links* but not
  file paths mentioned in prose (`` `src/foo/bar.ts` `` in running text). Extract
  backticked `src/…` / `docs/…` paths from changed docs and confirm each still
  resolves — a moved or deleted file leaves a stale prose pointer doc-check can't
  see.

**Explore the unresolved seams** after the tool results. Delegate a bounded
question when useful; skip a second exploration pass if the evidence already
answers it. Look for friction in the agreed scope:

- Understanding one concept requires bouncing between many tiny modules.
- A module is **shallow** — apply the deletion test.
- A pure function was extracted *only* for testability, but the real bugs hide in
  how it's called (no **locality**) — that's a shallow split, not a deep module.
- Tightly-coupled modules leak across their seams.
- A part is untested or hard to test *through its current interface*.
- You had to **read the implementation to learn how to use** a module — there's
  no small, documented surface to call it from. For a directory: no `index.ts`
  entry point and no root `CLAUDE.md`/README. This is the boxholder's priority
  signal: flag these.
- Tech-debt markers the code already admits ("older raw routes are tech debt —
  migrate when you touch the area"), duplicated logic, or routinely-noisy command
  output (a bug per CLAUDE.md, not background).

Consult `docs/glossary.md` when domain vocabulary is relevant, and the specific
implemented plan when a candidate touches an earlier design decision.

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

1. **`bbx-plan`** it — the design altitude (what reuses, what can fail, what's
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
- **Make the surface self-explaining** — a small interface is only deep if a
  caller can use it *without reading the body*. Give it a usage doc (interface
  doc-comments; for a directory, an `index.ts` that exposes only the intended API
  plus a root `CLAUDE.md`/README) so depth investigation isn't needed.
- **One adapter = a hypothetical seam; two = a real one.** Don't introduce the
  interface until a second implementation actually exists.
- **Follow project conventions** — make code consistent with its neighbours, not
  with an external ideal.
- **Maintain balance** — don't over-abstract or simplify clean code; scope to
  what's genuinely crufty.
