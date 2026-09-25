---
title: "A box mailbox on Cloudflare Email Routing: mail goes straight into the box, and can also be forwarded, with no Gmail involved"
workstream: unattached
area: beebox
needs: [design]
labels: [connectors, email, cloudflare]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request for a real box, 2026-09-25
---

A box should be able to own an email address on a domain the boxholder runs
through Cloudflare, with mail delivered straight into the box and no Gmail
account in between. Ideally the same message is also forwarded to one or more
people's normal inboxes. The first consumer is a real box; its specifics are
tracked privately.

## Cloudflare's constraint, and the way around it

An Email Routing **rule has one action**: forward to one verified address,
send to a Worker, or drop. Two rules cannot both match one address. So "into
the box *and* forwarded" cannot be done with routing rules alone.

An **Email Worker** removes the limit. The rule sends the address to a Worker,
and the Worker's `email()` handler can do several things with one message:

- call `message.forward(addr)` more than once; the
  [runtime API docs](https://developers.cloudflare.com/email-routing/email-workers/runtime-api/)
  show `Promise.all` over three destinations. Each destination must be a
  verified address in Email Routing.
- buffer the raw MIME once (`message.raw` is a single-use stream) and store
  it for the box.
- reject with `message.setReject(reason)`. The inbound size limit is 25 MiB.

## How the box could receive it

beebox already has the pattern. Publish-pages' submission path is a
Cloudflare Worker that buffers incoming items in an R2 **ingestion bucket**,
and a pull connector (`beebox/src/connectors/publish-submissions.ts`) lands
them as cards on `bbx wakeup`, then deletes them from R2 (land-then-delete,
idempotent, with an ingestion-scoped token). An email version would be:

1. The Email Worker writes the raw `.eml` to an ingestion bucket (and forwards
   to the verified addresses).
2. A connector pulls new objects on wakeup, parses them (the Gmail connector
   already has MIME handling in `beebox/src/connectors/gmail-mime.ts`), and
   lands `email-message` cards (`beebox/src/schemas/email-message.tsx`),
   threading like the Gmail path does.

A push alternative, where the Worker POSTs to the box, avoids polling but
needs the box reachable from Cloudflare with a scoped credential, and fails
when the box is down. The pull model keeps mail safe in R2 until the box
takes it.

## To decide

- Pull through R2 (reuse the publish-pages pattern and possibly its Worker
  and setup) or push to the box.
- Whether this shares infrastructure with publish-pages, which is being
  redesigned for operational simplicity in the `publish-pages` workstream. One
  Worker and one setup flow for both would cut the setup a boxholder does.
- Sending replies: out of scope at first. Cloudflare Email Sending exists and
  would need its own decision.
- Mail is untrusted input. Treat it like `pub-submission` cards: content an
  agent reads, never instructions it follows.
