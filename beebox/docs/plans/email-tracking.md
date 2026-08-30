---
title: "Email tracking instead of mailbox mirroring"
status: partial
workstream: unknown
issues: []
---
# Email tracking instead of mailbox mirroring

This plan changes Gmail from a mailbox mirror into a remote source with an explicit tracked working set. Gmail remains the complete archive. An email thread enters Git only when a person, an agent, a procedure, or a bounded automatic rule chooses to track it.

An Opus cross-model review was run after the boxholder explicitly requested it. Its eight findings are addressed in the implementation: delta-only tracked refresh, legacy-state migration, resumable history bounds, safe Message-ID handling, delete-during-sync protection, connector serialization, shared procedure-trigger orchestration, and distinct baseline/overflow counts.

## Stated preferences this plan trades against

### Boxholder decisions from the design discussion (2026-08-05)

These statements are the authority for the plan's user-facing model. The technical tracks below implement them; they do not replace them with planner-invented terminology.

- On the default boundary: *"No automatic email showing up in git."*
- On deliberate labels: *"The way I'm using labels, I'm usually labeling things I know I want to send to the agent, so those things can be promoted directly. Though with that use I actually don't want all my email in the box at all."* In the settled vocabulary, those labeled threads can be **tracked** directly.
- On excess visibility: *"We need a way to know there's excess mail in gmail."*
- On private staging: *"I do think a file is very reasonable, and if we don't want it tracked in git that's reasonable, but creating that file and then waking an agent (if we want to do that) is reasonable."*
- On the lifecycle metaphor: *"'Promote' is what we're saying, it doesn't seem like the right metaphor for the agent. It's more like track-as-card. Or add-to-working-set. Or something... it should make sense to you, but should make sense from the agent perspective, not just from our design discussion here."*
- On the exact tracking transition: *"Tracking means create a card. Untracking is just deleting the card (which should not delete the email)."*
- On the tracking registry: *"I assume the connector will literally look for \*\*/\*.email-thread.card (or whatever the type is, I forget) and use that to do syncing."*
- On procedure orchestration: *"I believe procedures can wake agents, but also can embed other rules and scripts before waking the agent, so 'running a procedure' is probably more the style than 'waking an agent'."*
- On the safety limiter: *"The cap has to be for a certain time or something... over time any cap will be reached. So more like 25/week or something."*
- On broad Gmail access: *"I am inclined to make some of the other wrapper calls fairly lightweight and show the gws interface instead of trying to wrap every piece of it. Like bbx connector gmail gws [gws args]."*
- On the remaining state boundary: *"Tracking gmail and responding to things still needs state that gws itself doesn't have."*
- On the agreed summary: *"Regular sync and tracking"*, *"Triggers for procedures"*, *"The track command promotes emails into cards"*, *"Deleting the card simply untracks the email"*, and *"We mostly wrap gws for other query types."* Here, *promotes* describes the transition informally; the agent-facing verb remains **track**.

- **Job story — intentional handoff:** When I label a Gmail thread for my assistant, I want the thread to become a card and stay synchronized, so the assistant can work with it as durable box state.
- **Job story — broad access without mirroring:** When I need information from other mail, I want the agent to search and read Gmail on demand, so the box does not contain my entire mailbox.
- **Job story — safe automation:** When I configure a query or procedure for incoming mail, I want a bad match rule to stop at a visible limit, so one mistake cannot flood the repository.
- **Job story — simple lifecycle:** When an email thread is no longer part of the box's work, I want deleting or trashing its card to stop synchronization without deleting the Gmail thread.
- Engineering principle 1, **Types are structure**: Gmail rule actions and subprocess results must use discriminated, validated shapes.
- Engineering principle 3, **Validate at boundaries**: validate `gmail.json`, Gmail responses, `gws` JSON, card frontmatter, and procedure-trigger data at their boundaries.
- Engineering principle 4, **Resilient and never silent**: excess mail, exhausted budgets, expired Gmail cursors, corrupt private state, and rejected `gws` commands must be visible.
- Engineering principle 8, **One way to do each thing**: the card set is the single tracking registry; connector-private ledgers must not independently claim that a deleted card is still tracked.
- Engineering principle 10, **Testability is architectural**: keep automatic synchronization behind the existing typed Gmail service and fake. Keep subprocess execution behind an injected adapter.
- Engineering principle 12, **The maintainer is usually an agent**: teach the agent that local email cards are a tracked subset and that Gmail search uses the connector's `gws` surface.
- `beebox/CLAUDE.md` says, *"the filesystem is state, Git is history, the `bbx` CLI is the universal interface."* Tracking therefore uses cards and `bbx`, while remote discovery stays outside Git.
- `beebox/code-style.md` requires validated boundary data, explicit errors, typed results where callers branch, and no silent fallback from corrupt state.

## Pre-implementation snapshot

The original planning pass found mailbox-mirroring behavior in the old Gmail
connector. That code has now been replaced. The durable implementation points
are `src/connectors/gmail-tracking.ts` for the live-card registry,
`src/connectors/gmail-discovery.ts` for bounded history traversal,
`src/connectors/gmail-state.ts` for validated machine-local state,
`src/connectors/gmail-threads.ts` for the existing card representation, and
`src/connectors/gmail.ts` for tracked-only synchronization.

- `src/schemas/email-thread.tsx` remains the card identity boundary and requires
  the Gmail `thread-id` field. No pointer-card type was added.
- `src/connectors/transient-state.ts` remains the atomic, gitignored state
  mechanism; Gmail extends it rather than introducing another store.
- `src/services/google-gmail.ts` remains the typed automatic-sync boundary and
  now includes thread retrieval and bounded thread listing.
- `src/core/commands/connector-procedure-triggers.ts` runs typed procedure
  requests only after connector writes complete.
- `docs/procedure-implementation.md` remains the reference for shell prechecks,
  agent steps, and fully skipped procedures.
- `docs/plans/cli-restructure.md` already proposes a `bbx connector` command group. The Gmail commands in this plan use that namespace but do not require the rest of the CLI restructure to ship.

## Prior art (external)

- [Google Workspace CLI](https://github.com/googleworkspace/cli) provides Discovery-generated Workspace commands, structured JSON, pagination, agent skills, and the `GOOGLE_WORKSPACE_CLI_TOKEN` environment variable. The reviewed release was `0.22.5` at commit `a3768d0e82ad83cca2da97724e46bea4ff0e6dbd` on 2026-03-31.
- The same repository states that `gws` is not officially supported and may make breaking changes before 1.0. Pin the installed version and validate every JSON result that beebox consumes.
- The released Gmail `+read` helper decodes MIME and sanitizes terminal control characters. The released `+triage` helper is message-oriented, does not expose a complete thread-oriented working-set contract, and does not replace beebox state.
- [Google Workspace CLI issue 717](https://github.com/googleworkspace/cli/issues/717) reports diagnostic output contaminating an ostensibly JSON command. Treat stdout as an untrusted subprocess boundary and test the exact commands beebox exposes.
- [Google Workspace CLI issue 558](https://github.com/googleworkspace/cli/issues/558) proposes middleware for read-only and other agent-safety policies. The current CLI does not provide the safety boundary beebox needs by itself.
- [Google Workspace CLI pull request 676](https://github.com/googleworkspace/cli/pull/676) proposed a better Gmail search helper with thread IDs, snippets, validation, and pagination, but it closed without merging. Do not design against that proposed output.
- No external tool was found that combines Gmail access with beebox's required state: tracked-card identity, Git commits, Gmail history cursors, automatic-tracking budgets, and procedure triggers. beebox must own that control plane.

## Tracks / scope

### Track 1 — Make card existence the tracking registry

**What**

Define a Gmail thread as tracked when one live `*.email-thread.card` with its full Gmail `thread-id` exists in the box. The connector finds these cards on every sync. The connector updates only these threads unless a track command or an automatic rule creates a new card.

**Why this needs to change**

The current connector treats an unbounded committed `seenGmailIds` list as its durable ledger and only looks for existing cards in `box/inbox/email/`. A card moved into another working location can stop receiving updates. A deleted card does not cleanly express “stop tracking.” This conflicts with the filesystem-is-state model.

**Direction**

- Build a live-card index from `**/*.email-thread.card` under box content and durable archive content.
- Exclude `store/trash/**`, `.beebox/**`, `procedure/runs/**`, dependencies, and other non-live caches.
- Parse and validate every matched card. Key the index by its full `thread-id`.
- Fail clearly when two live cards claim the same Gmail thread. Do not choose one silently.
- A card that remains anywhere in a live content location remains tracked.
- A missing or trashed card is untracked. No Gmail mutation occurs.
- Do not retain a separate “tracked thread IDs” ledger. The state file may cache an index for efficiency, but the next scan must reconcile it against cards.
- A later Gmail message in a previously deleted thread may match an automatic rule again. The first implementation does not create permanent ignore tombstones. A permanent-ignore feature is deferred.

**Vocabulary lock-ins**

- **Track:** create an `email-thread` card and begin ongoing synchronization.
- **Tracked:** a live `email-thread` card exists.
- **Untracked:** no live `email-thread` card exists. The Gmail thread still exists remotely.
- Do not use **promote**, **demote**, or **pointer card** in the agent-facing interface.

**First implementation chunk**

Write a doctest for live-card discovery before changing Gmail sync. Cover a card in the inbox, a moved card in durable archive content, a trashed card, a malformed card, and duplicate `thread-id` values. Then add the live-card index and use it for existing-card lookup.

### Track 2 — Add explicit thread tracking

**What**

Add `bbx connector gmail track <thread-id>`. The command fetches the complete Gmail thread, creates one `email-thread` card with the current message/attachment representation, commits it, and returns the card path.

**Why this needs to change**

An agent can currently cause a card to exist only by broadening connector configuration and running a sync. That conflates discovery with materialization and makes a one-thread decision unsafe.

**Direction**

- Treat the argument as a Gmail API thread ID, not a Gmail web URL fragment.
- Make the command idempotent. If a live card already has the thread ID, refresh it and return its path.
- Fetch the full thread. Add `getThread` to the typed Gmail service if that is the cleanest boundary.
- Validate the remote response before writing files.
- Use the existing thread-card writer after adapting it to accept a complete remote thread.
- Commit the created or refreshed card and attach scope with a `Tracked-By` trailer that distinguishes an explicit command from an automatic rule.
- Do not call Gmail delete, modify labels, archive, or mark-read operations.
- Keep the existing Gmail draft-card workflow separate.

**Vocabulary lock-ins**

- CLI: `bbx connector gmail track <thread-id>`.
- There is no `untrack` command. `bbx rm <card>` or deleting the card expresses untracking.

**First implementation chunk**

Add a failing filesystem doctest that tracks one fake Gmail thread twice and proves that only one thread card exists, the second call refreshes it, and no remote Gmail mutation occurs. Then implement the command using the fake service.

### Track 3 — Synchronize only tracked threads

**What**

Change regular Gmail sync into two independent activities: detect remote changes for rules and procedures, and refresh changed threads that are already tracked.

**Why this needs to change**

Today every eligible candidate becomes a card. That is the mailbox-mirroring behavior this plan removes.

**Direction**

- Continue to use the Gmail History API for efficient change detection.
- Group history changes by `threadId` before fetching full content.
- If a changed thread ID is tracked, fetch and merge its new messages automatically.
- If a changed thread ID is untracked, do not write a card. Evaluate it only against configured rules.
- If the history cursor expires, obtain a new checkpoint and reconcile tracked threads without listing or materializing the whole mailbox.
- Preserve connector-owned fields and the current supported agent-owned fields when refreshing a card. Do not broaden this plan into a general connector-card ownership redesign.
- Retire `config/connectors/gmail-state.json` as a growing committed list of every message the mailbox has exposed. Provide a migration that reads the old file once, preserves any data still required to avoid replay, and then removes or bounds it.
- Keep history cursor, pending summaries, rule watermarks, and rolling-budget timestamps in validated, atomic, gitignored transient state.

**First implementation chunk**

Add a doctest with one tracked and one untracked thread receiving new messages. The sync must update only the tracked card, write no card for the untracked thread, and advance the history checkpoint.

### Track 4 — Add bounded Gmail rules and pending summaries

**What**

Let `config/connectors/gmail.json` declare named Gmail queries with one typed action: automatically track matching new threads, or run a procedure for matching new threads. Record a bounded summary of untracked matches in gitignored state.

**Why this needs to change**

Labels are often deliberate instructions to the agent, but even a trusted label can accidentally match a large backlog. Other mail should be available for procedural triage without entering Git.

**Direction**

Use a validated shape equivalent to:

```json
{
  "rules": [
    {
      "name": "send-to-agent",
      "query": "label:beebox",
      "action": {
        "type": "track",
        "budget": { "threads": 25, "window": "7d" }
      }
    },
    {
      "name": "review-inbox",
      "query": "label:inbox is:unread",
      "action": {
        "type": "procedure",
        "ref": "config/procedures/review-new-email.procedure.card"
      }
    }
  ]
}
```

- Use a discriminated union for `action`. Reject unknown action types and invalid refs.
- A `track` action always has a rolling automatic-tracking budget. Default to 25 threads in any rolling seven-day window. Allow both values to be changed.
- Count threads, not messages and not sync invocations.
- Do not use a calendar-week reset. Store automatic tracking timestamps and calculate a rolling window.
- When the budget is exhausted, leave the threads in Gmail. Do not queue them for automatic tracking after the window clears.
- Record a bounded, newest-first list of untracked thread summaries per rule. Include thread ID, sender, subject, date, snippet, labels, discovery time, and disposition where known.
- Record `baselineMatches` for the pre-activation backlog and `additionalMatches` only when the bounded pending list omits matches. Keep malformed or missing RFC Message-IDs in a separate bounded `unevaluated` list. All three conditions must remain visible through CLI status and procedure input.
- The state file is not a mailbox cache or an offline search index. `gws` remains the way to search omitted or older mail.
- On the first activation of a rule, establish a baseline without tracking the existing backlog or running its procedure for every old match. Report the existing match count. The user can inspect and explicitly track selected existing threads.
- Legacy top-level `query` and `labels` configuration must not retain unbounded import behavior. Migrate or interpret them as an automatic tracking rule with the default rolling budget, and emit a clear migration message.
- With no rules, Gmail sync writes no new email cards. It refreshes tracked cards whose threads appear in the bounded Gmail History delta and advances its change cursor.
- Consume at most 500 unique history references from one 100-record Gmail page per sync. Persist the page token and within-page offset so later syncs resume without dropping excess history.

**Vocabulary lock-ins**

- **Rule:** a named Gmail query plus one action.
- **Automatic tracking budget:** a rolling limit on thread cards created without a direct, interactive track request.
- **Pending summary:** private metadata about untracked remote threads. It is not a card and is not Git history.

**First implementation chunk**

Write pure doctests for config parsing and the rolling thread budget. Include invalid configuration, 25 events inside seven days, an expired event leaving the window, a changed limit, and overflow that remains untracked rather than becoming a deferred queue.

### Track 5 — Trigger procedures after Gmail sync

**What**

Allow a Gmail rule to request a procedure run after connector synchronization completes. The procedure can use shell prechecks, scripts, and agents to inspect mail and decide whether to track threads.

**Why this needs to change**

“Wake an agent” is too narrow. Procedures are the existing orchestration abstraction and can finish without invoking an agent when deterministic checks find nothing interesting.

**Direction**

- The Gmail connector returns typed procedure-trigger requests as part of its sync result. It does not run a procedure while Gmail files or state are being written.
- The wakeup/connector orchestration layer runs requested procedures after all connector writes and commits for that sync are complete.
- Each request identifies the procedure by a validated card ref and includes a short directive with the Gmail rule name and pending-summary selector.
- Do not put the complete email body or an unbounded list of candidates in the directive.
- The procedure reads bounded candidate data through a callback CLI operation or the validated transient-state adapter. It can use the `gws` passthrough for more context.
- A shell precheck can return `$CHECK_SKIP`. A fully skipped procedure leaves no persistent run, following existing procedure behavior.
- A procedure may call the explicit track command for chosen threads.
- Direct automatic tracking rules and procedure-trigger rules are separate action variants. A procedure that tracks many threads still passes through the same tracking service. The implementation must carry automatic versus interactive provenance so automatic callers cannot evade the rolling safety budget accidentally.
- Coalesce repeated triggers for the same rule during one sync into one procedure request.

**First implementation chunk**

Add a doctest where a connector returns one procedure request with bounded candidate metadata. Prove that orchestration runs it after sync, passes the directive, and records no run when the procedure precheck skips.

### Track 6 — Expose a thin, constrained `gws` passthrough

**What**

Add `bbx connector gmail gws -- <gws-args>`. Preserve the upstream command vocabulary and JSON output instead of recreating every Gmail query operation as callback-specific commands.

**Why this needs to change**

The agent needs broad reach into untracked Gmail. beebox should provide authentication and safety without maintaining a parallel wrapper for every Gmail API resource.

**Direction**

- Pin an exact `gws` release. Verify the downloaded binary through the package's published integrity mechanism.
- Mint an access token through the existing Google auth service and provide it only to the child process as `GOOGLE_WORKSPACE_CLI_TOKEN`.
- Pass arguments after `--` without renaming or reshaping them.
- Start with a read-only allowlist of Gmail list/get/search/read/schema/help operations. Reject send, reply, forward, draft creation, delete, modify, trash, and unknown operations before spawning the process.
- Preserve `gws` stdout, stderr, and exit status for interactive use.
- When beebox consumes JSON internally, require `--format json` or the raw API equivalent and validate the result into callback-owned types.
- Do not install or expose the complete upstream Gmail agent skill because it advertises mutating operations.
- Keep automatic synchronization on the typed `GoogleGmailService` boundary. The passthrough is primarily an agent/query surface, not a replacement for tested connector state management.
- Document that untracked mail is absent from box search. The agent must use this command when a question requires Gmail beyond tracked cards.

**First implementation chunk**

Add subprocess-adapter doctests for argument forwarding, token injection without token output, read-only acceptance, mutation rejection, non-zero exit propagation, malformed JSON, and stdout containing unexpected diagnostics.

### Track 7 — Update agent knowledge and reference documentation

**What**

Teach agents and users the tracked-working-set model, the `track` command, rule configuration, procedure triggers, and the `gws` boundary.

**Why this needs to change**

An agent that assumes local card search covers all Gmail will answer incorrectly. An agent that uses “promote” or invents an `untrack` command will act against the chosen vocabulary.

**Direction**

- Update `docs/connectors.md` and `docs/gmail-setup.md` to describe current code after implementation.
- Update the generated agent command guide and Gmail schema instructions.
- State plainly: tracked cards are a selected subset; Gmail is authoritative for untracked mail; deleting a card never deletes remote mail.
- Show label-based automatic tracking as one rule example, not the definition of Gmail ingestion.
- Show a procedure rule with a shell precheck before an agent step.
- Show the exact `gws` passthrough syntax and its read-only policy.
- Remove stale documentation that says each Gmail match is automatically imported or that the connector mirrors the configured query.

**First implementation chunk**

Write the agent-facing wording and knowledge-audit expectations before implementing the commands. This locks the vocabulary that tests and CLI help must use.

## Subplans (when a sub-question needs its own design step)

No subplan is required for the agreed first implementation.

The following would require separate plans if resumed later:

- Replacing per-message cards and attach directories with inline thread content.
- Extending the tracking abstraction into a generic framework for Drive, Calendar, and chat logs.
- Allowing mutating `gws` operations, including sending or changing Gmail labels.

These questions do not block the Gmail tracked-working-set design.

## Failure modes (the load-bearing section)

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two live cards carry the same Gmail `thread-id` | Planned live-card doctest | Refuse synchronization for that thread and report both paths | Clear |
| A tracked card has malformed frontmatter or no `thread-id` | Planned live-card doctest | Fail the card scan with its path; do not silently untrack it | Clear |
| A card is deleted while sync is fetching its thread | Planned filesystem race doctest | Recheck card existence before writing; do not recreate it from the refresh path | Clear |
| A rule matches tens of thousands of threads | Budget, resumable-history, and connector doctests | Consume bounded history batches; track only remaining rolling capacity; write bounded summaries plus `additionalMatches` | Clear |
| A budget fills partway through a multi-thread sync | Planned budget doctest | Commit the allowed subset and record all omitted counts without a deferred drain queue | Clear |
| A new rule sees a large historical match set | Planned baseline doctest | Establish baseline, report count, and track none automatically | Clear |
| Gmail History checkpoint expires | Tracked-only regression | Obtain a fresh checkpoint and re-baseline rules without importing or refetching mail | Clear |
| Gmail transient state is corrupt or from the legacy GC shape | Existing transient-state tests plus Gmail legacy-shape regression | Corrupt owned values fail closed; obsolete top-level keys are stripped on the next write | Clear |
| `gws` is missing or wrong version | Planned adapter doctest | Return an actionable setup/version error | Clear |
| `gws` emits diagnostics mixed with JSON | Planned adapter doctest | Reject internal JSON consumption; preserve raw output for interactive use | Clear |
| A procedure ref does not resolve | Planned config doctest | Reject config before executing connector actions | Clear |
| A procedure precheck finds no interesting mail | Existing procedure behavior; add trigger integration test | Skip without invoking an agent or leaving a persistent run | Clear |
| A procedure fails after connector sync succeeded | Planned orchestration doctest | Preserve synced state, report procedure failure separately, retry according to procedure policy | Clear |
| An automatic procedure attempts to exceed the tracking budget | Planned provenance/budget doctest | Route all automatic tracking through the same enforced budget | Clear |
| The user deletes a tracked card | Planned sync doctest | Stop synchronization; leave Gmail unchanged | Clear |
| Gmail contains a later reply to a previously deleted thread | Planned lifecycle doctest | Treat it as a new rule event; it remains untracked unless explicitly or automatically selected again | Clear |
| Existing local agent fields are overwritten on refresh | Existing `preserve-agent-fields` behavior; add tracked refresh regression | Preserve only the documented agent-owned fields; document the ownership boundary | Clear |

There is no unresolved critical gap in the planned paths. The highest-risk path is automatic provenance through a procedure. Implementation must not ship until its budget-enforcement doctest passes.

## Agent-flow / user-flow edge cases

- **Wrong command vocabulary — ADDRESSED.** Agent docs and audits use `track`, `tracked`, and `untracked`. There is no `promote` or `untrack` command.
- **Stale thread ID — ADDRESSED.** `track` reports Gmail not-found and writes nothing.
- **Gmail web ID versus API ID — ADDRESSED.** CLI help says the argument is an API thread ID. The `gws` search output used by the agent must expose that ID.
- **Two agents tracking the same thread — ADDRESSED.** The track operation uses the card lock and full-thread identity, then returns the same card path idempotently.
- **Agent moves a tracked card — ADDRESSED.** Box-wide live-card discovery keeps it tracked.
- **Agent trashes or deletes a tracked card — ADDRESSED.** Absence from the live-card index stops updates and never calls Gmail delete.
- **Agent assumes local search covers Gmail — ADDRESSED.** Agent guidance and a knowledge audit require using `gws` for untracked mail.
- **Hand-edited invalid Gmail rule — ADDRESSED.** Validate config and fail closed before updating cursors or tracking cards.
- **Agent tries a mutating `gws` command — ADDRESSED.** The initial passthrough rejects it before spawning `gws`.
- **Partial migration from `query`/`labels` to `rules` — ADDRESSED.** The migration path applies the default budget and removes the unbounded behavior before old configuration is retired.
- **User wants a thread to remain permanently ignored — DEFERRED.** Deleting the card untracks it, but a future matching event can select it again. Permanent ignore needs a separate disposition design.
- **Tracked card storage still has many message attach directories — DEFERRED.** The tracked set bounds growth. A storage-shape migration is separate and must account for existing cards.

## NOT in scope

- **Cleanup of any real box or Git history.** Existing backlog removal can involve annex data, history rewriting, and a live server. It requires separate human authorization.
- **Changes to `src/core/box/file-watcher.ts`.** The watcher scale fix is active in another worktree.
- **A pointer card for every remote email.** Non-materialized mail has no card. It appears only in bounded gitignored summaries and live Gmail queries.
- **A complete offline Gmail index.** Gmail and `gws` remain the search source for untracked mail.
- **A new database.** The first implementation extends the existing atomic gitignored JSON state. Move to SQLite only if measured state size or contention requires it.
- **Permanent ignore/tombstone semantics.** Deleting a card stops current tracking. A later new-message event can make the thread eligible again.
- **Remote deletion when a card is deleted.** No local lifecycle action deletes Gmail content.
- **Sending email through `gws`.** Existing `email-outbound` cards continue to create Gmail drafts. The new passthrough is read-only.
- **Changing Gmail labels, read status, archive status, or trash through `gws`.** These are mutations and need a separate authorization design.
- **Changing the `email-thread` storage shape.** Keep current thread card, message cards, bodies, and attachment scopes for the limited tracked set.
- **Building a generic high-volume connector framework now.** Use generic vocabulary and typed trigger results, but implement Gmail only. Generalize after a second connector proves the shared shape.
- **Automatically invoking a model for every new message.** Procedures can precheck and skip. No default procedure scans the whole inbox.
- **Automatic cross-model review.** It was initially skipped to conserve quota;
  the boxholder later explicitly requested an Opus review, and its eight findings
  were fixed before finish.

## Resolved implementation choices

- Bounded pending summaries live in validated `config/connectors/gmail.state.json`
  and are exposed through `bbx connector gmail pending`.
- The live-card registry scans `**/*.email-thread.card` and excludes trash,
  procedure runs, caches, dependencies, and connector-private state.
- beebox pins `@googleworkspace/cli`; it does not download a floating
  release at runtime.
- Connector sync results carry generic typed procedure requests. Gmail-specific
  details stay in the bounded pending adapter and directive.
- Automatic `track` rules consume the rolling budget. A procedure rule does not
  create cards; an agent that deliberately runs the explicit track command is
  making an interactive working-set decision.

## Knowledge audits

Definitions for these audits were added with the implementation:

- **gmail-tracked-subset:** Ask whether Gmail cards represent all mail. Pass only if the agent says they are a tracked subset and names the `gws` surface for other mail.
- **gmail-track-thread:** Ask how to bring one Gmail thread into box work. Pass only if the agent uses `bbx connector gmail track <thread-id>` and explains ongoing sync.
- **gmail-delete-card:** Ask what deleting an email-thread card does. Pass only if the agent says it stops tracking and does not delete Gmail mail.
- **gmail-rule-procedure:** Ask where new-mail procedure routing is configured. Pass only if the agent names Gmail connector rules and distinguishes shell prechecks from agent steps.
- **gmail-gws-safety:** Ask whether the agent can send or delete mail through the passthrough. Pass only if it says the initial `gws` surface is read-only.

Their live agent run against the isolated test box remains outstanding because
the boxholder asked to conserve model quota. Results belong in
`src/dev/knowledge-audits.yaml`; until then this plan remains partially
implemented rather than being archived as a fully implemented plan.

## Implementation order

Implementation completed the tracks below with these deliberate boundaries:

- Automatic `track` rules enforce the rolling budget. A procedure action does
  not track anything by itself; an agent choosing to run the explicit track
  command is an intentional working-set decision, matching the boxholder's
  requirement that the agent must do something to add the thread.
- Existing committed `gmail-state.json` data is no longer read or written, but
  is not deleted automatically. Removing real-box backlog or rewriting history
  remains a separately authorized operation.
- The message-card and attach-scope representation remains unchanged. Bounding
  the tracked set addresses growth without foreclosing a later storage-shape
  migration.
- Five knowledge-audit definitions were added, but their live agent run was
  deferred to conserve the boxholder's remaining model quota. Unit/doctest,
  lint, type, and documentation verification do not consume that quota.

1. **Tests and vocabulary.** Add the agent-facing wording, live-card discovery doctest, config/budget pure doctests, and knowledge-audit entries. Commit the design boundary before connector mutation.
2. **Live-card index.** Implement validated, duplicate-detecting discovery. Adapt current writer lookup to use full thread IDs across live locations.
3. **Explicit track command.** Add thread retrieval to the service/fake, implement idempotent tracking, and commit tracked cards.
4. **Tracked-only sync.** Separate discovery from materialization, update only tracked changed threads, and migrate the unbounded seen-ID state.
5. **Rules and private summaries.** Validate the new config union, implement rolling budgets and baseline behavior, and expose pending/status output.
6. **Procedure triggers.** Add typed post-sync requests and run them from connector orchestration after sync completes.
7. **Thin `gws` passthrough.** Pin the dependency, add auth injection and the read-only gate, and test subprocess behavior.
8. **Docs and audits.** Update reference docs and generated agent guidance. Run the Gmail knowledge audits.
9. **Full verification.** Run focused doctests, the complete doctest suite, typecheck, lint, and doc checks. Commit the completed plan implementation on the worktree branch. Do not merge or deploy without a separate request.

## Rollout shape

- **Test posture:** tests come first for each substantial boundary.
  - `test/connectors/gmail-tracking.doctest.md` covers live-card discovery,
    explicit and concurrent tracking, deletion, tracked-only refresh, history
    expiry, resumable bounds, config validation, rolling budgets, pending
    summaries, and the read-only `gws` gate.
  - `test/core/commands/connector-sync.doctest.md` covers post-sync procedure
    execution and failure reporting.
  - `test/services/service-google-gmail.doctest.md` covers full-thread retrieval
    and bounded thread/history list behavior.
- **Done-when assertions:**
  - A new Gmail message with no matching rule creates no Git changes.
  - A matching procedure rule may complete without an agent and without a persistent procedure run.
  - A matching automatic-track rule creates no more than its remaining rolling thread budget.
  - Overflow is reported and remains remote.
  - Explicitly tracking one thread creates exactly one card and begins ongoing refresh.
  - Moving the card keeps it tracked. Deleting or trashing it stops refresh. Gmail remains unchanged.
  - The agent can search/read untracked Gmail through the constrained `gws` surface.
- **Migration:** support existing `query`/`labels` configuration during a bounded transition. Apply the default automatic tracking budget immediately. Migrate state away from the unbounded committed seen-ID list without replaying historical mail.
- **Knowledge:** run all five Gmail audits listed above. Treat a failure as an incomplete agent-facing feature, not a documentation follow-up.
- **Operational rollout:** first exercise with the fake Gmail service and the isolated test box. A real mailbox test requires explicit authorization and must use a deliberately narrow test label. Do not clean up or rewrite any existing real box as part of rollout.
- **Shipping:** the boxholder subsequently invoked the finish flow, authorizing
  merge to `main`. Deployment and real-mailbox validation remain separate facts
  in the finish report.
