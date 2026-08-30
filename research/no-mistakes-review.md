# No Mistakes vs callback-box review and landing

_Snapshot: 2026-08-30. Upstream: [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) v1.60.3, commit [`c7897368`](https://github.com/kunchenguid/no-mistakes/commit/c78973685d8af1cf5b1baaf959ad6a77347c0520), 7,967 GitHub stars at inspection time._

## Bottom line

No Mistakes is not a stronger version of our cross-model review skill. It is a local delivery system: a Git remote admits a committed branch into a disposable worktree, runs an intent/rebase/review/test/document/lint pipeline, publishes the resulting head, opens a PR, and watches CI. Our nearest comparison is the whole `/finish` path, not `.claude/skills/cross-model/SKILL.md` alone.

The useful idea is narrower than adopting the product: bind the final mutation to durable evidence about the exact head that passed review and verification. No Mistakes carries a review-approved SHA through later steps and refuses publication when continuity is lost. Our headless finish agent checks that the tree is clean and that post-green commits were reverified, but `bin/land` itself knows only that the branch contains current `main`. Investigating a small, local verified-head receipt would strengthen the boundary without importing a daemon, proxy remote, TUI, PR workflow, or autonomous repair policy.

Do not replace our cross-model pairing with No Mistakes' agent fallback chain. A fallback chain is availability routing, not independent review: it stops at the first configured agent that runs successfully and may remain in the same model family as the author. Our skill's point is deliberately different blind spots (Claude author -> Codex reviewer, or Codex author -> Claude reviewer), read-only source checking, and human adjudication.

## What No Mistakes actually does

The high-level flow is `intent -> rebase -> review -> test -> document -> lint -> push -> PR -> CI`, run in a disposable detached worktree behind a local Git proxy remote. The [README at the reviewed commit](https://github.com/kunchenguid/no-mistakes/blob/c78973685d8af1cf5b1baaf959ad6a77347c0520/README.md) and [pipeline reference](https://github.com/kunchenguid/no-mistakes/blob/c78973685d8af1cf5b1baaf959ad6a77347c0520/docs/src/content/docs/reference/pipeline-steps.md) establish four important qualifications:

- Review auto-fix defaults to zero. Blocking review findings park for a decision unless configuration opts back in. Test, document, and lint fixes can still be automatic and are followed by their gates.
- `ask-user` means the finding challenges intent or requires a scope/product choice. The TUI or `/no-mistakes` AXI driver can approve, skip, or send selected findings to a fixer. `--yes` is an explicit standing consent that also selects `ask-user` findings; it is not the normal interactive contract.
- Every full review records the exact approved head. Later steps accept only that head or a descendant. Publication checks the durable approved SHA again and uses an explicit `--force-with-lease=<ref>:<expected-sha>` anchor.
- A CI repair may publish without a full local replay only when it descends from the reviewed, already-published head. A rewritten or otherwise unverifiable repair revokes approval and returns to Review. `ci.revalidate_repairs: true` can require that replay for every repair.

Its ordered agent list covers Claude, Codex, Grok, OpenCode, Copilot, Pi, Rovo Dev, Antigravity, Cursor, and ACP targets. The implementation falls through only for an unavailable/erroring runner; this improves liveness but does not request a second opinion or require a family change.

## Comparison

| Concern | No Mistakes | callback-box | Judgment |
| --- | --- | --- | --- |
| Unit of work | One disposable worktree per submitted push/run | One durable managed worktree per human workstream; `/finish` reuses it and merges `main` into it | Different lifecycle. The durable workstream preserves context and intentional unfinished state; a second disposable checkout would add custody and synchronization machinery we do not need. |
| Review | One configured pipeline agent reviews the diff and intent; optional fix/rereview rounds | `.claude/skills/cross-model/SKILL.md` invokes the other model family read-only, verifies source claims, and requires the driving agent to adjudicate and surface material findings | Keep ours. No Mistakes has a broader gate, but its fallback routing is not cross-model independence. |
| Judgment | Findings are typed `auto-fix`, `ask-user`, or `no-op`; selected fixes can be delegated to the pipeline | Review is working evidence. The authoring agent verifies findings, applies changes in the normal workstream, and reports material outcomes | Keep the separation. It matches the boxholder preference to arrange context rather than automate product judgment. We can borrow structured finding labels without handing branch custody to a repair agent. |
| Validation | Targeted local test plus agent-gathered evidence, documentation and lint stages, then remote CI as the broad suite | `finish-preflight` derives a decision sheet; `finish-verify` runs changed tests, applicable typecheck/lint, and a real-box smoke; `schedules/full-suite` tests pinned `main` hourly and files attributed regressions | Similar economics. Our hourly post-merge net deliberately accepts bounded escape latency instead of making every landing wait for the full suite. |
| Dirty or uncertain state | Gate consumes committed history; pipeline owns mutations while active | Finish agent blocks on ambiguous stragglers, merge conflicts, real failures, dirty final state, or missing human decisions | Our fail-closed headless behavior is simpler and better fitted to a single boxholder. No Mistakes adds durable pause/resume and branch custody for long PR/CI lifetimes, which we do not have. |
| Exact-head safety | Durable review-approved SHA; head-continuity checks before every later step; guarded push and remote verification | Finish agent tracks the decision sheet and requires re-verification after post-green commits; `bin/land` requires clean `main`, current-main ancestry, and `--no-ff`, but has no durable verification receipt | This is the strongest transferable idea. Investigate binding `bin/land` to the exact verified head, without copying the remote force-push mechanism. |
| Concurrent upstream movement | Rebase before review; later conflict repair re-enters Review because ancestry continuity is lost | Preflight merges `main` into the worktree; `bin/land` refuses if `main` moved, sending the worktree back through merge and verification | Already equivalent in safety intent. Our no-rewrite merge topology makes force-with-lease irrelevant to landing. |
| Delivery | Pushes a feature branch, opens a PR, monitors CI, and may republish repairs | `bin/land --no-ff` merges locally to `main`; hooks deploy deployed paths; hourly suite is the post-merge net | Reject the PR/proxy layer here. It would create a second way to land and conflict with the repo's one-command `bin/land` boundary. |

## The review-fix loop

No Mistakes' strongest version of the loop is not “let the reviewer rewrite until it agrees with itself.” Review fixes are disabled by default in v1.60.3, full rereviews are fresh sessions, and pipeline-authored fix ranges are explicitly framed as untrusted claims for the next reviewer. That is careful machinery.

Even so, it optimizes a different boundary. Its pipeline owns the branch and must turn findings into a publishable PR without returning to the original authoring conversation. Our reviewer is intentionally not the owner: `.claude/skills/cross-model/SKILL.md` says to treat the result as evidence, adjudicate it, and surface material outcomes. That preserves the user's decisions and lets the primary agent distinguish an actual defect from a reviewer misunderstanding. Automatic lint formatting and other deterministic mechanical changes remain appropriate; model-authored “safe” fixes are contextual, not mechanically safe in the same sense.

The headless distinction is therefore:

- No Mistakes parks and later resumes a durable pipeline, with an external TUI/AXI decision protocol and branch-custody state.
- Our finish agent returns `RESULT: BLOCKED`; the human and primary session resolve the ambiguity, then dispatch a new finish pass. Nothing retries forever, and there is no hidden autonomous owner after the handoff.

The latter is less convenient for unattended PR production but easier to reason about in this repository.

## Force-push safety and our landing/deploy chain

No Mistakes needs force-push safety because rebases and pipeline fixes may rewrite an already-published feature branch. It proves two separate facts: the proposed head equals or descends from the review-approved head, and the remote still equals the expected lease anchor. If the first proof fails, it returns to Review; if the second fails, it refuses to overwrite concurrent remote work.

`bin/land` has no corresponding force operation. It merges a local workstream branch into a clean local `main` with `--no-ff`, and refuses unless the branch already contains current `main`. This preserves every reviewed commit and makes concurrent movement an explicit merge-and-reverify cycle. We should not borrow force-pushing for either landing or deployment.

The transferable invariant is “the mutation consumes the exact artifact that was verified.” It may also be relevant to deploy supersession, but that needs a separate source-grounded review of the deploy coordinator; this snapshot does not establish a deploy defect. The immediate gap is smaller and local: `bin/land` can be invoked without proof that `/finish` verified its current head.

## Dispositions

### Adapt — investigate a verified-head receipt for `bin/land`

Have `bin/finish-verify` (or the finish agent after all required judgment steps) emit a short-lived/durable record keyed by branch, exact HEAD, merged-main base, and completed verification kinds. Make `bin/land` validate and consume that record, invalidating it when HEAD or `main` changes. Preserve the existing rule that semantic changes after green require a full rerun and docs-only changes need only doc checks. This adapts No Mistakes' approved-head continuity to our local `--no-ff` topology rather than copying its database or force-push path.

Concrete trace: `bin/finish-preflight.ts`, `bin/finish-verify.ts`, `.claude/agents/finish.md` step 7, and `bin/land`. Filed as [`issues/exploration/2026-08-30-bind-land-to-verified-head.md`](../issues/exploration/2026-08-30-bind-land-to-verified-head.md).

### Adopt — use exact-head language when reasoning about later mutations

When a post-review step changes history or code, ask whether the delivered head is exactly the reviewed head, a permitted descendant with its own required checks, or unrelated/unprovable. This is a useful review vocabulary now, especially in future deploy-supersession work, and costs no new mechanism.

Concrete trace: `.claude/skills/cross-model/SKILL.md` shared rules 7–9 and `.claude/agents/finish.md` steps 3 and 7.

### Reject — replace cross-model pairing with an agent fallback chain

Fallbacks solve quota, installation, and transient runner availability. They do not ensure a different model family and they produce one successful review, not an independent second perspective. Preserve the explicit Claude <-> Codex direction and stop when the other family is unavailable.

Concrete trace: `.claude/skills/cross-model/SKILL.md`, “Pick your direction FIRST.”

### Reject — add a proxy remote, daemon, TUI, and PR-mediated landing

Those components solve multi-repository contribution and long-running CI custody. Here they would duplicate managed worktrees, `bin/finish-preflight`, `bin/finish-verify`, and `bin/land`, creating two ways to do the same landing. Keep one local landing path and the main-only deploy hook.

Concrete trace: root `CLAUDE.md` worktree/auto-deploy rules, `.claude/skills/finish/SKILL.md`, and `bin/land`.

### Reject — automatically apply model-authored review findings by default

Keep deterministic format/lint fixes automated where already safe, but keep cross-model findings as evidence for the primary agent and user. No Mistakes itself now defaults review auto-fix to zero; its more autonomous test/document/lint repair loop is not a reason to blur our author/reviewer roles.

Concrete trace: `.claude/skills/cross-model/SKILL.md` shared rules 7–8 and the boxholder's established “arrange context, do not automate judgment” direction.

### Later — evaluate exact-head continuity in deploy supersession

The principle may help ensure that an incomplete or superseded deploy cannot report or leave the wrong ref live. Do not infer a fix from this comparison: first inspect the current deploy coordinator and its existing supersession guarantees in a dedicated workstream.

Concrete trace: `callback-box/deploy/deploy.sh` and the main-only post-commit/post-merge deployment contract in root `CLAUDE.md`.

