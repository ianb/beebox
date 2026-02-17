# Gmail Connector Setup

The Gmail connector pulls email threads into your box via IMAP using a Google App Password.

## 1. Enable 2-Step Verification

If you haven't already, enable 2-Step Verification on your Google Account:

1. Go to https://myaccount.google.com/security
2. Under "How you sign in to Google", click **2-Step Verification**
3. Follow the prompts to set it up

## 2. Create an App Password

1. Go to https://myaccount.google.com/apppasswords
2. Enter a name (e.g., "callback-box")
3. Click **Create**
4. Copy the 16-character password — it's only shown once

## 3. Configure the connector

In your box directory, create two files:

### `config/connectors/gmail.secret.json`

```json
{
  "user": "you@gmail.com",
  "appPassword": "abcd efgh ijkl mnop"
}
```

This file is gitignored by the `*.secret.*` pattern.

### `config/connectors/gmail.json`

```json
{
  "query": "label:inbox"
}
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

You can also use the `labels` field instead of `query` for simple label filtering:

```json
{
  "labels": ["inbox", "important"]
}
```

## 4. Pull emails

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

The connector tracks which messages it has already seen. On each pull it only fetches new messages. If a thread gets new replies, they're appended to the existing thread directory.

## Notes

- The connector connects to `imap.gmail.com:993` (SSL)
- App passwords don't expire unless you change your Google account password or revoke them
- If you change your Google password, all app passwords are revoked — you'll need to create a new one
- The state file (`config/connectors/gmail-state.json`) tracks seen message IDs and is auto-managed
