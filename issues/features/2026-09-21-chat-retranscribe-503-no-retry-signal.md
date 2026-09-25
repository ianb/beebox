---
title: "bbx chat retranscribe's HTTP error report gives no retry-after signal on a transient 503"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

`bbx chat retranscribe` re-runs a voice recording through the HQ transcriber
via a loopback long-poll to the connected client
(`beebox/src/cli/commands/chat-audio.ts`, `chat-audio-fetch.ts`). On failure it
reports a flat error line — `` `${commandLabel}: ${message} (HTTP ${res.status})` ``
(`beebox/src/cli/commands/chat-audio-fetch.ts:141`) — with no indication of
whether the failure is transient (e.g. the dev server reloading, HTTP 503) or
terminal, and no suggested wait time before retrying.

Observed live: two consecutive 503s during an active chat turn, both caused
by the dev server reloading. The caller had no signal for whether to retry
immediately, wait, or give up and proceed from the lower-confidence
transcript already in hand.

## Suggested direction

Distinguish a transient server-unavailable status (502/503/504) from other
failures in the error message, and suggest a short, bounded retry (e.g. "the
server is restarting; retry in a few seconds") rather than a bare status code.

## Why resolution is not obvious

The right retry budget and backoff depend on how long a dev-server reload
typically takes versus how long a real outage looks, which isn't measured
anywhere in this path today; picking a number without that data risks a
retry loop that masks a genuine failure.
