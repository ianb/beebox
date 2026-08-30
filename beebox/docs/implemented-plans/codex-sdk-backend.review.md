---
title: "Plan engineering review — Codex SDK backend"
status: implemented
workstream: codex-engine-plan
issues:
  - ../../../issues/closed/code-quality/2026-08-15-replace-raw-codex-app-server-with-sdk.md
---

# Plan Engineering Review — Codex SDK backend

## What already exists

The plan now accounts for both execution item mappers. Live chat and transcript history
use `src/services/codex-tool-activity.ts:72`: “One provider-owned conversion point used
by both live streaming and history.” Batch execution instead imports its activity mapper
from `src/core/agent/codex-run-activity.ts` at `src/core/agent/codex-run.ts:22-27`.

The transcript exception is small and isolated. `src/core/chat/session/codex-transcript.ts:98-102`
uses `thread/read`; lines 219-250 list threads; lines 262-266 delete one thread. The plan
keeps only these unsupported operations instead of adding a second transcript store.

## Prior art (external) — verified

The [Codex SDK documentation](https://developers.openai.com/codex/sdk) states that the
TypeScript SDK starts, continues, and resumes local threads. The published SDK types
include streamed items, usage, cancellation, structured output, local images, sandbox,
approval, cwd, model, environment, and a binary override.

The official [Codex configuration reference](https://developers.openai.com/codex/config-reference)
documents `developer_instructions` as “Additional developer instructions injected into
the session.” The SDK accepts this through its typed generic `config` object. The
developer-context route is therefore documented, but its resume and plugin semantics
still need the planned runtime probe.

No official SDK operation was found for thread history, thread listing, or thread
deletion. The small app-server compatibility surface remains necessary for current
product history behavior.

## Stated preferences this plan trades against

- Principle 1, types are structure: live execution consumes the SDK's closed event
  unions instead of loose, hand-maintained protocol schemas.
- Principle 4, resilient and never silent: capability failures block cutover.
- Principle 8, one way to do each thing: batch and chat share one live-event adapter.
- Principle 10, testability is architectural: the SDK runner is injectable and has a
  deterministic fake before production wiring.

## Could this be simpler? (verified)

The smallest useful change moves batch and chat execution to the SDK and leaves history
administration on three raw app-server methods. The plan now uses this shape. It avoids
dual writes, a transcript importer, and a second durable format. This follows principle
8 because it removes the duplicate execution transport without inventing another way to
store chat history.

## Failure modes

The plan now gives each execution and transition failure a named test or runtime probe,
handling, and visible result. The most important probes cover developer-context role,
per-turn usage semantics, per-turn process latency, and abort followed by immediate
resume.

## Agent-flow / user-flow edge cases

The change does not alter cards, refs, or concurrency. It preserves validation from SDK
file-change paths and preserves optimistic sender attribution. Partial migration is
explicit: an internal rollout switch can retain app-server execution, while history
administration stays on its isolated compatibility client.

## Findings

### Developer instructions were an open question after the official answer existed

**Location in plan:** `beebox/docs/plans/codex-sdk-backend.md`, Prior art and Open
design questions.

**Citation:** The official configuration reference says `developer_instructions` is
“Additional developer instructions injected into the session.”

**Issue:** The first draft treated the configuration key as hypothetical.

**Why it matters:** A false open question makes a supported migration look blocked and
encourages an unsafe user-message workaround.

**Suggested action:** Use SDK `config.developer_instructions` and retain a runtime probe
for role, resume, and plugin semantics.

**Traces to preference:** This follows principle 3 by validating behavior at the actual
SDK/CLI boundary.

### A callback-owned transcript over-scoped the SDK migration

**Location in plan:** Track 4 in the first draft.

**Citation:** `src/core/chat/session/codex-transcript.ts:98-102` sends one typed
`thread/read` request, while lines 219-250 and 262-266 contain the other two operations.

**Issue:** The first draft proposed dual writes, an importer, and a new durable transcript
to remove three unsupported administration methods.

**Why it matters:** It would freeze normalization at write time and make the execution
migration depend on a larger data migration.

**Suggested action:** Quarantine the three methods in a history-only client and revisit
only when the official SDK changes or maintenance cost becomes material.

**Traces to preference:** This follows principle 8 by removing duplicate execution paths
without adding a competing transcript representation.

### Usage semantics need a real two-turn probe

**Location in plan:** Track 1 and Track 3.

**Citation:** `src/core/codex-usage.ts:30` says, “Callers pass `last`, never cumulative
totals.”

**Issue:** Typed SDK usage does not alone prove whether counters are per-turn.

**Why it matters:** Appending cumulative totals would silently double-count later turns.

**Suggested action:** Compare two consecutive turns and block ledger writes until the
counter semantics are established.

**Traces to preference:** This follows principle 4 because accounting cannot degrade
silently.

### The SDK changes interactive process lifetime

**Location in plan:** Track 1 and Track 2.

**Citation:** `src/services/codex-chat.ts:243-249` creates and initializes one app-server
for a chat, while the Codex SDK launches `codex exec` for a run.

**Issue:** Each SDK turn can add process startup and session reload latency. Cancellation
also terminates a per-turn execution process instead of sending an app-server RPC.

**Why it matters:** A functionally correct migration can still make chat noticeably
slower or leave an interrupted session hard to resume.

**Suggested action:** Measure fresh and resumed turns, then abort a command and resume
immediately before cutover.

**Traces to preference:** This follows principle 4 because a performance or lifecycle
regression must be measured and visible.

## NOT in scope (verified)

The plan correctly excludes Claude SDK changes, ACP, other harnesses, a callback-owned
agent loop, private rollout parsing, live engine switching, UI changes, and a new product
transcript. These exclusions keep the work focused on the supported Codex boundary.

## Things I checked and found clean

- All cited local source locations resolve to the claimed behavior.
- The existing product `Agent` and `ChatBackend` seams are sufficient.
- The SDK exposes local images, structured output, usage, cancellation, sandbox, cwd,
  model, environment, and additional directories needed by the current run paths.
- Keeping history normalization at read time preserves the current ability to improve
  old tool rendering.
- The plan names knowledge audits as end-to-end context parity checks and does not weaken
  their prompts.
