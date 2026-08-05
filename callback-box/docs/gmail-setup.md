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

With no `config/connectors/gmail.json`, Gmail sync creates no new email cards.
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

Legacy `{ "query": "..." }` and `{ "labels": [...] }` configurations are
treated as one `legacy-import` track rule with the default rolling budget. They
also baseline existing matches instead of importing the backlog.

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

`gmail.state.json` stores the history cursor, rule baselines, rolling-budget
events, and bounded pending summaries. A corrupt file fails closed. An expired
Gmail cursor establishes a new checkpoint, recounts rule matches, and refreshes
tracked cards without listing the mailbox into Git.

Older committed `gmail-state.json` files are no longer the tracking registry or
written by sync. They may be removed in an explicitly authorized cleanup; the
connector does not rewrite box history. Obsolete `gmail.secret.json` IMAP
credentials are removed best-effort on sync.
