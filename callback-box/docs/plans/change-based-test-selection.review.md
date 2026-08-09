**Status:** cross-model review, 2026-08-08 — findings folded into the plan

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

## Things the review did not find

No finding disputed the measured baseline in the origin issue's
`## Research (2026-08-08)` section (it was supplied as given), the claim that
route doctests reach the server through a real import chain, or the
`forceFull` / `alwaysRun` distinction. The reviewer also did not challenge the
decision to keep `src/lib/` out of `forceFull`, which was the plan's one explicit
disagreement with the briefing.
