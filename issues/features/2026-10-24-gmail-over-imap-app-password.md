---
title: "Gmail over IMAP/SMTP with an app password: the no-OAuth path with history, labels, drafts, and send"
workstream: google-connect-options
area: beebox
needs: [decision, design]
labels: [connectors, email, google, auth]
filed-by: agent
discovered-in: worktree-google-connect-options — surveying what removes the Google Cloud Console for ordinary people
---

Every OAuth route to Gmail needs either the operator's own Google Cloud
project (the interstitial, the 100-user cap, per-API enablement) or a third
party's verified app that proxies all mail traffic
([research](../../research/google-connect-options-2026-10.md)). Gmail's IMAP
and SMTP endpoints with an app password need neither.

**The path.** The user turns on 2-Step Verification if it is off, creates an
app password at `myaccount.google.com/apppasswords`, and pastes it into the
box. Three to five steps, no Cloud Console, no consent screen. IMAP has been
always-on for personal Gmail accounts since January 2025. The box reads the
whole mailbox history, sees labels as IMAP folders, appends drafts to the
Drafts folder, and sends over SMTP.

**Custody.** The box holds a credential equal to the mailbox password. Today
it holds a refresh token with `gmail.readonly` and `gmail.compose`, so the
stored power is comparable; the difference is that an app password also
allows send and delete, which the OAuth grant deliberately does not
(`beebox/docs/security-report.md`, egress table: "no `gmail.send` scope
exists"). The box must keep that restraint in code rather than in the grant.

**Limits.** App passwords are revoked when the account password changes, are
unavailable with security-key-only 2SV, Advanced Protection, or most
Workspace accounts, and Google calls them "not recommended". No consumer
shutdown is announced; the 2025 Workspace basic-auth cutoff excepted them.
Calendar and Drive are out of reach (CalDAV is OAuth-only), so this is a
Gmail-only path beside OAuth, not a replacement.

**Code.** A second Gmail backend behind the existing connector: IMAP fetch
into the MIME and threading path (`beebox/src/connectors/gmail/mime.ts`),
`Message-ID` as the identity that also lets a later API sync or a
[forwarded copy](2026-10-08-gmail-forwarding-as-the-read-path.md) deduplicate.
Thread identity: IMAP exposes Gmail's `X-GM-THRID` extension, so thread ids
match the API's.

**To decide.** Whether an app password is an acceptable credential to hold
on a box (the boxholder's call on custody versus ease), and whether this or
forwarding is the first non-OAuth Gmail path to build.
