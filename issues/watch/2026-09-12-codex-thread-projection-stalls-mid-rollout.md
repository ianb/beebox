---
title: "Codex's thread-history projection stalls mid-rollout, so a live chat's replies vanish from the UI and never come back"
workstream: unattached
area: beebox
labels: [codex, chat, upstream]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I sent the last message. It responded! But now the response is gone"
priority: important
---

**Trigger to re-check:** a Codex release that adds a supported reindex/repair
path, or fixes projection resumption. Watch
[openai/codex#31433](https://github.com/openai/codex/issues/31433) and the
sibling history-index issues below. Nothing to do here until then.

## What happened

A chat reply streamed into the UI, was read, and then disappeared. It did not
come back on reload, and would not have come back on any reload.

The message was never lost. Codex's rollout JSONL holds it
(`~/.codex/sessions/2026/09/11/rollout-…-01a08ff7….jsonl`, assistant message at
`2026-09-12T13:30:16`, followed by `task_complete`). What failed is Codex's
**indexing** of its own log.

Codex keeps `~/.codex/thread_history_1.sqlite` with a
`thread_history_projection_state` table recording, per thread, how far it has
projected the rollout file into queryable turns. `thread/read` — the app-server
RPC beebox calls for Codex chat history — serves from that projection, not from
the rollout. For this thread the row read **2,915,378 bytes / 648 lines** while
the rollout on disk was **4,627,500 bytes / 823 lines**. Codex had ignored the
last 1.7 MB — 175 lines, 22 messages, spanning two days.

## Why it was not beebox

Worth recording, because the symptom points here first:

- beebox holds **no cache** on this path. `codex-transcript.ts:113-116` issues a
  fresh `thread/read` per request, and the shared app-server closes after 30s
  idle (`IDLE_CLOSE_MS`), so a reload usually spawns a new server and asks
  again. It faithfully reported what Codex told it.
- A `[chat-session] transcript flush wait timed out` warning fired on the same
  turn ([the flush-timeout issue](../bugs/2026-08-09-transcript-flush-wait-full-timeout-real-sdk.md)).
  That is a real bug but a red herring here: it would cost one turn's final
  message, not 175 unindexed lines reaching back to the previous afternoon.

## Scale, measured

Across the whole store: **396 threads in the projection table, 1,261 rollout
files, 4 threads behind.** Two materially —

| thread | behind | rollout last written |
|---|---|---|
| `01a05ff8…` | 4.91 MB (5,940,927 / 10,853,842) | 2026-09-02 |
| `01a08ff7…` | 1.71 MB (2,915,378 / 4,627,500) | 2026-09-12 |

The other two are ~2-3 KB short, consistent with a trailing partial record.

So it is rare, and **not** caused by the recent version bump — one has been
stuck since 2026-09-02. (Note anyway that `codex-cli` is 0.154.0 while beebox
pins `@openai/codex` 0.153.4, so writer and projector can differ in version.)

**No single poison record.** The halt points differ by record type:
`thread_settings_applied` (this thread), a plain `response_item/message` (the
Sept 2 thread), `custom_tool_call_output` (the two trivial ones). That argues
for the projector dying or being interrupted mid-run and never resuming from
its saved offset, rather than choking on one malformed event kind.

## Upstream status

A cluster of open issues describes the history index diverging from the rollout
files — [#31433](https://github.com/openai/codex/issues/31433) (valid rollouts
left unindexed; the reporter notes there is "no safe supported way to reconcile
the state DB with the existing rollout files"; open, no reply from OpenAI),
[#19822](https://github.com/openai/codex/issues/19822) (stale index, recent
sessions unresumable), [#27363](https://github.com/openai/codex/issues/27363),
[#28068](https://github.com/openai/codex/issues/28068).

**All of them are the wholly-missing-row case.** #31433 says explicitly the
files are "not partially indexed or offset-related", and none mentions
`thread_history_projection_state` or a projection offset. The partial-projection
variant documented here appears to be unreported, and is worth filing upstream
with the offset-vs-filesize evidence.

## If it happens again

The data is in the rollout JSONL and can be read directly. There is no supported
reindex command; `codex doctor` reports drift without repairing it, and editing
the SQLite by hand is called unsafe upstream. Re-measure with the projection
offset against the rollout's size before assuming a beebox cause — that
comparison is what separates this from a beebox bug in one step.
