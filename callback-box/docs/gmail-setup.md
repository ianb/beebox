# Gmail Connector Setup

The Gmail connector maintains a deliberately small, tracked working set. Gmail
remains the complete mailbox; email does not automatically become Git content.
It shares the Google OAuth connection used by Calendar and Drive.

## Connect Google

On the box admin page, connect a Google account and enable Gmail for the box.
If Google Services is absent, configure the server-wide OAuth client described
in [google-setup.md](google-setup.md).

## Track a thread explicitly

Use the Gmail API thread ID:

```bash
cb connector gmail track THREAD_ID
```

This creates one `*.email-thread.card` plus its attach scope and commits them.
The command is idempotent. Regular `cb wakeup --connector gmail` runs refresh
every live email-thread card wherever it has been moved in the box.

Card existence is the tracking registry. Deleting or trashing the thread card
stops synchronization; it does not delete, archive, relabel, or mark the Gmail
thread read. A leftover attach scope does not keep a thread tracked.

## Automatic rules

`config/connectors/gmail.json` is required once Gmail is enabled — sync fails
with an error rather than quietly importing nothing, because "no rules" and "no
config" used to look identical from the outside.

Named rules may either track newly matching threads or request a procedure:

```json
{
  "rules": [
    {
      "name": "send-to-agent",
      "query": "label:callback-box",
      "action": {
        "type": "track",
        "budget": { "threads": 25, "window": "7d" }
      }
    },
    {
      "name": "review-unread",
      "query": "label:inbox is:unread",
      "action": {
        "type": "procedure",
        "ref": "config/procedures/review-email.procedure.card"
      }
    }
  ]
}
```

Track rules always have a rolling thread budget. The default is 25 threads in
seven days; both values are configurable. The first sync after a rule is added
records the existing match count without tracking that backlog. Later matches
beyond the budget remain in Gmail and appear only as bounded private summaries.
They are not queued for delayed import.

### The shorthand

`query` and `labels` are a shorthand for a single rule, easier to hand-edit and
the shape the admin page writes. Multiple labels are OR-joined. The rule is
named `shorthand`, and it baselines existing matches instead of importing the
backlog, exactly like a named rule.

```json
{
  "labels": ["fsmn", "grs", "family"],
  "action": { "type": "track" }
}
```

**`action` is required.** It is not defaulted, and a shorthand without one is a
config error that stops the sync. It used to be implied as `track`, which meant
saving a filter from the admin page created cards without ever saying so —
every path a boxholder could reach ended in automatic card creation. Choosing
the action is now the deliberate step it always should have been.

An `action` with no `query` or `labels` beside it is equally an error, as is
combining `action` with named `rules` (each rule carries its own), or setting
`query` and `labels` together — they are two spellings of the same thing, and
the one that lost would sit in the file matching nothing.

Renaming or adding a rule resets that rule's budget and re-baselines it, so mail
already in Gmail when the rule appears is recorded as pre-existing and not
collected. To pull in a specific older thread, track it explicitly with
`cb connector gmail track <thread-id>`.

Inspect a rule's machine-local summaries and counts with:

```bash
cb connector gmail pending
cb connector gmail pending send-to-agent
```

The data lives in gitignored `config/connectors/gmail.state.json`. It is a
bounded discovery aid, not an offline mailbox mirror or a Git artifact.

Procedure actions run after connector writes and commits finish. Their
directive names the Gmail rule and points the procedure to the `pending`
command; procedure prechecks can therefore abort without starting an agent.

## Search and read untracked Gmail

Use the pinned Google Workspace CLI through the authenticated, remote-read-only
passthrough. Arguments retain the upstream `gws` vocabulary:

```bash
cb connector gmail gws -- gmail +triage --query 'from:boss is:unread'
cb connector gmail gws -- gmail +read --id MESSAGE_ID --headers
cb connector gmail gws -- gmail users threads get --params '{"userId":"me","id":"THREAD_ID"}'
cb connector gmail gws -- schema gmail.users.messages.list
```

Only Gmail get/list operations, the `+read` and `+triage` helpers, Gmail schema,
and help are allowed. Mutation and non-Gmail commands are rejected before an
access token is minted. The passthrough preserves `gws` output and exit status.

Untracked Gmail is absent from box search and agent context. Use this command
when a question requires mail beyond the tracked cards.

## On-disk shape

Each tracked thread is one card with a sibling attach scope:

```text
box/inbox/email/Subject.email-thread.card
box/inbox/email/Subject.attach/
  msg-001.email-message.card
  msg-001.attach/
    msg-001.body.txt
    attachments/
      document.pdf
```

Messages are individual child cards because they are addressable records, but
the Gmail thread is the tracked and synchronized unit. Bodies remain separate
untrusted text files and are not automatically loaded as card instructions.

## Sync state and old installations

`gmail.state.json` stores the history cursor (including bounded-batch resume
state), rule baseline counts, rolling-budget events, bounded pending summaries,
and bounded summaries that could not be safely evaluated because their RFC
Message-ID was absent or malformed. A corrupt owned value fails closed; obsolete
top-level fields from the old GC implementation are discarded. An expired Gmail
cursor establishes a new checkpoint and recounts rule matches without fetching
or importing mailbox content.

Older committed `gmail-state.json` files are no longer the tracking registry or
written by sync. They may be removed in an explicitly authorized cleanup; the
connector does not rewrite box history. Obsolete `gmail.secret.json` IMAP
credentials are removed best-effort on sync.
