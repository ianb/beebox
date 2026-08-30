---
title: "Email Volume and Materialization"
status: superseded
workstream: unknown
issues: []
---
# Email Volume and Materialization

This proposal was not implemented as written. The boxholder's subsequent
design discussion replaced its callback-specific search/show/promote/demote
surface with [email tracking instead of mailbox mirroring](../plans/email-tracking.md):
card existence is the tracking registry, `bbx connector gmail track` is the one
materialization command, deletion untracks without touching Gmail, and broad
remote access uses a constrained `gws` passthrough.

This plan keeps bulk mail in Gmail and materializes only selected threads as box cards. It separates an immediate volume-safety track from the later API-access and promotion decision.

**Job stories:**

- When I connect a normal mailbox, I want the box to import nothing until I choose a routing rule, so inbox noise cannot dominate the box.
- When I need an old email, I want the agent to search and read it through Gmail, so history stays reachable without becoming files.
- When an email becomes part of durable work, I want to promote its thread into the box, so references, notes, drafts, and Git history have a stable local object.
- When a sync finds more selected mail than the box may absorb, I want a truthful visible remainder, so the limit never becomes silent truncation.

## Stated preferences this plan trades against

- **Filesystem is state.** `beebox/docs/connectors.md:8`: *"External service → Connector.sync() → Writes/reads card files → Git commit"*. Remote-only mail is reachable external state, not box state. Agent guidance must name this boundary.
- **Do not add features beyond the task.** Implement Gmail first. Record which semantics generalize, but do not build a generic remote-source framework until a second connector needs it.
- **Principle 1, types are structure.** Use discriminated config, cursor, queue, and notice types.
- **Principle 3, validate at boundaries.** Validate Gmail config, state, page tokens, and remote API responses once at their read boundaries.
- **Principle 4, resilient and never silent.** A cap, expired cursor, partial page, or unavailable remote search must produce an explicit result.
- **Principle 9, formal structure for essential complexity.** Persist pull policy and deferred work explicitly. Do not infer policy from the presence or absence of a state file.
- **Principle 10, testability is architectural.** Keep selection, limiting, cursor advancement, promotion, and demotion decisions pure. Inject the Gmail service for IO tests.
- **Principle 12, the maintainer is usually an agent.** Put the local-versus-remote search rule in the on-demand email skill and verify it with a knowledge audit.
- **Existing security boundary.** `beebox/src/schemas/email-message.tsx:59-61`: *"Each `email-message` card represents one received email. Metadata only — the actual body text lives in the card's attach scope as a `.txt` file"*. Remote reads and later storage compaction must keep untrusted bodies out of card bodies and frontmatter.

## What already exists

- At proposal time, the now-retired Gmail pull module baselined only the bare
  inbox default while treating explicit selector intent as its resource bound.
  The incident showed that intent was not a resource bound. The replacement
  lives in `beebox/src/connectors/gmail-rules.ts` and baselines every new
  rule without importing its backlog.
- Steady-state Gmail sync already used the History API, but its old pull helper
  could paginate and accumulate without a bound. The replacement
  `beebox/src/connectors/gmail-discovery.ts` persists a resumable bounded
  cursor rather than retaining that all-or-nothing shape.
- Gmail IDs are checked before body fetch. `beebox/src/connectors/gmail.ts:175-180`: *"Refs whose Gmail id is already seen are skipped without an API call"*. Reuse this dedup for a persisted deferred queue.
- Failed pulls already preserve the old checkpoint. `beebox/src/connectors/gmail.ts:349-352`: *"do NOT advance the history checkpoint: the failed window replays next sync"*. Preserve this behavior for failures. A successful capped sync is different: it must advance the checkpoint and persist the omitted IDs atomically.
- `SyncResult` has no non-error degradation field. `beebox/src/connectors/index.ts:36-44` contains only `success`, `created`, `updated`, `pushed`, `jobs`, and `error`. Add structured notices.
- Wakeup has a private result reporter. `beebox/src/cli/commands/wakeup-connectors.ts:93-95`: *"function reportSyncResult"*. Extract a shared reporter instead of claiming the current seam is reusable as-is.
- Finalize is documented as outbound-only, but it calls full connector sync. `beebox/src/cli/commands/finalize.ts:2-7`: *"Post-processing phase for outbound connectors"*; `:86`: *"const result = await connector.sync();"*. Gmail must expose a push-only finalization path so the per-sync pull cap is not multiplied by finalize invocations.
- Gmail config has an owner-only admin surface, but its update overwrites the file from only `query` and `labels`. `beebox/src/webapp/trpc/routers/admin.ts:189-198` constructs `next` and writes the whole file. Track 1 must replace this with one shared validated read-modify-write path that preserves GC and safety fields.
- The Gmail service is typed and injectable. `beebox/src/services/google-gmail.ts:41`: *"export interface GoogleGmailService"*. Add search/thread operations there and to its fake.
- The fake does not currently exercise API pagination. Its list implementations must gain `maxResults` and `pageToken` behavior before limiter tests can be meaningful.
- Local agent guidance overstates reach. `beebox/src/core/box/skills-content.ts:359`: *"If the user only wants to know about an email they received, that's `bbx search --kind email-message`"*. Replace this with an explicit local-first, remote-when-needed rule.
- Reply drafts require a materialized message card. `beebox/src/schemas/email-outbound.tsx:71-77`: *"`in-reply-to.ref:` — for replies, points at the source `email-message` card"* and the connector reads its message and thread IDs. The first promotion implementation must preserve this RFC822 Message-ID contract.
- The repository has a materialization precedent. `beebox/docs/plans/interface-as-cards.md:248-253`: *"Addressing is free and virtual; assertions require materialization."* Remote discovery is virtual; durable assertions materialize one local thread.

## Prior art (external)

- Google's Gmail synchronization guide says a full sync should retrieve only as many recent messages or threads as the application's purpose requires. It also says an expired `historyId` returns HTTP 404 and requires a full sync. This supports a purpose-bound bootstrap and an explicit fallback policy: <https://developers.google.com/workspace/gmail/api/guides/sync>.
- Gmail `users.messages.list` supports `maxResults`, pagination, an arbitrary Gmail query, and `resultSizeEstimate`. Message list entries contain only an ID and thread ID. This supports cheap discovery before body fetches. The plan does not use `resultSizeEstimate` as an exact count: <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list>.
- Google Calendar uses full sync plus incremental tokens, including token invalidation, and permits a time-bounded initial sync. This supports source-specific selection beside a cursor contract: <https://developers.google.com/workspace/calendar/api/guides/sync>.
- Google Drive exposes a change log and a non-expiring page token. This differs from Gmail's expiring history window, but it supports the same high-level distinction between remote discovery and local materialization: <https://developers.google.com/workspace/drive/api/guides/manage-changes>.
- No external source justifies one local pointer file for every remote item. Non-materialized mail remains fileless.

## Tracks / scope

### Track 1 — Independent Gmail volume limits

**What.** Bound automatic Gmail materialization by thread per pull invocation. Persist and display the exact number of candidate threads deferred.

**Why this needs to change.** A real box accumulated 68,869 email directories. The issue records that this dominates file count, Git history, scans, and agent-visible state (`issues/closed/bugs/2026-08-05-email-connector-needs-volume-limiters.md`). The bare inbox baseline is safe, but explicit selectors, large History windows, and expired-checkpoint fallbacks are not.

**Direction.** Add one validated config module shared by the connector and admin router:

```ts
type GmailPullPolicy =
  | { policyVersion: 1; mode: "paused" }
  | {
      policyVersion: 1;
      mode: "selected";
      selector: { kind: "inbox" } | { kind: "labels"; labels: string[] } | { kind: "query"; query: string };
      initialImport: { kind: "future-only" };
      maxThreadsPerSync: number;
    };
```

The safe default is `{ policyVersion: 1, mode: "paused" }`. The admin UI requires an explicit selector before inbound cards start. Selected mode defaults to `future-only` and 25 threads per pull. There is no automatic historical import. History is reached and promoted through Tracks 2 and 3.

Do not infer a policy from state-file presence. On rollout, a legacy config with a non-empty `query` or `labels` becomes selected and future-only. A missing or bare legacy config becomes paused, even on an existing box, and the admin UI says that inbound Gmail awaits confirmation. This favors a visible pause over an unprovable grandfathering guess.

Persist this transient pull state as one validated, locked unit:

```ts
interface GmailPullState {
  historyId?: string;
  deferred: Array<{ id: string; threadId: string }>;
  lastNotice?: ConnectorNotice;
}
```

Each successful pull does this in order:

1. List new History records from `historyId`, or perform the policy-governed full-list fallback.
2. Merge unseen refs into `deferred`, deduped by Gmail message ID.
3. Group the queue by thread ID. Materialize at most `maxThreadsPerSync` complete queue groups.
4. Save seen IDs after successful writes.
5. Atomically save the newest History checkpoint, remaining queue, and notice. A failure before step 5 retains the old checkpoint and replays safely.

Advancing the checkpoint prevents a capped window from growing until expiry. The queue, not a frozen cursor, carries omitted work. Every full-list path, including an expired checkpoint, reapplies `future-only`: it baselines current matches instead of turning them into a slow full-history import. Query mode also baselines on first use and after an unrecoverable checkpoint gap; later newly matching IDs join the queue.

The cap unit is a thread. A sync never deliberately splits one candidate batch's thread across the cap. Fix thread-card updates to merge existing participants, labels, and date range instead of recomputing them only from the current batch. A later message in an already materialized thread may then extend, but not erase, prior metadata.

The visible count is the exact number of distinct thread IDs left in `deferred` after the attempted batch. Call it “candidate threads deferred,” not “cards not written”: legacy RFC822 dedup and parse rejection can make those counts differ. Extend `SyncResult` with:

```ts
type ConnectorNotice =
  | { kind: "not-imported"; count: number; unit: "threads"; reason: "initial-history" }
  | { kind: "deferred"; count: number; unit: "threads"; reason: "per-sync-limit" };
```

Extract a shared connector-result reporter for wakeup and finalize. Store the last notice and timestamp in Gmail transient state, and display it in the admin Gmail section until a later pull records zero deferred threads. Add a Gmail push-only method and have `bbx finalize` use it; inbound pulls happen only through wakeup/manual sync.

This track does not change card schemas, thread layout, remote search, promotion, or demotion. It leaves API-versus-file storage open.

**Vocabulary lock-ins.** `paused`, `selected`, `future-only`, `candidate threads deferred`, and `not imported from initial history` are user-facing terms. Deferred means queued for a later pull. Not imported from initial history means automatic sync will not drain it later.

**First implementation chunk.** First make the Gmail fake paginate. Then write failing doctests for shared config validation, paused default, legacy selector migration, bare-config pause, future-only label/query baselines, expired-checkpoint re-baseline, 26 thread candidates with cap 25, atomic checkpoint-plus-queue advancement, queue replay, thread-metadata merging, and zero-remainder clearing. Implement the pure policy/queue decision core after the tests.

### Track 2 — Bounded remote mail reach

**What.** Let the agent search and inspect mail that has no local card.

**Why this needs to change.** Local `bbx search` cannot truthfully answer questions about remote-only history.

**Direction.** Add Gmail-specific commands backed by `GoogleGmailService`:

- `bbx email search --query <gmail-query> [--limit 20] [--page-token <token>] [--json]` returns bounded message metadata and snippets. The hard maximum is 100 results.
- `bbx email show --thread <thread-id> [--json]` returns one named thread's metadata and bodies. Every body is labeled untrusted remote content. Attachment metadata is returned; bytes are not.
- Every result includes `scope: "remote-gmail"`, `complete: boolean`, and a next-page token when incomplete. No matches, remote unavailable, and more matches are distinct states.
- Both commands enforce the per-box Gmail service toggle, reuse Google auth, and write no files.

Local `bbx search` stays filesystem-only. The email skill directs all-mail and history questions to remote search and requires the agent to name the searched scope before an absence claim.

**Vocabulary lock-ins.** “Local mail” is materialized box cards. “Remote mail” is Gmail API output with no card. Search scope is `local-box` or `remote-gmail`.

**First implementation chunk.** Add paginated search and one-thread retrieval to the typed Gmail service and fake. Add output-shaping doctests for bounds, scope, completeness, auth failure, not-found, and untrusted-body labels before registering CLI commands.

### Track 3 — Explicit promotion with simple demotion

**What.** Turn one remote Gmail thread into durable box state when work needs it. Avoid a new pointer-card subsystem.

**Why this needs to change.** Search output is ephemeral. Durable refs, notes, reply drafts, and Git history need a local object.

**Direction.** Add `bbx email promote --thread <thread-id>`. Promotion happens only when:

1. The boxholder asks to save, track, or work from the thread.
2. The agent needs a durable ref from another card.
3. The agent is drafting a reply.
4. An explicit routing rule selects the thread during automatic sync.

Do not add automatic importance classification. A non-materialized thread is nothing in the box: no pointer, no local-search entry.

The first version reuses the existing `email-thread` plus `email-message` card shape. Selection is the dominant volume fix; changing two directories per typical one-message thread to one directory is only a constant-factor improvement. Promotion fetches the complete named Gmail thread, retains both Gmail API IDs and RFC822 Message-ID headers internally, and writes through the existing thread writer. Reply drafts continue to resolve an `email-message` card and use its RFC822 Message-ID. Do not substitute a Gmail API message ID into `In-Reply-To`.

Add `bbx email demote <thread-card>`. It refuses if any inbound local ref, unsent draft, downloaded attachment, or non-reproducible local edit depends on the bundle. Otherwise it moves the card and attach scope to trash. A later remote search can promote the Gmail thread again. It does not create a pointer or rewrite refs.

Compact thread storage remains a follow-up decision after Track 1 is deployed and per-thread costs are measured. If pursued, it needs its own schema-and-migration plan and explicit authorization for any real-box migration.

**Vocabulary lock-ins.** `promote` creates existing-shape local thread cards. `demote` removes an unreferenced reproducible local copy. Neither command creates pointers.

**First implementation chunk.** Add complete-thread retrieval and a pure promotion/demotion eligibility decision. Write idempotency, RFC822 threading, stale ID, race, partial-write, and demotion-blocker doctests before CLI registration.

### Track 4 — Agent truthfulness and cross-connector applicability

**What.** Teach the agent the visibility boundary. Record applicability to other high-volume connectors without a generic runtime abstraction.

**Why this needs to change.** An agent that searches only files can falsely conclude that remote mail does not exist. Drive, Calendar, and chat history have the same high-level pressure.

**Direction.** Update the email skill and connector docs with three semantic operations: bounded remote discovery, explicit local materialization, and selected/materialized refresh. Keep all Gmail commands and types concrete. A future Drive, Calendar, or chat-log design may reuse these guarantees only when it has stable remote identity, bounded results, explicit scope, and visible incompleteness.

Do not introduce generic `discover`/`materialize` interfaces or user-facing connector vocabulary in this plan. Generality is a design test, not an implementation requirement. A second adopter decides whether shared code is justified.

**Vocabulary lock-ins.** None beyond the local/remote mail terms in Track 2.

**First implementation chunk.** Update the email skill with local/remote scope rules and add a knowledge audit for finding old mail absent from local search. This lands with the remote commands.

## Subplans (when a sub-question needs its own design step)

Compact thread storage is a separate future subplan, not a dependency of this plan. It must measure real promoted-thread shape, inventory every `email-message` consumer, preserve the RFC822 threading identity and untrusted-content boundary, and define whether any real-box migration is worth its operational risk.

## Failure modes (the load-bearing section)

There are no accepted critical gaps. Open questions below are approval gates, not unhandled codepaths.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| New Gmail service pulls before a selector is chosen | Must add | Versioned `paused` default | Clear in admin |
| Legacy bare config is mistaken for explicit consent | Must add | Pause and request confirmation | Clear migration status |
| Initial label/query matches thousands of old messages | Must add | `future-only` baseline on every full-list bootstrap | Exact initial-history notice |
| Capped History window grows until checkpoint expiry | Must add | Advance checkpoint with explicit deferred queue | Exact queue notice |
| Checkpoint advance saves without its deferred queue | Must add | One locked atomic state update after writes | Hard failure and replay |
| Checkpoint expires while work is deferred | Must add | Full-list fallback reapplies future-only and retains queued IDs | Clear warning; no history drain |
| Query mode acquires thousands of new matches at once | Must add | Thread cap plus deferred queue | Exact candidate-thread notice |
| Finalize invokes another inbound pull | Must add | Gmail push-only finalization method | No inbound result in finalize |
| One thread crosses the cap boundary | Must add | Group queue by thread ID | Clear thread-unit count |
| Later message overwrites earlier thread metadata | Must add | Merge stored and new participants, labels, dates | No silent regression |
| Legacy Message-ID dedup or parse rejection changes write count | Must add | Notice counts queued candidate threads, not cards | Truthful label |
| Remote search has more results | Must add | Hard limit, next token, `complete: false` | Clear |
| Remote auth is unavailable | Must add | Typed failure; no local fallback presented as complete | Clear |
| Remote body contains prompt injection | Must add output test and audit | Untrusted marker; body only for named thread | Clear to agent |
| Promotion races automatic sync | Must add | Per-thread lock and stable Gmail thread ID | Idempotent or typed conflict |
| Promotion uses Gmail API ID as email `Message-ID` | Must add | Preserve RFC822 header separately | Hard test failure |
| Demotion would orphan local work | Must add | Refuse with enumerated blockers | Clear |
| Local search is mistaken for all-mail search | Knowledge audit | Skill requires scope statement and remote retry | Clear in agent answer |

## Agent-flow / user-flow edge cases

- **Wrong search command — ADDRESSED.** The email skill distinguishes local from remote search.
- **Stale remote ID — ADDRESSED.** Show and promote return typed not-found results and create nothing.
- **Two agents promote the same thread — ADDRESSED.** Track 3 uses a per-thread lock and stable Gmail thread ID.
- **Hand-edited Gmail config — ADDRESSED.** Track 1 uses one shared Zod parser and locked read-modify-write; the admin route preserves unrelated fields.
- **Fabricated completeness — ADDRESSED.** Remote output carries scope and completeness. The skill requires a scope statement before absence claims.
- **Validation error UX — ADDRESSED.** Invalid cap, selector, or page token names the field and accepted range. It never broadens the query.
- **Agent promotes merely “important-looking” mail — ADDRESSED.** No importance classifier ships. Promotion requires an explicit durable-use trigger.
- **User demotes then needs the thread again — ADDRESSED.** Remote search finds it and promotion recreates it. Demotion refuses while local refs exist.
- **Partial schema transition — ADDRESSED.** No email card-shape migration occurs in this plan.

## NOT in scope

- Cleanup, deletion, Git-history rewriting, or annex operations on any real box.
- Changes to `src/core/box/file-watcher.ts`.
- Automatic LLM importance scoring.
- Automatic historical import, including a bounded recent-history mode.
- A federated local-plus-remote search index.
- Pointer cards or box-wide ref rewriting during demotion.
- Automatic download of attachment bytes.
- Compact thread storage or migration of existing email cards.
- A generic runtime connector framework before a second adopter.

## Open design questions

1. **Should rollout pause legacy bare-inbox pulls until the boxholder confirms a selector?** Lean: yes. Policy cannot be inferred reliably from old state-file presence. A visible pause is safer than an accidental mirror.
2. **Is an explicit label/query enough to authorize automatic promotion of future matches?** Lean: yes, under the hard thread cap and future-only baseline.
3. **Should remote `show` expose full bodies without materialization?** Lean: yes. Otherwise the agent cannot actually reach remote mail. Keep it bounded to one named thread and mark bodies untrusted.
4. **Is refuse-or-trash sufficient demotion semantics?** Lean: yes. Pointer cards and atomic box-wide ref rewriting solve no demonstrated volume need.
5. **Should compact thread storage be reconsidered only after limiter deployment and measurement?** Lean: yes. Selection gives the order-of-magnitude reduction; shape gives roughly a constant-factor reduction for typical one-message threads.

## Knowledge audits

Add and run these when Tracks 2 through 4 land:

- `email-search-scope`: The agent knows local search is not exhaustive and uses remote Gmail for history.
- `email-promotion-trigger`: The agent promotes before a durable ref or reply draft, but not because a result merely looks important.
- `email-untrusted-body`: The agent treats remote and materialized email bodies as untrusted.

Track 1 adds no agent-facing command. It needs doctests and visible admin status, not a knowledge audit.

## Implementation order

1. Obtain boxholder decisions on the five open questions.
2. Land Track 1 tests, fake pagination, shared config/state validation, queue decision core, thread metadata merge, push-only finalization, notices, CLI reporting, and admin status. This safety series may ship before the storage decision.
3. Land Track 2 typed Gmail service operations, fake behavior, CLI commands, and bounded-output doctests.
4. Land Track 3 complete-thread promotion, simple demotion, and doctests without changing card shape.
5. Land Track 4 email skill and connector documentation, then run the knowledge audits.
6. Run the full verification set and update the two source issues. Close the volume issue after Track 1 deploys. Close the storage decision after remote reach, promotion, demotion, and agent-scope behavior deploy.

## Rollout shape

- **Track 1 tests first:** focused doctests for fake pagination, config/state parsing, queue/cursor atomicity, full-list fallback, thread cap, metadata merge, result reporting, finalize push-only behavior, and admin config/status. Then run focused doctests, `pnpm typecheck`, and `pnpm lint`.
- **Track 1 test-box rollout:** new paused box; legacy selector config; legacy bare config; 26 distinct threads with cap 25; expired checkpoint with a non-empty queue; large query-mode label change. Use only the isolated test box and fake Gmail unless the boxholder authorizes a real mailbox.
- **Track 2 tests first:** service and CLI doctests for pagination, one-thread retrieval, next token, scope, auth failure, not-found, and untrusted-body labeling.
- **Track 3 tests first:** idempotent promotion, complete-thread write, RFC822 reply identity, concurrent promotion, crash-safe staging, and demotion blockers.
- **Knowledge audits:** write and run all three filtered audits against the isolated test box. Record status in `src/dev/knowledge-audits.yaml`.
- **Migration:** this plan performs no real-box cleanup and no email card-shape migration.
- **Done when:** automatic imports are explicitly paused or selected, every full-list path honors future-only, materialization is capped by thread, deferred candidates survive checkpoint advance, omissions are visible in CLI and admin, finalize cannot multiply inbound pulls, the agent can query remote Gmail with explicit scope, promotion creates only selected durable threads, demotion cannot orphan work, and all focused doctests, typecheck, lint, and knowledge audits pass.
