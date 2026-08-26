---
title: "Chat Session Delete — Plan"
status: partial
workstream: unknown
issues: []
---
# Chat Session Delete — Plan

**Issues:**
[chat thread management](../../../issues/closed/features/2026-07-20-chat-thread-management.md)
(implements delete only) and
[stale husks outlive transcripts](../../../issues/closed/features/2026-07-29-stale-husks-outlive-their-transcripts.md)
(guards the unsafe open/resume path, but does not solve the full husk-lifecycle
policy).

**Job to be done:** A boxholder can permanently remove a junk or test
conversation's resumable transcript from this machine, remove the conversation
from active box navigation, and understand exactly what the operation does not
erase.

## Decision summary

Ship **true delete**, not editorial hide. A confirmed delete removes the SDK's
local resumable session data and then moves the git-tracked husk card to the
box's Trash. It does not offer a second “hide but retain the transcript” mode.
That is the direct reading of the launch-era request: test conversations should
not remain recoverable merely because callback-box removed their pointer.

The operation is deliberately asymmetric:

- The transcript and SDK sidecar directory are permanently removed from this
  machine.
- The husk card and its attachment scope move to the box's git-tracked Trash,
  so that editorial shell remains recoverable.
- Copies of the transcript on another machine are untouched.
- Claude Code prompt history, checkpoint/file-history, debug data, and other
  application caches are outside the installed SDK's per-session delete
  contract and are not claimed as erased.
- Anthropic-side API data follows Anthropic's retention policy and is untouched.
- Cards, files, memories, commits, and other effects produced by the
  conversation remain.

Delete order is a safety invariant. Every callback-box resume path is severed
before `deleteSession()` removes the transcript, and the husk is trashed last.
If a step fails before transcript removal, the operation compensates the owned
pointer/journal/schedule mutations it already made and stops without claiming
success. If cleanup fails after transcript removal, the API returns a typed
partial-completion result and the UI leaves an honest, retryable cleanup path.

## Stated preferences this plan trades against

- **Boxholder decisions from 2026-08-07:** delete is the soft-launch ask; use
  true delete behind a clear confirmation; explain local deletion versus
  Anthropic retention; warn that the conversation's effects stay; treat order
  and missing-transcript guards as correctness work, not polish.
- **Keep the feature narrow:** rename, archive, bulk delete, effect rollback,
  and husk garbage collection are not companions in this implementation.
- **`docs/engineering-principles.md`:**
  - #1, types are structure (`:12-21`): bootstrap availability and delete
    completion use discriminated unions rather than correlated nullable fields.
  - #3, validate at boundaries (`:37-47`): the tRPC input and editable husk
    `context-dir` are validated before any host path is resolved.
  - #4 and #5, resilient but never silent and caller-visible failure shapes
    (`:49-73`): an irreversible partial delete is returned explicitly.
  - #6, right-sized defensiveness (`:75-85`): only disk, process, lock, SDK, and
    git boundaries get recovery logic.
  - #8, one way to do each thing (`:95-104`): use the installed SDK's
    `deleteSession()` and the existing `trash` command rather than duplicating
    either mechanism.
  - #9, formal structure for essential complexity (`:106-114`): the ordered
    phases, lock ownership, and postconditions are named and tested.
  - #10, testability is architectural (`:116-125`): the orchestrator accepts
    narrow injected deletion/trash operations so failure stages are
    deterministic in doctests.
- **`code-style.md`:** exceptions carry causal detail for infrastructure
  failures; expected branchable outcomes use the repo Result convention; no
  catch silently converts an unknown failure to success.
- **`frontend.md`:** destructive appearance uses the semantic `danger` role,
  and a one-off confirmation stays feature-local rather than becoming a new
  global primitive (`:9-20`, `:107-113`).

## What already exists

### Session identity and local SDK storage

- The installed dependency is exactly
  `@anthropic-ai/claude-agent-sdk@0.3.222`
  (`package.json:97`). Contrary to an older sentence in the issue, this version
  already exports `deleteSession()`. Its declaration says: _“Without
  `sessionStore`: removes `{sessionId}.jsonl` and the `{sessionId}/`
  subagent-transcript subdirectory from the local projects dir”_
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:516-530`). The plan
  uses that API instead of manually unlinking the normal case.
- callback-box does not configure an SDK `sessionStore`. `buildQueryOptions`
  passes `cwd`, resume id, model, hooks, and other runtime options but no
  external store (`src/services/claude-chat.ts:84-120`). Therefore the SDK's
  local deletion branch is the current production contract.
- `getSessionLogPath()` derives the transcript path from the SDK cwd, and
  `CB_CLAUDE_PROJECTS_DIR` provides an isolated test override
  (`src/core/chat/session/transcript-paths.ts:31-50`).
- A husk's `context-dir` supplies that cwd; no history lookup participates
  (`src/core/chat/husk-transcript.ts:1-22`). Because the husk is editable, the
  delete path must validate containment before converting it to an absolute
  cwd.

### Husk cards and enumeration

- `ChatHuskEntry` carries the box-relative card path, authoritative SDK session
  id, optional context directory, and title (`src/core/chat/husk.ts:112-119`).
- The editable `session` field is currently accepted as any non-empty string
  (`husk.ts:149-174`). It is therefore identity metadata, not a safe path
  segment. Delete must parse it as the SDK's strict UUID shape before it reaches
  `path.join()`, and the core storage remover must repeat that assertion at the
  irreversible boundary.
- `findChatHuskEntry()` resolves by the authoritative `session` field, including
  renamed cards (`husk.ts:177-198`). Requiring this owned object before delete
  prevents an arbitrary session id from becoming authority to delete an
  unrelated SDK transcript.
- `loadAllSessions()` treats husks as the sole chat enumeration and skips a husk
  whose transcript is absent (`src/core/chat/session/list.ts:1-13,32-68`). This
  already keeps dead sessions out of pickers.
- `reconcileChatHusks()` runs after backfill on every boot and recreates a
  missing husk for a history entry with a transcript
  (`src/core/chat/husk.ts:200-238`; `src/webapp/routes/chat.ts:74-86`). A delete
  that trashes only the card is therefore unstable.
- The existing `trash` command moves a card and its attachment scope to
  `store/trash/`, handles name collisions, and can commit the move
  (`src/core/commands/trash.ts:58-149,233-250`). `runCommand()` is the shared
  invocation seam (`src/core/command-runner.ts:138-166`).

### callback-box pointers and journals

- `chat-session-history.json` is read and written only through
  `session/history.ts` and backfill; `appendHistory()` is an ordinary
  read-modify-write (`src/core/chat/session/history.ts:80-116,188-210`). No
  removal operation exists.
- Bare `/chat` resolves through `chat-session-id.json`; `getMostActive()` and
  `setMostActive()` are the current read/write operations
  (`session/history.ts:331-380`). There is no conditional clear, and a
  read-then-unlink without serialization could erase a newer session's pointer.
- Chat review persists a `sessions` record in
  `.callback-box/chat-review/state.json`
  (`src/core/chat/review/state.ts:1-20,69-90,104-135`). No removal operation
  exists.
- The review pass owns `.callback-box/chat-review/run.lock` for the whole
  read-review-write operation (`src/core/chat/review/run.ts:277-322`). Delete
  must share that lock or a finishing review can recreate the removed journal
  entry.
- These JSON files currently use direct writes. The repository already has
  `writeFileAtomic()` (`src/lib/atomic-write.ts`); deletion work should not add
  another crash-truncation window.

### Live sessions and scheduled resumes

- `ChatSessionRegistry.getOrCreate(id)` creates a resumable session on demand
  (`src/core/chat/session/registry.ts:196-238`). A delete reservation must make
  this operation reject that id while deletion is in progress.
- `ChatSession.stop()` clears its queue and starts an asynchronous close, but
  returns before the close handler has released the run lock
  (`src/core/chat/session/index.ts:423-436`; `session/consume.ts:91-103`). Delete
  needs an awaited stop/remove operation, not a call followed immediately by
  filesystem mutation.
- Schedules persist outside git and re-arm after restart
  (`src/core/chat/schedules.ts:1-10`). Each current schedule can carry its
  originating `sessionId` (`:24-38`), and firing calls
  `registry.getOrCreate(targetId)` (`src/webapp/routes/chat-schedule-fire.ts:126-141`).
  This is a fourth persisted resume path omitted from the issue's original
  three-layer model. Deletion must cancel these schedules and suppress a
  fire already racing with deletion; otherwise it can resume a deleted id or
  create a fresh fallback conversation.
- Chat startup currently launches backfill/reconcile in the background and
  then exposes `{ registry, scheduleManager, wireSession }` as the tRPC runtime
  (`src/webapp/routes/chat.ts:74-95,160-185`;
  `src/webapp/chat-runtime.ts:17-22`). The delete runtime must also expose the
  startup-maintenance promise so delete cannot race a late backfill write.

### API and UI surfaces

- Chat controls are tRPC procedures backed by the live runtime
  (`src/webapp/trpc/routers/chat-control-procedures.ts:15-21,36-117`) and merged
  into the chat router (`src/webapp/trpc/routers/chat.ts:78-81`). Delete belongs
  here rather than in a new raw Fastify route.
- `SessionRow` is shared by both landmark chat pickers and currently contains
  only the chat link and husk link
  (`src/frontend/src/components/session-pickers/SessionRow.tsx:1-8,45-83`). One
  row affordance reaches both picker surfaces.
- `AdvancedPanel` already contains process controls and session metadata
  (`src/frontend/src/components/chat/SessionChip-advanced-panels.tsx:41-57`).
  The current-session delete action belongs below those controls, separated as
  a destructive action.
- `ChatHuskView` renders `Open chat →` unconditionally
  (`src/frontend/src/components/chat-husk/ChatHuskView.tsx:15-20,68-74`). This is
  the unsafe dead-husk path.
- `chat.bootstrap` currently always returns a concrete session's history,
  label, and status, even when the transcript load degrades to an empty result
  (`src/webapp/trpc/routers/chat-bootstrap-procedure.ts:27-68`). The frontend
  then mounts the interactive chat machine (`src/frontend/src/pages/ChatPage.tsx:165-187,265-280`).
  Availability needs to be explicit before that mount.

## Prior art (external)

- Anthropic's current Agent SDK session-storage documentation says local JSONL
  under `~/.claude/projects/` is the default and defines deletion of the main
  session key as cascading to its subkeys. That matches the installed
  `deleteSession()` declaration and supports treating the SDK API as the
  storage authority:
  <https://code.claude.com/docs/en/agent-sdk/session-storage>.
- Anthropic's current `.claude` directory documentation distinguishes the
  transcript and subagent/tool-result directory from `file-history`, prompt
  `history.jsonl`, tasks, debug logs, caches, and other application data. Its
  project-wide purge is intentionally broader than one-session deletion:
  <https://code.claude.com/docs/en/claude-directory>. callback-box must not
  silently imitate a project purge when the user selected one conversation.
- The SDK's missing-resume failure is documented in
  [anthropics/claude-agent-sdk-typescript#47](https://github.com/anthropics/claude-agent-sdk-typescript/issues/47).
  The installed code still constructs a resumed run directly from the id, so
  callback-box needs its own availability guard even though deletion now has an
  upstream API.
- Confirmation links use the current official policy pages rather than
  hard-coded retention durations:
  [Claude Code data usage](https://code.claude.com/docs/en/data-usage) and
  [Anthropic API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).
- Managed cloud-agent “delete session” APIs are not prior art for this storage
  path. callback-box uses the local Claude Agent SDK without a hosted
  `SessionStore`; importing a cloud resource lifecycle would misstate the
  system.

## Tracks / scope

### Track A — Make session deletion a named lifecycle

**What:** Add a per-session deletion reservation and an awaited stop/remove
operation to `ChatSessionRegistry`; add the ordered orchestrator at
`src/core/chat/session/delete.ts`.

**Why:** `stop()` is fire-and-forget and `getOrCreate()` can race a delete. A
filesystem-only helper cannot make the required “nothing can resume this id”
claim.

**Direction:**

1. Add `SessionDeletingError` and a per-id deletion-state map to the registry.
   `beginDelete(sessionId)` moves the id to `deleting` before any stop. While in
   `deleting` or `deleted`, `getOrCreate()`, sends, restart/reset controls, and
   schedule delivery reject with that typed error. `get()` may return the
   existing object only to the deletion path; ordinary control procedures treat
   it as unavailable.
2. Add `stopAndRemove(sessionId): Promise<void>`. If no entry exists, it is a
   no-op. If the session is idle, remove it immediately. If it has a run, call
   stop and await its `close` event plus run-lock release before removing the
   registry entry. The close wait has a bounded timeout and returns a typed
   infrastructure failure; delete does not continue to the transcript while
   the process may still write.
3. The state machine is explicit:
   - `deleting` rejects a concurrent second delete and all resume/send paths;
   - `deleted` rejects resume/send/schedule paths but admits an idempotent delete
     retry for remaining cleanup;
   - an ordinary failure before SDK deletion compensates owned state and clears
     the reservation;
   - a failure after SDK deletion transitions to `deleted` for the lifetime of
     the server.
     A server restart reconstructs safety from the removed pointers/husk and
     missing transcript; a retained husk remains the cleanup-retry anchor.
4. `deleteChatSession()` takes `{ boxRoot, sessionId, runtime }` plus narrow
   injected SDK-delete and trash runners for doctests. It owns the phase order
   and is the only production caller of the lower-level removal functions.
5. Await startup backfill/reconcile before reserving. Preflight then parses the
   input as a strict UUID, and collects **every active husk** whose parsed
   `session` matches it. For an idempotent retry it also finds matching chat
   cards already in box Trash, so a crash after move but before commit does not
   destroy the cleanup receipt. The cards must resolve to one consistent SDK
   cwd through a box-containment helper. Active duplicate husks are all trashed
   in the final phase; conflicting context bindings fail before mutation. A
   matching active-or-trashed box card is deletion authority; a session id alone
   never is.
6. Emit one structured log record at confirmed start and after every phase
   transition (session UUID, box-relative husk paths, phase, counts, outcome;
   never host transcript paths or message content). These records make an
   interrupted destructive operation diagnosable even when no HTTP result was
   returned.

**Vocabulary/contracts:**

- `deletion reservation`: in-process prohibition on creating or sending to one
  session id.
- `compensated failure`: no SDK transcript data has been removed and every
  detached callback-box reference/schedule was restored; reported as an
  exception/tRPC error and safe to retry in place.
- `cleanup-required`: the resumable transcript is gone, but a later owned-state
  cleanup did not reach its postcondition, or pre-SDK compensation itself was
  incomplete. This is a typed mutation outcome with an explicit retry, not a
  generic failure.

**First shippable chunk:** Registry reservation + awaited stop doctests, with no
UI or disk deletion yet.

### Track B — Remove every callback-box resume pointer in order

**What:** Add the two persisted-index removal functions in their owning
modules, conditional pointer clearing, schedule cancellation, and review-lock
coordination.

**Why:** Leaving any of these behind can resurrect the husk, reopen the SDK id,
or recreate removed journal state.

**Direction:**

1. The two new persisted-index removal functions live exactly here:
   - `removeSessionFromHistory(boxRoot, sessionId)` in
     `src/core/chat/session/history.ts`. It removes every exact matching history
     entry, preserves `migrated` and all other entries byte-semantically, and is
     idempotent.
   - `removeSessionFromReview(boxRoot, sessionId)` in
     `src/core/chat/review/state.ts`. It deletes only
     `state.sessions[sessionId]`, preserves `lastRunAt`, and is idempotent.
2. Add `clearMostActiveIfMatches(boxRoot, sessionId)` beside the existing
   pointer functions in `history.ts`. It conditionally writes
   `{ sessionId: null, savedAt: <preserved value> }`: bare `/chat` sees no
   session, while `getMostActiveSavedAt()` keeps the box's real last-activity
   signal. The reader already treats a non-string id as no active session; the
   writer/type become explicitly nullable and backward compatible.
3. Enumerate every history/pointer writer, then serialize their in-process
   read-modify-write sections through one keyed async mutex (the repository's
   `withCardLock`-style primitive), including existing append/update writers.
   The current writers all run in the one box server; do not add a cross-process
   filesystem lock to every send unless implementation finds a real external
   writer. Use `writeFileAtomic()` for history, pointer, and review state.
4. Extract the chat-review lock ownership into
   `src/core/chat/review/lock.ts`; both `runChatReview()` and delete use the same
   helper. Delete acquires this lock before any owned-state mutation and fails
   early with a retryable conflict if a review is active. It holds the lock
   through review-state removal and transcript deletion, so a review cannot
   recreate the session entry from an already-read transcript.
5. Add `ChatScheduleManager.blockForDeletion(sessionId)`,
   `detachForSession(sessionId)`, and `restoreDetachedSchedules(receipt)`.
   Block is set immediately after the registry reservation, before awaited
   process stop. Schedule manager state retains an in-flight entry until its
   callback settles, so detach can collect both armed and already-fired linked
   schedules; a generation/token prevents a late callback from deleting a
   restored entry. Detach clears matching timers, removes matching persisted
   entries in one write, and returns the exact schedules plus count. Schedule
   delivery consults the registry reservation and never uses the fresh-session
   fallback while blocked. An id-less legacy schedule is deliberately not
   attributed or canceled.
6. Apply the ordered sequence:
   - reserve the registry id and block linked schedule delivery;
   - stop the live session and await close/run-lock release;
   - detach all schedules linked to the id;
   - conditional-clear most-active;
   - remove history entry;
   - remove review entry;
   - invoke the SDK storage remover.
     Capture the exact prior pointer, history entry, review entry, and detached
     schedules before mutation. If any ordinary error occurs before the SDK
     postcondition says the conversation is gone, restore those snapshots while
     their locks are still held, log compensation failures loudly, and return a
     named cleanup-required state if full compensation is impossible. Never call
     pointer/history removal “non-destructive” merely because the JSONL remains.

**Vocabulary/contracts:** “history removal” means removal from
`chat-session-history.json`; it does not include the most-active pointer.
“Review removal” means one key in the machine-local review journal, never the
generated title or account side effects written elsewhere.

**First shippable chunk:** Focused doctests for exact history removal,
compare-and-clear, review removal under lock, and linked-schedule detach/restore.

### Track C — Delete SDK storage and trash the husk last

**What:** Wrap the SDK delete contract with explicit pre/postconditions, then
reuse the `trash` command's extracted move/commit mechanism for the owned cards.

**Why:** The SDK owns normal session layout; callback-box owns the box card.
They have different recoverability and must not be collapsed into one vague
“file delete.”

**Direction:**

1. `deleteSdkSessionStorage({ cwd, sessionId })` first validates `sessionId` as
   a strict UUID again, then imports and calls
   `deleteSession(sessionId, { dir: cwd })` when the main JSONL exists. The
   resolved cwd has already passed real/lexical box containment.
2. If the JSONL is already absent, treat the conversation as locally
   unresumable and remove only the exact sibling `<sessionId>/` orphan if it
   exists. This is the narrow exception to the SDK path: the SDK contract throws
   when the main session is absent, but stale-husk cleanup still needs to remove
   an orphan sidecar. Never glob, recurse from an encoded project root, or infer
   targets from user text.
3. Postcheck the JSONL and sibling directory independently. If both remain, the
   SDK made no storage change: compensate owned state and report a normal
   failure. If exactly one remains, make one exact cleanup attempt; if that also
   fails, return `cleanup-required` with `storage: "partial"`, keep the active
   husk as a retry anchor, and keep the registry in `deleted` so the damaged
   session cannot resume. If neither remains, storage is `absent`. Do not expose
   host absolute paths to the client.
4. Refactor the existing `trash` command's move and commit internals into a
   reusable receipt-bearing core operation; the CLI command and session delete
   compose the same functions. After the storage postcondition, move **all**
   matching husks and attachment scopes, then commit once with reason
   `Deleted chat conversation` and the normal trash trailer. Do not invoke
   `runCommand()` as a black box: today a commit exception loses the already-
   moved receipt, which is insufficient for typed partial cleanup.
5. If move or commit fails after SDK deletion, return `cleanup-required` with
   the receipt's actual state (`huskTrashed`, `commitPending`) and the matching
   retry (`trash-husk` or `commit-trash`). The UI navigates away from the dead
   session. A moved-but-uncommitted card is not falsely described as a retained
   active husk.
6. Emit the existing file-change invalidation only through the trash/commit
   machinery if it already does so; otherwise explicitly invalidate the tRPC
   session lists after mutation. Do not synthesize a fake active replacement
   session server-side.
7. The SDK's `dir` option can search related git worktree project paths, while
   callback-box's `CB_CLAUDE_PROJECTS_DIR` override is not itself an SDK option.
   A real-SDK probe must establish cwd/worktree lookup and root behavior under
   `CLAUDE_CONFIG_DIR`. The orchestrator treats a disagreement between its exact
   preflight target and the SDK's post-state as a named storage-configuration
   error, not a generic retry loop.

**Vocabulary/contracts:** `storage: "absent"` means the SDK JSONL and sibling
session directory are absent on this machine; `"partial"` means exactly one
remains after cleanup failed; `"present"` means neither was removed. None of
these values describe every Claude Code cache, another machine, Anthropic data,
or conversation effects.

**First shippable chunk:** An orchestrator doctest uses the injected delete
runner under isolated `CB_CLAUDE_PROJECTS_DIR`; a separate real-SDK probe under
isolated `CLAUDE_CONFIG_DIR` proves normal, worktree, missing, and orphan
semantics without touching user transcripts.

### Track D — tRPC mutation and confirmation UI

**What:** Add `chat.deleteSession`, shared confirmation UI, and affordances in
the two picker/current/husk surfaces.

**Why:** Delete must be available where people encounter junk chats, but one
confirmation contract should explain every entry point consistently.

**Direction:**

1. Add `deleteSession` to `chat-control-procedures.ts`, input
   `{ sessionId: strictSdkSessionIdSchema }`. It requires the live runtime and
   invokes only `deleteChatSession()`. A missing or mismatched active/trashed
   husk is `NOT_FOUND`; a review/delete lock conflict is `CONFLICT`; compensated
   infrastructure failures are `INTERNAL_SERVER_ERROR` with a safe message and
   logged cause.
2. Return a discriminated result:

   ```ts
   type DeleteChatResult =
     | { status: "deleted"; sessionId: string; schedulesCancelled: number }
     | {
         status: "cleanup-required";
         sessionId: string;
         storage: "present" | "partial" | "absent";
         retry: "delete-again" | "trash-husk" | "commit-trash";
         huskTrashed: boolean;
         commitPending: boolean;
       };
   ```

   Keep host paths and raw SDK errors server-side.

3. Add a feature-local `DeleteChatDialog` under
   `components/chat-delete/`. It owns accessible dialog focus, Escape/Cancel,
   pending state, and the single mutation. It accepts the session id, label,
   and husk path; entry points do not duplicate copy or mutation logic.
4. Confirmation shape:
   - Heading: **Delete this conversation?**
   - Lead: **The resumable conversation on this machine will be permanently
     deleted. This cannot be undone.**
   - “Removed” list: SDK transcript, subagent/session sidecars on this machine;
     active chat listing; pending reminders **linked to** this conversation. The
     husk card moves to box Trash and remains git-recoverable.
   - “Stays” list: cards/files/memories and other effects; transcript copies on
     other machines; Claude Code prompt-history/checkpoint/debug caches;
     Anthropic API data governed by the linked retention policy.
   - Links:
     [Claude local data](https://code.claude.com/docs/en/claude-directory) and
     [Anthropic retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).
   - Buttons: `Cancel` and semantic-danger `Delete permanently`. Do not require
     typing the title; the two-step invocation plus explicit irreversible copy
     is enough for one conversation.
5. Affordances:
   - `SessionRow`: a trailing overflow/delete control outside both links. This
     automatically covers `ChatsLandmarkCard` and `LandmarkSessions`.
   - current `SessionChip` Advanced panel: `Delete conversation…` below a
     divider, disabled until a real session id exists.
   - `ChatHuskView`: `Delete conversation…` remains available when the local
     transcript is already missing, so stale or ran-elsewhere husks can be
     cleaned intentionally.
6. On `deleted`, invalidate `chat.sessions`, `chat.byLandmark`, bootstrap, and
   affected card queries, then navigate a current deleted chat to
   `?session=new`. On `cleanup-required` with `storage: "partial" | "absent"`,
   also navigate away and show the precise remaining cleanup action. Never
   leave the chat machine mounted on a deleted or partially deleted id.
7. The web UI is loaded inside the iOS `WKWebView`, so these affordances ship to
   iOS without a new native bridge contract. Verify the dialog at phone width;
   no separate native-delete API is added.

**First shippable chunk:** Mutation + dialog from the current-session Advanced
panel, followed by shared picker and husk affordances.

### Track E — Make missing transcripts an explicit unavailable state

**What:** Guard every open/send path for a session whose local transcript is
missing, independent of deletion.

**Why:** A dead husk already exists through retention or cross-machine sync.
Delete is incomplete if it merely creates one more way to reach the existing
resume crash.

**Direction:**

1. Replace the flat `ChatBootstrap` interface with a discriminated union:
   - `kind: "empty"`, no resolved session;
   - `kind: "resumable"`, concrete session with history;
   - `kind: "unavailable"`, concrete session and reason
     `"missing-local-transcript"`, but no history payload.
2. For an explicit or most-active id, first ask the registry whether that exact
   assigned id is live/pending. A live first turn is `resumable` even before its
   first transcript flush. Otherwise resolve its owned husk and stat the exact
   local transcript before loading history. Missing is `unavailable`; EACCES,
   EIO, and malformed state remain loud failures rather than being mislabeled
   missing.
3. `ChatPage` never mounts `InteractiveChat` for `unavailable`. It renders an
   explanation that the transcript is not on this machine, links to the husk,
   and offers `Start a new conversation` plus `Delete conversation…`. This
   avoids claiming “expired,” because the session may have run elsewhere.
4. Add `chat.sessionAvailability` for `ChatHuskView` (or share the same server
   resolver behind bootstrap and a smaller query). The husk renders `Open chat`
   only for `resumable`; otherwise it renders `Not available on this machine`
   as text, not a link.
5. Raw send and schedule-fire routes consult the same availability/deletion
   guard before `getOrCreate()`. Direct HTTP calls and stale clients therefore
   cannot bypass the UI. Missing transcript is a named client-visible failure,
   not an SDK subprocess crash. Fresh sessions remain unaffected.

**First shippable chunk:** Server availability resolver + bootstrap union +
ChatPage unavailable shell, then the husk and direct-send guards.

## Could this be simpler?

Yes, but the simpler variants fail the stated job:

1. **Trash only the husk (editorial delete).** This is one existing command and
   is fully git-recoverable. It leaves the conversation in
   `~/.claude/projects`, lets history reconciliation resurrect the husk, and
   does not meet the user-ownership framing. Rejected.
2. **Delete only the SDK transcript and husk.** This omits history, most-active,
   review, schedules, and a live subprocess. It can crash a resume, resurrect a
   husk, or fire a reminder into a deleted id. Rejected.
3. **Call `claude project purge`.** This is operationally simple but deletes all
   sessions, project prompt history, auto memory, and other project data. It is
   the wrong scope for one conversation. Rejected.
4. **Manually unlink all Claude paths.** This duplicates the installed SDK's
   storage contract and will drift. Use `deleteSession()` for the normal case;
   retain only the exact orphan-sidecar fallback the SDK cannot reach without a
   main transcript.
5. **No deletion reservation; trust UI invalidation.** Schedules, stale tabs,
   direct HTTP calls, and an already-running subprocess are not controlled by
   React state. Rejected.

The proposed shape is the smallest one that makes “this session cannot resume
after its transcript is removed” a server-enforced invariant.

## Subplans

No separate subplan is required. The work is cross-layer but follows one
ordered operation, one API mutation, and one shared dialog. Splitting the
lifecycle, state, and UI into independent plans would hide the correctness
contract between them. If implementation reveals that converting all history
writers to shared in-process serialization is materially larger than expected,
extract that mechanical conversion as a commit-sized preliminary track, not a
separate design.

## Failure modes

| Failure                                                                     | Detection                                                              | Behavior                                                                                                                        | Retry/recovery                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Session id is not a strict SDK UUID                                         | Shared schema at tRPC and storage boundaries                           | Reject before path construction; no mutation                                                                                    | Repair malformed husk                                        |
| Session id does not belong to a readable active-or-trashed husk in this box | Preflight scans exact chat-card scopes and matches parsed id           | `NOT_FOUND`; no mutation                                                                                                        | Refresh or open the actual husk                              |
| Husk `context-dir` escapes the box or resolves through an unsafe symlink    | Lexical + realpath containment before SDK cwd construction             | Hard boundary error; no mutation                                                                                                | Fix the card binding                                         |
| Startup backfill/reconcile is still running                                 | Await runtime maintenance promise                                      | Delete waits before reservation/state reads                                                                                     | Automatic                                                    |
| Same session is `deleting`                                                  | Registry state                                                         | `CONFLICT`; no second operation                                                                                                 | Wait and refresh                                             |
| Same session is `deleted` but cleanup remains                               | Registry state                                                         | Admit idempotent cleanup retry; continue to exact remaining postconditions                                                      | Automatic from dialog retry                                  |
| Chat review owns its lock                                                   | Shared review lock acquire fails before mutation                       | `CONFLICT`; no mutation                                                                                                         | Retry after review                                           |
| Live SDK run does not close/release its lock before timeout                 | Awaited registry stop                                                  | Abort before pointers/transcript; log session id and phase                                                                      | Retry after process settles or restart server                |
| Schedule timer fires during delete                                          | Registry reservation checked by fire path                              | Drop this target during deletion; never fresh-session fallback                                                                  | If SDK deletion later fails, detached schedules are restored |
| Another session becomes most-active during delete                           | Shared in-process history serialization + compare-and-clear            | Preserve newer pointer                                                                                                          | None                                                         |
| History/review JSON is malformed                                            | Existing validated reader behavior plus named delete failure           | Abort before SDK delete; never overwrite malformed state with empty                                                             | Repair state, retry                                          |
| Atomic history/review write fails                                           | Exception before SDK delete                                            | Compensate prior owned-state changes; release reservation only after full compensation                                          | Retry after storage repair                                   |
| Transcript vanished before delete                                           | Preflight sees missing JSONL                                           | Treat as already unresumable; remove exact orphan sidecar, continue                                                             | Normal stale-husk cleanup                                    |
| SDK delete throws and JSONL still exists                                    | Postcheck                                                              | Restore captured history/review/pointer/schedules; report compensated failure, or cleanup-required if restoration is incomplete | Retry; no success claim                                      |
| SDK changes only JSONL or sidecar and exact cleanup also fails              | Independent postcheck                                                  | `cleanup-required`, `storage: "partial"`; registry blocks resume and active husk remains a retry anchor                         | Retry exact remaining storage cleanup                        |
| Trash move or git commit fails after transcript removal                     | Receipt plus filesystem/git postcheck                                  | `cleanup-required`, `storage: "absent"`; accurately report retained vs moved vs commit-pending husks                            | Retry the exact remaining phase                              |
| Client has deleted chat open in another tab                                 | Server reservation and missing-transcript guard                        | Send fails as deleted/unavailable; tab refreshes to unavailable shell                                                           | Start new chat                                               |
| Transcript exists only on another machine                                   | Local preflight sees missing                                           | Delete removes box pointers/husk here but cannot touch remote transcript                                                        | Confirmation disclosed; delete separately there if needed    |
| Process exits between owned-state phases                                    | Structured start/phase logs plus retained husk and startup diagnostics | No false success; exact session/last phase is discoverable, and retry derives cwd from husk rather than removed history         | Retry delete; kill-point rehearsal verifies each phase       |
| Anthropic changes retention URL/policy                                      | Links point to canonical docs, no duration copied                      | Copy remains policy-neutral                                                                                                     | Verify links at implementation/release time                  |

**Most dangerous gap if ignored:** a producer that can still call
`registry.getOrCreate(deletedId)` after transcript removal. This is why live
stop, the registry reservation, persisted schedule cancellation, and direct
send/schedule guards are one Track A/B/E invariant rather than optional
hardening.

## Agent-flow edge cases

- **ADDRESSED — active turn:** deletion stops and awaits the run before removing
  pointers. It does not preserve queued user messages.
- **ADDRESSED — background task/subagent:** awaited SDK close precedes the SDK
  cascade; the sibling session directory is postchecked absent.
- **ADDRESSED — agent-created reminder:** schedules carrying the session id are
  canceled and disclosed as reminders linked to the conversation; unattributed
  legacy schedules remain.
- **ADDRESSED — schedule already firing:** deletion reservation suppresses both
  target delivery and fresh-session fallback.
- **ADDRESSED — review agent active:** shared review filesystem lock prevents journal
  resurrection and avoids deleting a transcript being reviewed.
- **ADDRESSED — failure before SDK removal:** exact detached schedules and owned
  state snapshots are restored before the reservation is released.
- **ADDRESSED — stale client bypasses UI:** raw send path performs the same
  availability/reservation check.
- **DEFERRED — attribute and reverse conversation effects:** existing commit
  trailers may support a future “what changed?” report, but delete never reverts
  those effects.
- **DEFERRED — delete upstream/local copies on every machine:** no sync protocol
  exists for SDK transcripts.
- **GAP — Claude Code cache-specific per-session keys:** the installed SDK does
  not expose a supported one-session purge for prompt history, file-history,
  tasks, debug, or caches. The UI discloses this instead of guessing paths.

## User-flow edge cases

- **ADDRESSED — delete current chat:** after confirmed completion, navigate to a
  fresh chat; never choose and auto-open another historical session.
- **ADDRESSED — delete from picker:** the row remains until server success, then
  shared queries invalidate and focus returns to a stable nearby control.
- **ADDRESSED — delete stale husk:** available from `ChatHuskView` and the
  unavailable chat shell even though pickers omit it.
- **ADDRESSED — accidental first click:** the affordance always opens a dialog;
  no row action deletes immediately.
- **ADDRESSED — double submit:** pending state disables dismissal and duplicate
  mutation; server reservation is the second guard.
- **ADDRESSED — long title or no title:** dialog truncates visually but labels
  the target by title fallback/session prefix; identity is always the hidden
  full session id sent to the server.
- **ADDRESSED — phone/iOS webview:** dialog scrolls internally, keeps both
  buttons reachable above safe-area/keyboard constraints, and requires a manual
  narrow-width check.
- **ADDRESSED — partial irreversible completion:** UI says which part succeeded,
  navigates away if the transcript is gone, and gives one retry action.
- **ADDRESSED — no transcript on this machine:** copy says “not available on
  this machine,” not “expired.”
- **DEFERRED — bulk selection/delete:** one conversation per confirmation in
  this release.
- **DEFERRED — undo:** only the husk card is git/trash-recoverable; the dialog
  never presents a global Undo.

## NOT in scope

- Rename or archive operations from the umbrella thread-management issue.
- Bulk delete, retention policies, automatic garbage collection, or automatic
  stale-husk archive/delete.
- Reverting cards, files, memories, commits, external messages, captures, or
  any other side effects caused by the conversation.
- Removing transcripts from another callback-box host or syncing tombstones
  between machines.
- Editing Claude Code's global prompt history, file-history/checkpoints, tasks,
  debug logs, caches, stats, backups, or configuration.
- Deleting or requesting deletion of Anthropic-side API data.
- A native iOS bridge or native confirmation sheet.
- A generic modal/dialog framework.
- Restoring a transcript from box git history; it was never stored there.

## Open design questions

1. **Approval required:** Is the explicit cache limitation acceptable for the
   label `Delete permanently`? The plan's recommendation is yes because the
   object named by the UI is the resumable conversation, and the dialog names
   the excluded cache copies. If the intended promise is “remove every local
   byte that may contain a prompt or file snapshot,” this plan must stop and
   become a broader Claude application-data purge design.
2. **Approval required:** Should a stale/ran-elsewhere husk be deletable from
   this machine? Recommendation: yes, with the other-machine disclosure. The
   boxholder is deleting the box's durable pointer intentionally; silently
   disabling delete would make stale junk impossible to clear.
3. **Implementation verification:** Confirm the installed SDK's thrown error
   and post-state for (a) normal JSONL + sidecar, (b) JSONL only, and (c) orphan
   sidecar using an isolated `CLAUDE_CONFIG_DIR`/projects fixture before relying
   on the orphan fallback. This is verification of the chosen API, not a design
   fork.

## Knowledge audits

None. This feature changes the web/backend lifecycle and user-facing copy; it
does not change what a box agent is expected to know or do. Doctests and manual
UI validation are the appropriate evidence.

## Implementation order

1. Add an isolated real-SDK behavior probe under `CLAUDE_CONFIG_DIR` and lock
   down strict UUID, raw cwd, git-worktree search, configured-root equivalence,
   normal, missing, and orphan-sidecar postconditions. Orchestrator doctests use
   an injected delete runner rather than assuming `CB_CLAUDE_PROJECTS_DIR`
   controls the SDK.
2. Add registry deletion reservation and awaited stop/remove; add lifecycle and
   race doctests.
3. Enumerate history/pointer writers; add shared in-process serialization, atomic writes,
   `clearMostActiveIfMatches()`, and `removeSessionFromHistory()`; extend
   `chat-session-history.doctest.md`.
4. Extract the review lock helper, add atomic state writes and
   `removeSessionFromReview()`; extend review state/run doctests.
5. Add detach/restore-for-session schedule operations and schedule-fire deletion
   suppression; extend schedule manager and schedule-fire doctests, including an
   id-less legacy schedule that must remain untouched.
6. Add `deleteSdkSessionStorage()` and `deleteChatSession()` with strict UUID
   revalidation, injected boundaries, exact state snapshots, and compensation;
   add one ordered full-stack core doctest with failure injection at every
   phase.
7. Add the tRPC mutation and typed result; add webapp procedure doctests for
   ownership validation, result mapping, and idempotent retry.
8. Add the availability resolver, bootstrap union, ChatPage unavailable shell,
   husk guard, and raw send/schedule guards; extend bootstrap and send doctests.
9. Refactor trash into receipt-bearing move/commit functions shared by `cb rm`
   and delete; cover duplicate husks and moved-but-uncommitted recovery.
10. Add `DeleteChatDialog`, then wire current SessionChip, shared SessionRow, and
    ChatHuskView affordances. Add pure frontend tests for copy/result routing
    where useful.
11. Update both issues with the delivered scope and the corrected SDK/schedule
    findings. Keep thread management open for rename/archive; keep stale-husks
    open for the remaining lifecycle policy.
12. Run focused doctests, then callback-box typecheck, lint, and full tests.
    Perform manual browser checks at desktop and phone widths, including delete
    current, picker delete, stale husk, cancel, double-click, and injected
    partial cleanup.

## Rollout shape

- **No migration pass.** Existing husks, history, review state, and schedules
  remain readable. Conditional pointer clear makes the existing `sessionId`
  field explicitly nullable on its next write while preserving `savedAt`.
  Removal functions are idempotent and act only when the user confirms one
  session.
- **No feature flag.** The confirmation is the safety gate, and hiding server
  correctness behind a flag would not protect stale direct send paths. Ship the
  availability guard and delete mutation together.
- **Test-box rehearsal before merge:** create a disposable chat in this
  worktree's isolated test box, create a schedule in it, keep another chat as
  most-active, delete the target, and verify:
  - target JSONL and sibling directory are absent;
  - another session's pointer/history remain;
  - target history/review/schedules are absent;
  - husk and attachment scope are in Trash with a commit;
  - reload, stale direct URL, and server restart cannot resume or resurrect it;
  - effects the chat created remain.
- **Manual stale-husk rehearsal:** use a disposable fixture whose transcript is
  absent; verify unavailable copy, disabled Open link, orphan cleanup, and the
  other-machine warning without touching a real user transcript.
- **Crash rehearsal:** in an isolated box/Claude config, kill the server after
  each logged phase (reservation, stop, schedule detach, pointer/history/review
  removal, SDK deletion, husk move, commit). On restart, verify the retained
  husk and phase diagnostics make the state discoverable, an idempotent retry
  reaches the correct postconditions, and no unrelated session/pointer/schedule
  changes.
- **Verification gate:** focused doctests, `pnpm typecheck`, lint, and the full
  callback-box test command must pass. Any accepted parallel doctest flake is
  reported separately from the focused serial result; it is not called green.
- **Deployment:** merge to `main` only after boxholder approval and cross-model
  review disposition. Main's normal hook deploys callback-box. Report merge,
  deploy, runtime health, and manual browser validation as separate states.
