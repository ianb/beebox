# Plan Engineering Review — Chat Session Delete

Reviewer: Claude Fable, cross-model from Codex, 2026-08-07. Read-only review
fenced to `chat-session-delete.md`, both linked issues, the installed SDK
declaration, and the named chat lifecycle/state/UI sources. Ten findings.
Accepted changes are folded into `chat-session-delete.md`.

## Findings and dispositions

### 1. Blocker — editable session id can steer a recursive host delete

**Reviewer finding:** `readChatHusk()` accepts any non-empty `session` string.
The plan validated editable `context-dir` containment but allowed that session
string to reach `path.join()` and the recursive orphan-sidecar delete. A value
such as `../../...` could escape SDK session storage.

**Disposition: accepted; plan blocker corrected.** The tRPC input uses a shared
strict SDK UUID schema, preflight rejects malformed husks, and
`deleteSdkSessionStorage()` repeats UUID validation immediately before path
construction. The core boundary does not trust successful HTTP parsing.

### 2. High — a permanent reservation made cleanup retry unreachable

**Reviewer finding:** The draft said a reservation remains after completed
delete but did not define whether `cleanup-required` was completed. The same
mutation could then reject its own retry forever.

**Disposition: accepted.** The registry now has named `deleting` and `deleted`
states. `deleting` rejects a concurrent delete; `deleted` rejects resume/send
but admits idempotent cleanup. Every pre/post-SDK failure states its transition.

### 3. High — pointer removal is already consequential before SDK deletion

**Reviewer finding:** Calling every pre-SDK error “pre-destructive” hid lost
history context/features, review progress, and schedules. A landmark session
can remain resumable while its history binding is already gone.

**Disposition: accepted; design changed.** The orchestrator snapshots pointer,
history, review, and linked schedules. Before the SDK postcondition, an ordinary
failure restores those snapshots while locks are held. The vocabulary is now
`compensated failure`; incomplete compensation is explicitly
`cleanup-required`.

### 4. High — transcript stat alone misclassifies a live first turn

**Reviewer finding:** A just-assigned live session can exist before the first
JSONL flush. The draft availability resolver would render it unavailable during
that window.

**Disposition: accepted.** Registry-live/pending identity wins over the disk
stat. Only a session with no live/pending registry object and no transcript is
`missing-local-transcript`.

### 5. Medium — SDK `dir` and storage-root semantics need a real probe

**Reviewer finding:** SDK `dir` follows `listSessions()` semantics and may search
related git worktrees. `CB_CLAUDE_PROJECTS_DIR` is callback-box's override, not
the SDK's; a fixture using only it cannot prove real SDK deletion.

**Disposition: accepted.** The plan separates injected orchestrator doctests
from a real-SDK probe under isolated `CLAUDE_CONFIG_DIR`. It requires cwd,
worktree, root-equivalence, missing, and orphan behavior to be pinned before
implementation relies on the API. Root disagreement is a named configuration
failure.

### 6. Medium — cross-process history file locking is likely overbuilt

**Reviewer finding:** Named history/pointer writers appear to run in one server
process; repository lock guidance reserves filesystem locks for cross-process
coordination and uses an async keyed primitive in-process.

**Disposition: accepted with verify-first wording.** Implementation enumerates
writers and uses shared in-process serialization if that audit holds. The
cross-process filesystem lock remains only for chat review, where CLI and server
really can overlap.

### 7. Medium — duplicate husks would leave a dead card behind

**Reviewer finding:** `findChatHuskEntry()` returns one match, but renamed-husk
duplication is a documented current state. Trashing only that match leaves
another card pointing at the erased session.

**Disposition: accepted.** Preflight collects all matching husks, requires one
consistent context binding, and trashes all of them in one final commit.

### 8. Low — confirmation over-promised schedule cancellation

**Reviewer finding:** Legacy schedules have no `sessionId`, so they cannot be
attributed or canceled by session.

**Disposition: accepted.** Copy now says reminders “linked to” the conversation.
Tests and rollout retain an id-less legacy schedule and verify its existing
most-active fallback behavior.

### 9. Low — no crash-mid-sequence evidence

**Reviewer finding:** Returned-failure injection does not cover process death
between ordered phases, and the draft had no durable/auditable indication of
the last phase.

**Disposition: accepted as observability and rollout work.** The orchestrator
emits structured start/phase/completion records without host-path leakage. A
kill-after-each-phase rehearsal verifies that the retained husk and phase record
make retry discoverable and that an idempotent retry reaches all postconditions.
The plan does not add a persistent auto-resume journal in v1; the husk-last rule
keeps the explicit retry anchor, and expanding confirmation into autonomous
startup deletion would require a separate product decision.

### 10. Low — unlinking most-active also erases box last-activity

**Reviewer finding:** `getMostActiveSavedAt()` reads the same pointer file. An
unlink makes a box with prior chat activity look as if it has none.

**Disposition: accepted.** Conditional clear writes a backward-compatible null
session id while preserving `savedAt`; bare `/chat` resolves to no session and
box activity remains truthful.

## Additional synthesis from the primary agent

The review's trash-command check confirmed reuse is appropriate, but the draft
still treated move + commit as if failure were atomic. It is not: the current
command can move cards and then lose the receipt when commit throws. The revised
plan extracts receipt-bearing move and commit functions shared by `cb rm` and
delete. Partial results distinguish a retained husk, a moved husk, and a pending
commit, so retry never depends on a card that has already moved.

The same synthesis found a narrower schedule race: the current manager removes
a schedule before its async delivery callback settles. A timer can therefore
cross that boundary just before deletion reservation, be dropped by the new
registry guard, and no longer be present for compensation. The revised plan
adds schedule-manager blocking plus an in-flight receipt/generation so detach
and restore cover that interval too.

## Checked claims that remained unchanged

- SDK `0.3.222` exports the quoted local `deleteSession()` contract, and
  callback-box configures no external `SessionStore`.
- `ChatSession.stop()` is fire-and-forget; awaited close/lock release is
  necessary.
- Live registry creation, raw send, persisted schedule fire/fallback, and the
  unconditional husk link are real resume paths.
- Boot reconciliation can recreate a husk from history + transcript.
- History and review lack removal functions and currently write non-atomically.
- The review pass really holds a cross-process lock for its full operation.
- Existing trash behavior correctly handles attachment scopes, collisions, and
  git trailers; its mechanism should be reused through the new receipt seam.

## Recommendation

Recommendation: seek boxholder approval on the revised plan before
implementation because strict UUID validation closes the irreversible
path-traversal blocker, while the remaining accepted findings now have explicit
lifecycle, compensation, and verification contracts.
