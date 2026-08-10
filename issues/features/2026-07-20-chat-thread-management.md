---
title: "Chat thread management: delete, rename, archive"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — first-run UX audit for the soft launch
labels: [soft-launch]
---

**Implementation update (2026-08-07):** The permanent single-conversation
DELETE slice is implemented by `worktree-chat-session-delete`, including the
ordered lifecycle, confirmation disclosures, and missing-transcript guards.
This umbrella issue remains open for rename and archive.

No thread-lifecycle operation exists at all — audited 2026-07-20: the chat
tRPC routers (`src/webapp/trpc/routers/chat.ts`,
`chat-session-procedures.ts`, `chat-control-procedures.ts`) expose
navigation, model/feature toggles, `interrupt`, and `restart`, but no
delete, rename, or archive procedure; the session pickers
(`SessionListButton.tsx`, `ChatsLandmarkCard.tsx`) render only links, no
management affordances.

**Delete is boxholder-requested for the launch era (2026-07-20).** It's a
trust/data-lifecycle feature: someone trying the system will produce junk
threads and test messages and needs to clear them — and "I can't delete a
conversation" reads badly in a system whose pitch is user ownership.

Design notes: sessions live on disk, so delete should follow the existing
file-deletion pattern (`DELETE /api/files/*` pre-commits dirty state, then
commits the removal — git-recoverable, `api-files.ts:219-292`). Decide
whether delete is hard-remove-with-git-history or a trash/archive move
(`store/trash/` already exists in the box layout). Rename/archive are
natural companions but delete is the ask.

## Delete mechanics — full-stack research (2026-08-07)

Research (a code blast-radius map + Claude Code web/SDK research) into what
"delete a chat session" actually entails. **Takeaway: a session is three layers,
delete order is a *safety* requirement not tidiness, transcript deletion is
irreversible, and "deleted" can only be claimed honestly alongside a disclosure
about Anthropic-side retention.**

### A session is three layers, only one of which we own

1. **The husk card** — `store/chat/web/<date>_<shortid>.chat.card`, git-tracked;
   its authoritative `session` field points at the SDK session id
   (`src/core/chat/husk.ts`).
2. **The Claude Code transcript** — `~/.claude/projects/<encoded-cwd>/<id>.jsonl`
   **plus a sibling `<id>/` directory** (subagent transcripts, `todo.md`, shell
   snapshots). **The Agent SDK owns these; they live in the user's home dir,
   outside the box, and are NOT git-tracked.** Deleting only the `.jsonl` orphans
   the sidecar dir (accumulates GBs — Claude Code #58154), so a clean delete
   removes the whole `<id>/` dir too.
3. **Index / pointer state** in `.callback-box/`: `chat-session-history.json`
   (id → cwd), `chat-session-id.json` (the most-active pointer bare `/chat`
   resolves to), `chat-review/state.json` (title/summary journal keyed by id),
   plus the in-memory live-session registry.

### Safe delete is an ORDERED operation (a correctness requirement)

The SDK **hard-crashes — exit code 1, "No conversation found with session ID" —
when asked to resume a transcript that's gone**
([claude-agent-sdk-typescript#47](https://github.com/anthropics/claude-agent-sdk-typescript/issues/47));
we run exactly that SDK (`@anthropic-ai/claude-agent-sdk@0.3.222`). So severing
every resume pointer *before* deleting the transcript is required, not hygiene:

1. **Stop the live session** if running (`ChatSessionRegistry`) — else a
   stop-in-flight re-writes state after the delete.
2. **Clear the most-active pointer** if it points here — else bare `/chat`
   resolves to a dead session and crashes on open.
3. **Remove the `chat-session-history.json` entry** — *new code (no removal
   function exists today)*, and the single most important step:
   `reconcileChatHusks` runs on every boot and **resurrects a trashed husk** if it
   still finds the id here with a transcript. A husk-only delete does not stick.
4. **Remove the `chat-review/state.json` journal entry** for the id — *new code*;
   orphaned dead weight otherwise.
5. **Delete the transcript + its `<id>/` sidecar dir** — irreversible (outside
   git).
6. **Trash / remove the husk card** — the one step generic `cb rm` already does.

### Recoverability is asymmetric

The husk card is git-tracked, so trashing it is recoverable. **The transcript is
not** — it lives outside the box and is never git-tracked, so deleting the actual
conversation content is permanent. "Hard-remove-with-git-history" (the note
above) protects only the pointer card, never the content. So the real choice is:
**editorial delete** (trash the husk, leave the transcript — recoverable, but the
conversation still exists in `~/.claude/projects/`) vs. **true delete** (trash the
husk *and* delete the transcript + sidecar — irreversible). The boxholder's
framing (clearing junk/test threads, "user ownership") points at offering a true
delete behind confirmation.

### What's actually removable — and the honesty requirement

- **There is no Anthropic-hosted session store for the Agent SDK.** Sessions are
  purely local — the `.jsonl` *is* the state, resume replays it locally. So a
  local delete genuinely removes the resumable conversation; there is no server
  copy to fetch or resume.
- **But** the API *traffic* those sessions generated is retained by Anthropic per
  its data-retention policy, and **a local delete cannot touch it.** The window
  depends on the auth mode and training opt-out (the subscription/consumer default
  can be years; the commercial API is days) and it is **not per-session
  deletable** — only zero-data-retention (Enterprise) or a bulk privacy request
  removes it. There is no official `claude session delete` yet
  ([claude-code#67201](https://github.com/anthropics/claude-code/issues/67201),
  open feature request) — we're building what upstream hasn't.

- **Boxholder requirement (2026-08-07): the delete interface itself must state
  these limits and link to retention information.** The confirmation UI says
  plainly what is removed (from the box and this machine, permanently) versus what
  Anthropic retains (API logs, per your retention policy, not deletable
  per-conversation), and **links to Anthropic's current retention docs** rather
  than hard-coding a number that rots. Suggested copy: *"Delete this conversation?
  This removes it from your box and this machine, permanently. Anthropic keeps API
  logs of the messages under its data-retention policy (link); those aren't
  deletable per-conversation."* Verify the canonical retention-doc URL and the
  current window at build time —
  [Anthropic API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
  and [Claude Code data usage](https://code.claude.com/docs/en/data-usage) are the
  starting points.

### The session's side effects outlive it (memories + file changes)

A chat session isn't only a transcript — it **acts on the box**. During a session
the agent creates and edits cards, and may write memories (person profiles,
learned facts, retrospective notes — the box's durable knowledge). **None of that
is part of the transcript or the pointer state above, and none of it is reverted
by deleting the session.** Deleting removes the *record of the conversation*, not
its *consequences*: the recipe it added, the memory it wrote, the card it rewrote
all remain (and are already committed to the box's git history regardless).

Implications:

- **The delete interface must warn about this**, alongside the retention
  disclosure — otherwise "delete" over-promises. The user is deleting the
  conversation, not undoing what it did. Suggested addition to the copy:
  *"Changes this conversation made to your box — cards it created or edited,
  memories it wrote — stay. Deleting removes the conversation, not its effects."*
- **Richer, optional:** the session's file changes are partly *attributable* — box
  commits carry authorship trailers, and `cb chat whats-changed` already reports
  commits since a reply — so a future version could surface "this conversation
  touched these cards / wrote these memories" at delete time instead of a generic
  warning.
- **Open question to verify:** do memory/knowledge writes record their originating
  session? If not, memories can't be attributed back to the chat that wrote them,
  so only a generic warning is possible for that class — and that gap is worth
  knowing before promising any "what did this chat change?" affordance.

### Related latent bug (not delete-specific)

The SDK crash-on-missing-transcript (#47) means resuming *any* dead husk (whose
transcript auto-expired at Claude Code's `cleanupPeriodDays`, default 30) doesn't
just fail — it crashes the chat turn. That's a real bug independent of delete,
recorded against
[husks-outlive-their-transcripts](2026-07-29-stale-husks-outlive-their-transcripts.md).

### Sources

- Local-only sessions, no server session store, `SessionStore.delete()` must
  cascade to subkeys —
  [Agent SDK session-storage docs](https://code.claude.com/docs/en/agent-sdk/session-storage).
- Resume-of-deleted crashes (exit 1) —
  [claude-agent-sdk-typescript#47](https://github.com/anthropics/claude-agent-sdk-typescript/issues/47).
- No official session-delete —
  [claude-code#67201](https://github.com/anthropics/claude-code/issues/67201).
- Sidecar / subagent orphans —
  [claude-code#58154](https://github.com/anthropics/claude-code/issues/58154).
