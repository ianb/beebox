**Status:** cross-model review, 2026-08-08 — findings folded in, then the plan's
mechanism was flipped

> **Read this in context.** This review was written against the plan's first
> draft, which recorded the import map *empirically* from the doctest loader.
> Findings 1–4 were all fidelity failures in that recording design, and together
> with the worktree case they led the boxholder to flip the mechanism to a
> statically derived esbuild graph. So the dispositions below describe fixes to a
> design that was subsequently replaced. They are kept because several fixes
> survived the flip unchanged (findings 5–7, 9), because findings 1–4 are the
> evidence the current plan cites for *why* recording was rejected, and because
> the flip means finding 8's recommendation was ultimately adopted in full.
> A fresh cross-model review of the rewritten plan is owed.

# Cross-model review — change-based test selection

Reviewer: OpenAI Codex (`gpt-5.5`, high reasoning effort), read-only over the
real repo, run via the `cross-model` skill in plan mode. The plan under review
was `change-based-test-selection.md` at commit `4f9001b6`. Line references below
point at that revision, not the current one — the plan has since been revised in
response.

Every finding was verified against source before acting; the disposition after
each is the plan author's, not the reviewer's.

---

## Findings (verbatim)

> **1. High: The cached map can become stale in a way that under-selects, and the fail-open rules do not catch it.**
> `change-based-test-selection.md:249-256` accepts a stale cache by age/commit bounds, and `:288-296` only fails open for age, unknown source files, deletes/renames, or test-file set changes. It does not fail open when an existing test file or source file changes its imports after `recordedAtCommit`. Example: commit A changes an existing test to import `src/foo.ts`; the map is not refreshed; commit B changes `src/foo.ts`; selector can still believe no test imports it. Same for source transitive edges. This is the core under-selection risk.
>
> **2. High: The `/finish` cadence can skip a boundary on docs-only landings.**
> The cadence is defined in Track 5 (`change-based-test-selection.md:414-441`), but the existing finish docs skip the entire verification tier for docs-only changes (`.claude/agents/finish.md:58-63`) and step 4 is where tests run (`.claude/agents/finish.md:159-180`). If a docs-only branch is the Nth commit, no full run happens, and the next code branch sees `before` already past the boundary. That can defer the full run until the next multiple.
>
> **3. High: "Sees every module specifier" is false for the current Node hook mechanism.**
> The plan claims the async `module.register()` hook "sees every module specifier" (`change-based-test-selection.md:57-63`). Node 24 docs say async hooks run on a separate loader thread and do **not** affect all `require()` calls, including `module.createRequire()`; Node also now marks `module.register()` deprecated in favor of `registerHooks()` ([Node v24.18 docs](https://nodejs.org/download/release/v24.18.0/docs/api/module.html), around `module.register` and async-hook caveats). The repo already has `createRequire()` call sites in `callback-box/src/...` and tests. Current usages I checked mostly resolve packages, but the plan needs an enforcement rule or should switch to synchronous `registerHooks()` before claiming complete resolution coverage.
>
> **4. High: The recording-disable invariant is not implementable as sketched.**
> Track 2 requires "no shard reported that recording was disabled mid-process" (`change-based-test-selection.md:207-214`), but Track 1's catch block only sets `recordingDisabled = true` after a failed write (`:161-167`). If the owner line was already written and a later write fails, condition 2 still passes, and condition 3 has no durable signal unless the plan writes a separate sentinel that survives the same failure mode. The failure table's claim that write failure makes the owner absent (`:559`) is wrong.
>
> **5. High: `sourceInventory` is internally inconsistent, and either interpretation is bad.**
> The map says `sourceInventory` is "every repo file seen" (`change-based-test-selection.md:239-246`), but Track 3 relies on existing files that no test imports being present in inventory so it can run only `alwaysRun` (`:300-314`). If inventory means "seen by the loader," those files are absent and selection falls open to full, losing the plan's main frontend win. If inventory means "all repo source files on disk," then `alwaysRun` for unimported files is deliberate under-selection based on an incomplete non-import coupling audit.
>
> **6. Medium: `test:changed` does not automatically run `pretest`.**
> The plan adds `"test:changed": "node --import tsx ../bin/test-select.ts --run"` (`change-based-test-selection.md:403-407`) and then says `pretest` still runs (`:409-410`). npm/pnpm lifecycle hooks are per-script; `pretest` runs before `test`, not before `test:changed`. Unless `--run` explicitly invokes the CLI build, the selected path can test stale `dist/cli.mjs`, exactly where `alwaysRun` is meant to cover subprocess blind spots.
>
> **7. Medium: The subprocess blind-spot list is too narrow.**
> `alwaysRun` only lists the five built-CLI/bin-cb doctests (`change-based-test-selection.md:340-349`). But tests also spawn Node children that import repo code, e.g. `callback-box/test/webapp/auth-capabilities.doctest.md:33-38` imports `src/webapp/auth-capabilities.ts` inside a spawned process. That specific file also imports the same module in the parent (`:12-20`), so it is not currently a miss, but the plan needs an enforced inventory of repo-loading child processes, not a hand list of built-CLI spawns.
>
> **8. Medium: The static-graph rejection is not decisive enough to justify building Tracks 1/2/5c first.**
> The plan itself says a static esbuild graph has no staleness, no producer, no green-run invariant, and no TSX-flake interaction (`change-based-test-selection.md:505-513`), then makes resolution fidelity the decisive objection (`:515-527`), then says the spike should run before Track 1 (`:635-642`, `:671-672`). Given findings 1-4, the runtime design has at least as much fidelity risk as the static graph. The spike should be a gate, not an optional prelude.
>
> **9. Low: Several citations/claims are inaccurate or overstate evidence.**
> `bin/manual-tests-scheduled.sh:66-96` is cited for both `snapshot_open_issues` and `validate_triage_result` (`change-based-test-selection.md:79-83`), but snapshot is actually `bin/manual-tests-scheduled.sh:49-57` and validation starts at `:59`. The example selector output says "6 files" (`change-based-test-selection.md:309-311`) while `alwaysRun` lists 5 (`:343-349`). The tap one-file-per-child claim is true for normal files in tap v21 (`node_modules/@tapjs/run/dist/esm/execute-test-suite.js:101-112`, `node_modules/@tapjs/run/dist/esm/run.js:145-160`), but it should cite tap behavior, not just assert it.
>
> **Single Most Important Change**
>
> Do the static esbuild graph spike first and make it the gate. If runtime recording survives that spike, require the map to be refreshed on every full run and fail open whenever any import-graph-affecting file changed since `recordedAtCommit`; otherwise this ships a selector whose stale cache can silently run too few tests.

---

## Disposition

**1 — accepted, and it was the plan's real hole.** Verified by construction: no
rule in the original Track 3 covered "the graph was rewired after recording."
The plan now adds a third selection term — every test file changed since
`recordedAtCommit`, plus every test file the map says imports anything changed
since `recordedAtCommit` — with the induction argument for why that closes the
hole. See "Rule 7" in Track 3.

**2 — accepted.** Verified against `.claude/agents/finish.md:58-89`: a docs-only
finish skips step 4 entirely, so it cannot run a full suite, and its commits
still advance `main`'s count. The fix went further than patching the
arithmetic: the cadence is now derived from `map.recordedAtCommit` rather than
from a commit-count multiple, which makes a docs-only landing incapable of
consuming a boundary and folds the cadence into map freshness — the same
quantity finding 1 needs. This deleted the crossing-detection arithmetic
outright.

**3 — accepted, claim softened.** The overstatement was real. The plan no longer
claims complete coverage; it names `require()`/`createRequire()` as a bounded
gap, folds those call sites into Track 4's enforcement test, and adds
`module.registerHooks()` (synchronous, in-thread, covers `require`) as an
explicit option for the spike to evaluate.

**4 — accepted.** Verified: the sketched catch could leave a short shard that
passes condition 2. Resolved by inverting the failure direction — a recording
write failure now aborts the test process, so condition 1 (the run exited 0)
catches it. Condition 3 is deleted. This is safe precisely because recording is
only ever on during a full recording run, where aborting means "no map refresh",
which is the outcome we want.

**5 — accepted.** The inconsistency was real. `sourceInventory` is now defined
as `git ls-files` output at `recordedAtCommit` — all repo files on disk, not
files the loader saw. The second half of the finding stands as an honest
residual risk rather than a fix: the untested-by-import rule does rest on the
blind-spot audit being complete, and the plan now says so and raises it as an
open question with a named conservative fallback.

**6 — accepted.** Verified against npm lifecycle semantics: `pretest` fires for
`test`, not `test:changed`. The plan adds an explicit `pretest:changed`.

**7 — accepted.** Verified and it is broader than the reviewer found: 11
`.doctest.md` files under `callback-box/test/` call `spawn`/`execFile`/`fork`,
not the 5 the original list named. The hand list is replaced by a Track 4
enforcement test over all of them.

**8 — accepted.** The spike is now a hard gate, and the plan says plainly that
findings 1–4 moved the balance toward the static graph rather than away from it.

**9 — accepted, all three corrected.** `bin/manual-tests-scheduled.sh:49-57`
(snapshot) and `:59-96` (validation) verified; the "6 files" example was an
off-by-one against a 5-entry list and is now written without a hardcoded count;
the tap one-file-per-child claim now carries the reviewer's own citation.

## Things the first review did not find

No finding disputed the measured baseline in the origin issue's
`## Research (2026-08-08)` section (it was supplied as given), the claim that
route doctests reach the server through a real import chain, or the
`forceFull` / `alwaysRun` distinction. The reviewer also did not challenge the
decision to keep `src/lib/` out of `forceFull`, which was the plan's one explicit
disagreement with the briefing.

---

# Second pass — architecture review (2026-08-08)

Reviewer: OpenAI Codex (`gpt-5.5`, high effort), read-only, run against the
rewritten plan at commit `a78286ab`. Deliberately steered at architecture and
second-order effects rather than citations, since the first pass covered those.
Seven findings. Two were verified by hand before recording; both hold exactly.

## Findings (verbatim)

> **1. High: ROI is still unproven, but the plan already commits to the correctness liability.**
> `change-based-test-selection.md:618-626` defers the per-file floor because it is "independent," and `:720-727` does the real replay of the last 50 commits only during rollout. That is backwards architecturally. The baseline says the suite is long-tail and saturated, but it does not yet show that real callback-box diffs usually select a small enough set to beat the graph cost plus the permanent risk of under-selection. A reviewer optimizing for a faster suite would first build a disposable selector/replay spike and compare it with low-risk suite-speed work before changing agent habits or `/finish`.
>
> **2. High: `/finish` stops meaning "the full suite passed for this code."**
> Today the merge rule is absolute: any code change runs `pnpm test`, and any failure anywhere blocks merge except the tracked-flake protocol (`.claude/agents/finish.md:21-32`, `:159-180`). The plan changes that to "full when debt >= N, otherwise selected," plus nightly (`change-based-test-selection.md:413-417`, `:456-464`). That means a branch can merge after a selected green while an unselected failing test remains undiscovered until main. The plan's Track 4 language says "full at the gate" (`:403-405`), but Track 5 makes it "full at some gates." That semantic split is the part most likely to rot agent judgment.
>
> **3. High: the blind-spot model misses data-file dependencies, not just non-import module dependencies.**
> Track 3 says the graph is blind in three ways: computed dynamic import, `require`, and spawned children (`change-based-test-selection.md:303-312`). But tests also intentionally cover files read by path. Concrete example: `test/publish/pub-worker-meta.doctest.md` validates the real committed `pub-worker/wrangler.jsonc` and hashes real `pub-worker/src/**` (`callback-box/test/publish/pub-worker-meta.doctest.md:47-61`, `:82-90`); the implementation reads those files with `readdir/readFile`, not imports (`callback-box/src/publish/pub-worker-meta.ts:153-175`). `forceFull` names templates and fixtures but not `callback-box/pub-worker/**` (`change-based-test-selection.md:266-280`). A change to `pub-worker/wrangler.jsonc` can therefore select only `alwaysRun`, skipping the very doctest that exists to catch that break. This is an architectural hole: selection needs a positive data-dependency model, or unclassified non-imported changed paths must force full.
>
> **4. High: "enumerate exceptions and enforce them" is still a whitelist that will silently age.**
> The plan admits the critical gap for unimported source (`change-based-test-selection.md:553-560`) but still defaults to trusting the enumeration (`:650-657`). The enforcement tests prove only the channels the author thought to encode. The prior review already found the hand subprocess list short by 6 of 11 (`change-based-test-selection.review.md:104-107`), and the current rewrite repeats the same pattern at a different layer. A sounder architecture would invert the trust: selection only applies to changed paths classified by the graph or by declared test data dependencies; everything else runs full.
>
> **5. Medium: child-process coverage is scoped too narrowly.**
> Track 3c says it covers "the 11 `.doctest.md` files that spawn a child" (`change-based-test-selection.md:337-343`). But traditional tests also spawn child processes, e.g. `test/frontend/trpc-directory-resolution.test.ts` uses `execFile` with `--eval` to import frontend source inside children (`callback-box/test/frontend/trpc-directory-resolution.test.ts:9-18`, `:21-29`). Even if today's particular source is also covered elsewhere, the enforcement rule is attached to a file extension, not the architectural coupling channel. It should scan all test entrypoints and helpers that can launch repo-loading children.
>
> **6. Medium: the selector duplicates the runner's discovery and resolution contract.**
> The real test runner is Tap plus `.taprc` node args, includes, excludes, and the doctest loader (`callback-box/.taprc:7-14`). The loader only patches one TSX-only case and delegates the rest to Node/tsx (`agent-doctest/src/doctest-hooks.mjs:20-43`). The plan builds a sibling `bin/test-graph` that independently enumerates entrypoints and reimplements resolution candidates (`change-based-test-selection.md:153-178`). That creates a second authority over what "this test imports" means. Given the codebase's "one way to do each thing" principle (`callback-box/docs/engineering-principles.md:95-104`), the better seam is inside `agent-doctest` or a runner-owned graph API that consumes the same config the runner consumes.
>
> **7. Medium: selection makes flaky-test hygiene worse in practice.**
> The plan explicitly leaves the TSX-resolution and login-redirect flakes unresolved (`change-based-test-selection.md:32-35`, `:630-631`). Running fewer files reduces the chance agents see those flakes during branch work, so signatures rot and failures shift to nightly/main where attribution is weaker. The current tracked-flake protocol depends on seeing the failure in the branch, rerunning the exact file, checking whether the branch touched the exercised code, and requiring one full-suite rerun (`.claude/agents/finish.md:40-52`). Nightly issue filing (`change-based-test-selection.md:460-464`) is not equivalent to that decision point.
>
> **Single Change**
>
> Decide that Track 4/5 cannot ship until a pre-rollout spike proves the selector's value and closes the trust model: replay recent commits, measure selected sets and graph cost, and make unclassified changed paths default to `FULL` unless the runner/graph can account for them through imports or declared data dependencies.

## Verified by hand

**Finding 3 holds, and it is worse than the reviewer's phrasing.**
`test/publish/pub-worker-meta.doctest.md:49-51` states its own purpose: *"The
real committed config — not a fixture — so a drive-by edit that breaks
provisioning (renamed Worker, dropped binding, re-enabled preview URLs) fails
here first."* The implementation reads those bytes with `readdir`/`readFile`
(`src/publish/pub-worker-meta.ts:159-172`). So a plan whose whole purpose is
catching drive-by edits would, on exactly a drive-by edit to
`pub-worker/wrangler.jsonc`, skip the test written to catch it. The blind-spot
model was module-shaped; this coupling is data-shaped.

**Finding 5 holds.** `test/frontend/trpc-directory-resolution.test.ts:8-17`
spawns twelve children that `import('./src/frontend/src/lib/view-bindings.ts')`.
Track 3c scans `.doctest.md` only, so it would not see it — and this is the
regression test for the open TSX flake, which makes it a poor thing to miss.

## Disposition

**3 and 5 — accepted outright.** They are concrete holes with concrete instances.

**4 — accepted, and it restructured the plan.** The boxholder inverted the trust
model: selection now applies only when *every* changed path is accounted for by
the graph, and anything else runs the full suite. This closed finding 3 as a
special case, deleted the eleven-glob `forceFull` list outright (every entry was
unaccounted by construction), and removed the accepted critical gap both prior
drafts carried. The three enforcement tests survive but are demoted from safety
mechanism to precision guard.

**1 — accepted.** The replay measurement moved out of rollout and became Track 0,
a gate with stated exit criteria, explicitly including a comparison against the
per-file floor. The trust inversion makes it sharper: it can now end the plan,
because a graph that answers `FULL` for most real commits is not worth building.

**2 — accepted in substance, resolved differently than the reviewer proposed.**
The reviewer's implied fix was to keep `/finish` always-full. The boxholder chose
shadow mode instead: the gate keeps running the full suite *and* records what
selection would have run and whether any failing test fell outside it, so the
decision is made from live evidence rather than argument. Finding 7 dissolves for
the same reason — the tracked-flake protocol keeps its decision point at a full
run throughout. The eventual gate design (selected, full-minus-exclusions, or
stay full) is deferred to that log.

**6 — accepted in principle, deferred in placement.** The resolution logic should
have one authority. `agent-doctest` is a standalone published package and should
not learn callback-box's tsconfig aliases, so the shape is: extract the
resolution rules from `doctest-hooks.mjs` into a module both the loader and the
graph builder consume, with the callback-box-specific alias passed in.

**7 — accepted as a real second-order effect**, and it dissolves if finding 2 is
resolved by keeping `/finish` always-full: the tracked-flake protocol lives at
that gate, and a full run there keeps flake signatures visible at the point where
attribution is strongest.
