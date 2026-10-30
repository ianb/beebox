---
title: "Keep live background work through idle eviction, and end it honestly when the server must stop it"
status: implemented
workstream: idle-eviction
issues:
  - ../../../issues/closed/bugs/2026-10-30-idle-eviction-kills-running-background-subagent.md
---
# Keep live background work through idle eviction

A box chat's background subagent keeps working after the chat's turn ends. The registry treats that chat as idle and closes its input. The subagent's Bash calls then fail with text that says a user declined them. This plan stops the registry from closing a chat that has live background work, and ends the run outright when the server must stop such a chat, so nothing runs on in a state that produces false denials.

**Issues addressed:** [idle eviction stops a running background subagent](../../../issues/closed/bugs/2026-10-30-idle-eviction-kills-running-background-subagent.md). Related, not closed: [done-but-still-working state](../../../issues/features/2026-09-11-done-but-still-working-state.md), [chat stop and background subagents](../../../issues/decisions/2026-08-25-chat-stop-and-background-subagents.md). `bin/issues similar` printed no other match.

## Design

No design section: this restores behavior the boxholder already expects. A chat's background work finishes, and an agent does not report a refusal nobody made. It adds no surface or new behavior a person meets. The background-task strip stays as it is.

## Smallest fix and budget

Smallest fix: one `continue` in `sweepIdle` for a chat with live tasks. That fixes the reported trigger and nothing else. The live-cap path still stops working chats, and every remaining stop still leaves a subagent running on closed input.

Chosen design, about 60 changed source lines and 90 test lines:

1. Track live tasks on `ChatSession`. Sweep and cap skip a chat with live, non-stalled work.
2. Add `ChatBackendRun.abort()`. `stop()` and `restart()` use it when tasks are live.

No authored documentation beyond a line in `docs/chat.md`. Well under the BIG CHANGE line.

## Stated preferences this plan trades against

- `beebox/code-style.md`: *"Nothing retries forever."* A pin held by a hung subagent would break this, so the pin has a stall limit.
- `beebox/AGENTS.md`: *"Work only on the requested problem."* This plan leaves the user's Stop (`interrupt()`) unchanged. That choice is still open in the decision issue.
- Trade-off: a chat with live work can exceed `maxLive`. Pins already do this: `registry/cap.ts`: *"Live cap reached but no evictable candidate"*. Memory use is the cost; losing the boxholder's work is the alternative.
- Trade-off: a subagent that keeps making progress is never evicted. It can spend tokens until it finishes or the boxholder presses Stop. An absolute ceiling would kill legitimate long source-collection runs, so this plan does not add one.

## What already exists

- The level signal. `core/chat/session/messages.ts:129`: `adaptTaskLevel` turns `background_tasks_changed` into a `task-level` message and removes ambient tasks. The SDK states *"REPLACE semantics: swap your set for this payload"* (`sdk.d.ts:3809`). Reuse: this is the live-task set.
- `core/chat/session/run/core.ts:259`: `if (msg.type === "task-level") { this.emit("task-level", msg.tasks); return; }`. The session forwards it and keeps no state. Extend here.
- `core/chat/session/run/core.ts:196` and `:238` emit an empty level at run start and close. The same two places clear the state.
- `registry/core.ts:462-468` (sweep) and `registry/cap.ts:30-38` (cap) are the two stop decisions.
- `Query.close()` (`sdk.d.ts:3333`) ends the subprocess. `services/claude-chat/core.ts:322` `close()` only ends the input queue.
- The CLI reports an unfinished task on resume, so no persistence is needed here (probe 5 below).

## Prior art (external)

No external design is adopted. The decisions depend on Agent SDK 0.3.312 and its CLI, checked directly below.

### Evidence: what the failure is

Production, one box, read-only, structural facts only:

- 60 tool results across the session carry the denial text. 57 have `toolDenialKind: "cancelled"`. All are Bash.
- In the same seconds, Read and Write from the same subagents succeed. The denied commands include `pwd`, so command content does not matter. An aborted agent would fail every tool.
- `services/claude-chat/core.ts:152` registers the only in-process hook: `queryOptions.hooks = { PreToolUse: [gitMvNudgeHook()] }`, with `matcher: "Bash"` (`core/sdk-hooks.ts:166`). This matches the Bash-only pattern. The CLI contains the string `PreToolUse hook cancelled (control stream closed)`.
- Clusters begin after evictions at 10-29 03:0x, 05:41, 21:27, 23:13 and 10-30 15:01, 15:41. Each run ended ("Run ended") after the parent's next turn. One small cluster at 10-30 15:28 has no eviction in the log. It remains unexplained.

Local probes with real calls on macOS, SDK 0.3.312:

1. `query()` with a background subagent, then input end: the subagent finishes. No denial.
2. The same with a Bash `PreToolUse` callback: no denial.
3. Two subagents, input end, one settles first: the other finishes. No denial.
4. Real `buildQueryOptions`, scrubbed env, resume, partial messages, and a real `ChatSessionRegistry` with a warm slot and `sweepIdle`: no denial.
5. `q.close()` with a live subagent, then resume: the subagent stops at once and its later commands do not run. The next turn receives a `task_notification` with status `stopped` and the text *"didn't finish before the previous session ended"*. The parent reports that accurately.

**Conclusion.** The denial text is CLI-internal and hard-coded. Eviction before denial is established on production. The exact branch reproduces only on production's Linux build, so it is not proven. The design does not depend on that branch: after this change, no chat with live tasks reaches the closed-input state from any server stop path. Beebox cannot rewrite the CLI's text.

## Ontology

- **Live task** (existing, `LiveTaskEntry`, `message-types.ts`): one non-ambient entry of the latest `task-level` message. Identified by `taskId`.
- **Stalled**: a chat has live tasks and its run has produced no message for `BACKGROUND_STALL_MS`. A state computed on demand. It is not stored and is not a lifecycle phase.
- **`abort`** (new, `ChatBackendRun`): end the backend subprocess now. It is not `close`, which ends input and lets the run finish. It is not `interrupt`, which ends a turn.

## Tracks / scope

### Track 1: a working chat is not idle

- **What:** the session knows its live tasks. Sweep and cap skip it.
- **Why:** `sweepIdle` tests only `lastActivity` and `refCount` (`registry/core.ts:463-464`). A subagent changes neither.
- **Direction:** in `ChatSession`:
  - `private liveTasks: LiveTaskEntry[] = []`, set in the `task-level` branch, cleared where the empty level is emitted.
  - `lastRunMessageAt`, stamped in the pump for every raw backend message with `options.now ?? Date.now`. The stamp comes before the adapter, because the adapter drops `tool_progress` (`messages.ts:281`), the event a running tool sends.
  - `isWorkingInBackground(): boolean`, true when tasks are live and the last message is newer than `BACKGROUND_STALL_MS` (4 hours). `run/live-tasks.ts` holds this state.
  - The registry passes `now` into both session constructors. Sweep: `if (entry.session.isWorkingInBackground()) continue;`. Cap: the same, in the candidate loop.
- **Vocabulary lock-ins:** `isWorkingInBackground`, `BACKGROUND_STALL_MS`.
- **First chunk:** session state plus the two registry checks, with tests. No open questions.

### Track 2: a server stop ends the run

- **What:** `stop()` and `restart()` call `run.abort()` when `liveTasks` is non-empty, and log the task count. Otherwise they call `run.close()` as they do now.
- **Why:** closed input with a live subagent is the state that produced the false denials and the false report to the person. It remains reachable through a stall, maintenance, a model-change restart, deletion, and shutdown.
- **Direction:** `ChatBackendRun.abort(): Promise<void>`. Claude: `q.close()`. Codex and Pi: delegate to `close()`, because neither emits `task-level` and so `liveTasks` stays empty. Fake: records `aborted`, ends the stream.
- **User Stop is unchanged.** `interrupt()` keeps its current behavior.
- **First chunk:** the interface, four implementations, and the two call sites, with tests. No open questions.

## Could this be simpler?

The simplest version is the single sweep `continue`. It fails on the live cap: a third chat's send stops a working chat through `enforceLiveCap`, with the same closed-input result. It also fails on a stalled pin, which would hold a process forever. Without `abort`, each remaining stop still lets a subagent run on and lets its parent report a refusal.

Considered and removed: a persisted "why it stopped" note injected into the next turn. It needs a new file and a composer change. Probe 5 shows the CLI already tells the parent the task did not finish. The note would add only the reason, and the server log has that.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A hung subagent pins a chat and its process | Named: stall test | Stall limit, then the normal eviction with `abort` | Clear: sweep log line |
| `task-level` never reports the end of a task | Named: stall test | Same stall limit | Clear |
| Two working chats and a third send exceed `maxLive` | Named: cap test | Existing decline log | Clear: log line |
| A silent long background shell runs over four hours | No | Evicted as stalled; CLI reports the task on resume | Clear on resume |
| `abort` kills a Bash child mid-`git` and leaves `index.lock` | Existing stale-lock tests | Recovery is conditional and delayed: `git-stale-lock.ts` needs a lock 15 minutes old. A direct `git` call fails visibly until then | Clear |
| A server stop removes a task from the strip with no immediate notice | No | The parent learns on its next turn. There is no immediate notice to the person | Silent until the next turn: accepted, reported to the boxholder |
| `abort` during a parent turn loses that turn's final text | No | Only with live tasks, and only cap or sweep after stall, or maintenance when not busy | Clear on resume |
| A `task-level` frame is queued but not handled when a cap stop runs, so `stop()` picks `close` | No | Accepted. The turn that starts a task holds a pin until its `result`, and the frame comes first, so the gap is at most the `result` durability wait on an unpinned chat | Silent, near-nil reach |
| Live state survives a closed run | Named: run-close test | Cleared at close and start | Would be silent; the test covers it |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag or field: no vocabulary an agent writes. ADDRESSED by having none.
- Stale ref: not applicable; this reads no refs.
- Two agents on one card: unchanged. A longer-living subagent writes through the same locks.
- Hand-edit drift: no on-disk format.
- Fabricated value: ADDRESSED. The parent no longer sees a false denial from these paths, and the CLI's notice is accurate.
- Validation error UX: not applicable.
- Partial rollout: a deploy restarts the server, and shutdown takes the Track 2 path.

## NOT in scope

- The Stop button's meaning and `perTaskStopAffordance`: open in the decision issue.
- An "idle with N running" composer state: the feature issue.
- Changing the CLI's denial text: not ours. Filing upstream is a separate step for the boxholder.
- The 10-30 15:28 cluster with no eviction: noted in the issue, not chased.
- Dropping the Bash hook to avoid the suspected branch: it would hide the symptom and the subagent would still be orphaned.

## Open design questions

None block the work. The four-hour stall limit can kill a silent background shell that is still healthy, and the plan accepts that so a hung task cannot hold a process forever. The boxholder can change the constant.

## Knowledge audits

Skip: purely infrastructural, with no new agent-facing concept.

## What will hold this after it ships

`test/core/chat/session/registry.test.ts` holds the sweep and cap decisions, using the fake backend and the existing hand-advanced clock. `test/services/claude-chat.test.ts` holds the Claude contract: `abort` calls `Query.close()` and `close` does not. Neither adds a tier. The real-SDK probe is a one-off check recorded in this plan. It is not a kept test because it spends real model calls and takes minutes.

## Implementation order

1. Track 1 with its tests.
2. Track 2 with its tests.
3. Run the real-registry probe again against the changed code. Update `docs/chat.md` and the issue. Commit.

## Rollout shape

Done when these pass, using `emitMessage` with a `background_tasks_changed` frame:

- Sweep keeps a chat with a live task past the idle timeout. It evicts once the task clears and the chat has aged out.
- Sweep evicts a chat stalled past `BACKGROUND_STALL_MS`, through `abort`.
- Cap skips a working LRU chat and evicts the next one.
- `stop()` and `restart()` with a live task call `abort`. Without one they call `close`.
- A new run starts with no live tasks.

No migration. No data shape changes.
