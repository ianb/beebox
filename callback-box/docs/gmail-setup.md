# Gmail Connector Setup

The Gmail connector pulls email threads into your box via the Gmail REST API. It shares the same Google OAuth connection as the Calendar and Drive connectors — there is no separate password or app password to configure.

## 1. Connect your Google account

Open the box's admin page (`/<box>/admin`). In the **Google Services** section:

1. Click **Connect Google Account** and complete the OAuth flow.
2. After redirect, enable the **Gmail** checkbox for this box.

Boxes that don't have Gmail enabled are skipped silently when the connector runs — the same OAuth connection can serve some boxes Calendar and others Gmail.

If the server doesn't show the Google Services section at all, OAuth client credentials haven't been configured server-wide. See `docs/google-setup.md`.

## 2. Configure what to pull

In your box directory, create:

### `config/connectors/gmail.json`

```json
{ "query": "label:inbox" }
```

The `query` field uses [Gmail search syntax](https://support.google.com/mail/answer/7190?hl=en). Examples:

| Query | What it pulls |
|-------|---------------|
| `label:inbox` | Everything in your inbox (default) |
| `label:inbox is:unread` | Only unread inbox messages |
| `label:work` | Messages with the "work" label |
| `label:inbox -category:promotions` | Inbox minus promotions |
| `from:boss@example.com` | Messages from a specific sender |
| `label:inbox after:2026/02/01` | Inbox messages after a date |

You can also use the `labels` field instead of `query` for simple OR-filtering across labels:

```json
{ "labels": ["inbox", "important"] }
```

If both are set, `query` wins.

## 3. Pull emails

```bash
cb pull --connector gmail
```

Or pull from all connectors:

```bash
cb pull
```

## What gets created

Each Gmail thread becomes a directory in `box/inbox/email/`:

```
box/inbox/email/thread-Subject_Line-abc12345/
  thread.email-thread.card       # Thread envelope (subject, participants, dates)
  msg-001.email-message.card     # Message metadata (from, to, date, snippet)
  msg-001.body.txt               # Full message body (plain text)
  msg-002.email-message.card
  msg-002.body.txt
  attachments/
    document.pdf                 # Any email attachments
```

The `.email-message.card` files contain metadata only — the actual message body is in the adjacent `.body.txt` file. This is a security measure: email body content is untrusted and kept separate so it isn't automatically loaded into agent context.

## Subsequent pulls

The connector tracks which messages it has already seen (by RFC `Message-ID` header) in `config/connectors/gmail-state.json`. On each pull it only writes new messages. If a thread gets new replies, they're appended to the existing thread directory.

A timestamp of the last pull is also stored (gitignored) and is used to narrow the Gmail search with `after:`.

## Migrating from the IMAP / app-password setup

Earlier versions of this connector used IMAP with a Google App Password stored in `config/connectors/gmail.secret.json`. That file is no longer read; the connector deletes it on first sync after this change. If you still have 2-Step Verification app passwords from the old setup, you can revoke them at <https://myaccount.google.com/apppasswords>.

Existing seen-message state in `gmail-state.json` is preserved across the migration — the same RFC `Message-ID` values are used by both implementations.
