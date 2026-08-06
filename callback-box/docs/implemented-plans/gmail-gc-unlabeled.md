# Plan: Garbage-collect unlabeled Gmail messages

> Superseded 2026-08-05 by [email tracking instead of mailbox mirroring](../plans/email-tracking.md).
> A live email-thread card is now the tracking registry; labels select bounded
> new tracking, and removing a label does not delete or trash an existing card.
> The former `gmail-gc.ts` implementation was removed with that change.

Status: **implemented** (2026-06-27). Decisions: trash to `store/trash/`;
`gc` defaults on for all modes; keep seen ids (no auto-reimport on relabel).
Lives in `src/connectors/gmail-gc.ts`; reference docs in `docs/connectors.md`.

## Problem

The Gmail loop is one-way. When a message that produced a box card loses its
triggering label in Gmail (the user archives it, removes the label, etc.),
nothing flows back: the box keeps the inbox thread card AND the seen id,
forever. We want a reconciliation pass that closes the loop without ever
removing a card the user (or an agent) has already acted on.

## What I verified first (anchors)

- **Connector**: `src/connectors/gmail.ts` (`sync()`), `gmail-pull.ts`
  (`listCandidates` — history-incremental with full-list fallback),
  `gmail-threads.ts` (`writeThreadCards` — writes thread dirs under
  `box/inbox/email/`).
- **State**: `config/connectors/gmail-state.json` → `seenGmailIds` (committed,
  Gmail **message** ids, checked before fetch); `gmail.state.json` → `historyId`
  (gitignored checkpoint).
- **The only stable card↔Gmail join is the thread id.** The thread card stores
  `thread-id` (`src/schemas/email-thread.tsx:37`). `seenGmailIds` is keyed by
  Gmail *message* id, and **nothing on disk links a card back to its Gmail
  message id** — message cards store the RFC822 `Message-ID`, not the Gmail API
  id. So reconciliation matches at **thread granularity** via `thread-id`.
- **Location IS state** (`email-thread.tsx:50`). A still-pending thread lives in
  `box/inbox/email/`. When an agent acts on it during intake-job processing it
  is moved out — to `store/archive/email/`, elsewhere in `store/`, or
  `store/trash/` via `cb mv` / `cb rm`. Status field is descriptive, not
  load-bearing; the path is the truth.
- **Intake jobs are NOT a signal of user action.** Every wakeup,
  `createIntakeJobsForUnjobbed` (`wakeup-steps.ts:179`) auto-creates an intake
  job referencing every unjobbed inbox card. So nearly every pending email card
  has a pending job almost immediately — "has a job" means nothing about whether
  the human engaged.
- **The reactor tolerates a missing referenced item**: `batch-jobs.ts:78-89`
  catches `ENOENT` when inlining a job's refs and silently omits it. So removing
  an orphan out from under a pending job does **not** crash anything.
- **Testability seam**: `createFakeGoogleGmail` exists, but its
  `listMessages(_opts)` (`google-gmail.ts:334`) **ignores the query** and
  returns every fake message. Reconciliation diffs against a query result, so
  the fake must be taught to honor `q` / label filtering before this is
  testable. (Tracked as a build task below.)

## The four design decisions

### 1. Signal — full reconciliation, NOT incremental `labelsRemoved`

**Recommendation: a full-list reconciliation pass; ignore `labelsRemoved`.**

- `labelsRemoved` is *message*-granular and lossy across history gaps. A thread
  is in the box because ≥1 message matched; deciding the thread no longer
  matches still requires authoritative thread-level state — so you end up
  needing a full view anyway. Net: the incremental signal doesn't actually let
  us skip the authoritative check, it just adds a second, weaker code path.
- A full list of currently-matching message refs (`listAllMatching(query)`,
  already implemented in `gmail-pull.ts`) → derive the set of matching
  **thread ids** → diff against the thread dirs in `box/inbox/email/`. The
  predicate "this thread no longer matches the connector's criteria" is then
  trivially correct, and it works in **all** config modes (bare inbox, labels,
  and arbitrary `query` — full-list always evaluates a query, the history caveat
  doesn't apply).
- Reconciliation runs **independently of the incremental import** — it does its
  own `listAllMatching`, so steady-state history syncs are unaffected.

**Cost / cadence.** For label/`query` modes the matched set is small and the
list is cheap. For the bare `label:inbox` default it lists the whole inbox —
the same cost the old full-list sync paid. To keep wakeups cheap I'll **gate
reconciliation behind a cadence** (default: at most once per `gcIntervalHours`,
default 24h) tracked in the gitignored transient state
(`gmail.state.json` → `lastReconcileAt`). Config can disable it
(`"gc": false`) or tune the interval.

### 2. "Acted-on" predicate — thread dir still physically in `box/inbox/email/`

**Recommendation, and this is the load-bearing safety property:** a thread is a
GC candidate **iff** its `*.email-thread.card` still lives directly under
`box/inbox/email/` AND its `thread-id` is absent from the current match set.

The moment an agent moves a thread out of `box/inbox/email/` (to
`store/archive/`, `store/`, or trash), it becomes invisible to GC — exactly
because location is state. Replies/jobs/downstream cards an agent spawned live
elsewhere and are never touched. Pending auto-created intake jobs do **not**
protect or condemn a card; only its own location matters. Conservative by
construction: better to leave an orphan than to reach outside `inbox/email/`.

### 3. Remove vs archive vs mark — move to trash, never hard-delete

**Recommendation: relocate the orphan to `store/trash/` via the existing trash
machinery** (`store/trash/`, `Trashed-By` trailer), with a commit
reason like `gmail: label removed upstream`.

- Reversible (git history + the file sits in trash), greppable, and uses the
  system's existing "remove" verb rather than inventing a location.
- Gets the card *out of* `inbox/email/` so wakeup stops re-jobbing it (marking
  in place fails this — it would generate intake jobs forever).
- Hard delete is off the table (surprising, unrecoverable from the working
  tree).

Open sub-choice for you: **trash** (recommended, reuses machinery, reads as
"this turned out to be junk") vs. a **dedicated `store/withdrawn/email/`**
location (more honest that *Gmail* withdrew it, not the user — but introduces a
new location concept and bespoke move code). I lean trash for v1.

**Dangling job ref hygiene.** Because the reactor already tolerates a missing
ref, trashing is safe as-is. But to honor "noisy-output-is-a-bug" I'll also
**prune the trashed thread's ref from any pending intake job**, and delete the
job card if that empties it. Quiet by default.

### 4. Seen-id semantics — KEEP the seen ids (no auto-reimport on relabel)

**Recommendation: GC does not touch `seenGmailIds`.**

- The case this feature targets is "user archived something they don't care
  about" — they will not re-apply the label, and keeping the seen id correctly
  prevents any future re-import.
- We *can't* cheaply drop the right ids anyway: the orphan thread's messages are
  (by definition) absent from the current match list, and there's no on-disk
  card→Gmail-message-id link — dropping would require an extra
  `getThread(threadId)` API call per orphan just to enumerate ids.
- Keeping seen ids also prevents flapping churn (label removed/re-added
  repeatedly → no repeated re-import).
- **Consequence, documented:** if the user re-applies the label after GC, the
  thread will **not** auto-reimport. Acceptable for v1; if we later want
  reimport-on-relabel we add the `getThread` enumeration to drop those ids. Flag
  if you disagree.

## Implementation shape

New file `src/connectors/gmail-gc.ts` exporting a pure, fake-testable:

```ts
reconcileOrphans(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  config: GmailPullConfig;
  labelMap: Map<string, string>;
}): Promise<{ withdrawn: string[] }>   // relative thread-card paths
```

1. `listAllMatching(buildGmailQuery(config))` → set of currently-matching
   **thread ids**.
2. Scan `box/inbox/email/*.email-thread.card`; read each card's `thread-id`.
3. Orphans = cards whose `thread-id` ∉ the matching set.
4. For each orphan: trash the thread card + its `.attach/` scope (reuse trash
   logic), prune its ref from pending intake jobs (delete emptied jobs), collect
   path.
5. Return `{ withdrawn }`. Caller commits **only if non-empty** (quiet
   otherwise) with a `Withdrawn-By: gmail-connector` / `gmail: label removed
   upstream` message.

Wire into `GmailConnector.sync()` after the import block, gated by the
`gc` config flag (default on) and the `gcIntervalHours` cadence read from
transient state. Update `lastReconcileAt` only on a pass that actually ran.

**Build tasks**
- Teach `createFakeGoogleGmail().listMessages` to honor `q` (at least
  `label:<name>` / INBOX filtering against `labelIds`) so the diff is testable
  without live Gmail. Extend the real `listMessages` not required — it already
  passes `q` through.
- Doctest (`test/connector-gmail-gc.doctest.md`, `makeTmpBox` + fake service):
  thread imported → label removed (message drops out of fake match set) →
  reconcile trashes the pending thread; an agent-moved thread (relocated out of
  `inbox/email/`) is left untouched; reconcile with nothing to do writes/says
  nothing.
- Doc: short section in `docs/connectors.md` (reference-altitude) + one-line
  config note. No new env vars.

## Config surface (proposed)

```jsonc
// config/connectors/gmail.json
{
  "query": "label:inbox",
  "labels": [],
  "gc": true,             // default true; set false to keep the old one-way behavior
  "gcIntervalHours": 24   // minimum hours between reconciliation passes
}
```

For arbitrary `query` configs, GC still works but can surprise (a
time-windowed query like `newer_than:7d` will withdraw aged-out pending
threads). Because only un-acted `inbox/email/` cards are ever touched, the blast
radius is bounded — but if you'd rather, we default `gc` **off** for `query`
mode and require explicit opt-in. (Decision flagged below.)

## Open decisions for you

1. Trash (recommended) vs a dedicated `store/withdrawn/email/` location.
2. Default `gc` on for all modes (recommended) vs on for label/inbox modes only
   and opt-in for arbitrary `query` mode.
3. Keep seen ids / no auto-reimport (recommended) vs drop seen ids via an extra
   `getThread` call so a relabel re-imports.
