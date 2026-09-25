---
title: "Migration reliability implementation scope checkpoint"
---
# Migration reliability implementation scope checkpoint

**Historical checkpoint:** the boxholder subsequently approved the BIG CHANGE
and implementation resumed. Estimates are goals, not automatic cutoffs.

The boxholder authorized implementation of the shared migration, deployment,
and reload plan. Initial implementation exposed a lifecycle omission and an
underestimated source budget. This checkpoint pauses before exceeding the
plan's limit; it does not claim the diff has already crossed that limit.

## Built and checked

- Real-Git snapshots preserve staged-only, working, and non-ignored untracked
  versions. Narrow output commits restore attempted index paths on rejection.
- Manual and sweep script migration use one core. Bounded repair uses the
  configured agent, deterministic retry, Git start receipts, and existing
  question cards. A partial migration can continue with a durable question.
- The shared admission primitive closes before draining, retains accepted
  descendants, and leaves uncertain exclusive work closed for recovery.
- The CLI adapter admits ordinary box commands and preserves child permission.

At the first checkpoint the source delta was 956 changed lines (718 additions,
238 deletions), including unfinished HTTP/chat wiring. Tests were 287 changed
lines. The unfinished HTTP/chat wiring was subsequently parked in local scratch,
so it cannot be mistaken for a completed integration. Source estimates count
additions plus deletions, not net growth. Documentation is separate.

The four focused doctests passed 32 assertions: admission, Git recovery, sweep,
and fake-agent repair. Backend TypeScript passed after integration type fixes.
The CLI adapter also passed a disposable real-Git smoke. These results do not
establish a safe deployed system; HTTP, persistent chat, service replacement,
annex, the real-agent knowledge audit, and fleet convergence remain unverified.
Real repair agents still need the parked environment propagation integrated for
nested CLI calls during maintenance; fake-agent success does not prove that path.

## What changed in the design

`beebox/src/core/chat/session/index.ts:268` says “run stays open, isBusy() flips
false.” `beebox/src/core/chat/session/start.ts:127` calls `buildScriptEnv` while
building the backend start options. A static permission in that subprocess
cannot expire after each request: the next turn reuses the same process.
Holding its lease until the run ends is correct only if maintenance actively
ends idle runs, rather than waiting ten minutes for ordinary idle eviction.

Use existing runtime shutdown to end idle SDK runs after accepted work drains,
then resume conversation history after maintenance. Do not introduce a new
stable-permission registry for processes spanning maintenance. Keep the shared
CLI and scheduler boundary: stopping a web child alone does not exclude those
writers. The existing reload loop is the intended coordination seam, not a new
watcher. This adjustment still needs lifecycle fixtures and integration.

## Remaining source cost

Approximate changed-line estimates, still subject to implementation evidence:

| Required remaining work | Source delta |
|---|---:|
| Complete request, detached work, persistent-chat, and scheduler admission | 150–250 |
| Reload ownership, idle-run shutdown, replacement readiness, and startup | 150–250 |
| Deployment/controller integration across restart | 150–250 |
| Generated guidance/provisioning under the snapshot/commit boundary | 100–150 |
| Existing local/production schedule applies and reports, plus recovery access | 150–250 |

Together with the implemented core, the expected source delta is approximately
2,000 changed lines. The current plan budget is 1,100, with a 1,650 review limit.
This is not permission to increase it silently. A proposed revised budget is
**2,000 source / 800 test lines**, with documentation reported separately.
No deployment, landing, or real-box migration occurred.

## Cross-model scope review adjudication

The independent review confirmed the persistent-run permission problem and
recommended reusing shutdown/resume rather than another capability registry.
Accepted that direction. Rejected its suggestion that CLI admission itself is
scope creep: exclusion must cover those writers under the approved plan.
Agent repair and the shared lifecycle are direct human requests, not optional
features the reviewer can remove on its own authority.

The review's source forecast used an early worker estimate of 750 lines for
runner/repair; the completed worker delta was 500. The lower actual cost helps,
but the remaining lifecycle and schedule work still exceeds the original
budget. The report above uses measured current work and explicit remaining
estimates rather than repeating that obsolete estimate.

Recovery-only access after an interrupted attempt remains required. The runner
can now enter recovery explicitly; wiring the hourly schedule and operational
alerts is still outstanding. It would be incorrect to ship the closed phase
without that recovery path. A flagged delegated operation cannot release its
controller's maintenance gate.

## Decision

Recommended: retain the full requested behavior and continue under the revised
2,000-source / 800-test budget, using idle-run shutdown to avoid a new persistent
permission system. Alternatively, return to migration-only recovery/application
and defer shared lifecycle and agent repair; that reduces the request and
requires the boxholder's choice. Keep the current implementation unlanded until
the whole chosen scope is complete and verified.
