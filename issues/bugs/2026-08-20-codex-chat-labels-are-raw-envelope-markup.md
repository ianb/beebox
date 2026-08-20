---
title: "Every Codex chat is labelled with raw `<chat-app>` envelope markup, so Recent chats shows a wall of identical rows"
workstream: unattached
area: callback-box
labels: [chat, codex, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder could not find a recent Codex session in Recent chats
---

A Codex chat's row label is the raw `<chat-app narration="off" prose="on"
local-time="…"` envelope instead of the user's first message. Claude chats in
the same list get real labels. So Codex chats are present in Recent chats but
unrecognizable — every one of them opens with the same machine markup, and they
read as noise rather than as chats.

## Verified by running the enumeration (2026-08-20)

Ran `loadAllSessions()` against a real box: 93 chats, 15 of them Codex. **All 15
Codex labels are the envelope**; every Claude label is a readable first message
or an editorial title.

The label is exactly **400 characters** — `codexSessionLabel`'s
`.slice(0, 400)` (`core/chat/session/list.ts:171-174`) — and the envelope alone
is longer than that. So the cut lands inside the machine prefix and a Codex
label **can never contain the user's text at all**. It is not truncation that
loses the ending; it is truncation that keeps only the header.

## The cause is a bypassed extraction step

Two label paths that were never made equivalent (`list.ts:119-127`):

- **Claude** → `resolveSessionLabel` → `readFirstUserSnippet`
  (`cli/lib/session-snippet.ts:45-70`), which runs `extractSnippet`, skips SDK
  meta prompts (`raw.isMeta`), skips plumbing and compaction summaries and
  self-notes (`:35-38`), and — the load-bearing part — **keeps scanning when a
  turn strips to nothing**: *"A turn whose text is all speech-wrapper markup
  strips to nothing; keep scanning rather than reporting the chat as
  unlabeled."*
- **Codex** → `codexSessionLabel` → the thread's native `preview` field, sliced.
  No stripping, no plumbing skip, no rescan.

The Codex preview is the raw first user message, envelope included, so it hits
precisely the case the Claude path was written to handle.

## Fix direction

The adapter already does the hard part. `entriesFromThread`
(`core/chat/session/codex-transcript.ts:135-185`) parses `userMessage` items
into proper `SessionEntry` values with clean text content. So the label can come
from the same extraction the Claude path uses, rather than from the list RPC's
`preview` string — which would also give Codex the plumbing-skip and the rescan
for free, instead of reimplementing them.

Worth deciding whether the shared step belongs *below* both paths (one
"first real user message → label" function that takes entries, with each engine
supplying entries) so a third engine cannot repeat this. The two paths diverging
silently is the actual defect; the envelope is just how it showed up.

## What this does NOT explain

The boxholder also reported that opening a specific landmark resumed an older
chat rather than the recent Codex one. That is a separate thing and may not be a
bug: on the box inspected, the recent Codex chat is bound to a **parent**
directory, while the landmark they opened is a **child** of it, whose newest
bound chat really is the older one. Whether the binding is wrong depends on
where the chat was started, which cannot be recovered from the data. Flagging it
rather than folding it in — if landmark binding is picking a parent when a chat
starts in a child, that is its own issue and needs a deliberate repro.

Also ruled out while investigating: Codex sessions are **not** dropped from the
enumeration, and the `cwd` matching in `listSessionEntries` (`list.ts:80-87`) is
correct. Recorded here because it looks alarming on a first read and cost a
detour:

- A landmark-bound chat really is spawned with `cwd = boxRoot/<contextDir>` —
  stated by `registry.createNew`'s contract (`registry.ts:215-217`, "the SDK is
  spawned with `cwd` set to that directory") and by `history.ts:287`. Probing a
  live box confirms it: the thread's own `cwd` is the landmark directory, not
  the box root.
- The `cwd` list parameter **is** a real filter. Probed against a live box:
  a nonexistent path returns 0 threads, an empty list returns 0, and one
  landmark directory returns exactly the threads bound to it.

`chat/session/thread.ts:169` (`cwd: this.boxRoot`) is a **different
subsystem** — `ChatThreadSession`, built by the thread pool (`pool.ts:188`),
not the web chat registry. Easy to mistake for the web chat spawn; it isn't
one.
