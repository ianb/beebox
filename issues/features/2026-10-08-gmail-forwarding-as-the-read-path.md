---
title: "Read Gmail by forwarding it into the box, with no OAuth: a filter forwards to the box's own address"
workstream: unattached
area: beebox
needs: [design]
labels: [connectors, email, google]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-imbue-studio-research — after weighing Gmail OAuth workarounds against Imbue Studio's shipped client
---

Reading Gmail today needs a bring-your-own OAuth client, Google's unverified
interstitial for restricted scopes, and either Testing mode's seven-day
refresh expiry or an unverified production app
(`beebox/docs/connectors/google-auth.md`). A shipped vendor client does not
remove that for Gmail: `gmail.readonly` and `gmail.modify` are restricted
scopes, so production use needs a CASA assessment
([the Studio comparison](../../research/imbue-studio/comparison.md), section 2,
and [google-auth-connect-approaches](../../research/google-auth-connect-approaches.md)).

The boxholder (2026-10-08): forwarding is probably the way to go.

**The path.** The user adds one Gmail filter, "forward all mail to
`<box address>`" (Gmail asks them to confirm the destination once). The box
receives it at its own address and lands `email-message` cards exactly as the
Gmail connector does. No Google API, no OAuth client, no verification, no
expiry, near-real-time delivery, and the connector code is the existing MIME
and threading path (`beebox/src/connectors/gmail/mime.ts`).

**What it needs.** The receiving half is
[a box mailbox on Cloudflare Email Routing](2026-09-25-cloudflare-email-inbox-connector.md):
an address the box owns, an Email Worker or a pull through an ingestion
bucket. That issue's first consumer is a box that owns its own address; this
issue adds the second consumer, a person's Gmail forwarded in.

**What it does not give.** Write-back. Archive, label, draft, and send still
need the API, so the Gmail connector stays for the write half, and the two
must agree on thread identity (a forwarded message keeps `Message-ID` and
`References`, which the threading already uses; the Gmail thread id is not
present). Forwarding also sends only new mail; history comes through the API
or a Takeout import.

**To decide.**

- Whether a forwarded message becomes the same card the API path would make,
  so a later API sync does not duplicate it (match on `Message-ID`).
- Whether the box's address should be per box or per person, since one
  mailbox may receive several people's forwards.
- The triage and digest use cases ([cross-tool to-do](2026-10-08-cross-tool-todo-as-a-target-use-case.md))
  need only this read half; which starter gets it first.
