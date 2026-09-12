---
title: "thread.ts and run.ts omit the system prompt on resume and rely on the SDK retaining it — a default that flipped twice in a week"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.267's system-prompt recording change
labels: [sdk-update]
---

Two beebox paths build their appended system prompt **only for a fresh
session** and pass nothing on resume:

- `ChatThreadSession` (`src/core/chat/session/thread.ts:145`) —
  `if (!this.sessionId) { systemPrompt = buildThreadSystemPrompt(...) + tzContext }`,
  so a resumed thread sends `append: ""`.
- `runAgent` (`src/core/agent/run.ts:264`) —
  `const appendedSystem = isResume ? "" : systemPrompt + tzContext;`, matching
  `AgentInvokeOptions.systemPrompt`'s doc comment, "provided on first invoke,
  omitted on resume". Every `Agent` resumed this way inherits it: reactor
  sessions (`src/core/chat/reactor-sessions.ts:94`, `resume: true` within the
  message and age caps), procedure review retries (`retryRunAgent` in
  `src/core/procedure/engine-run-execute.ts`), and the commit-nudge retry in
  `ensureAgentCommitted`.

Both assume the SDK keeps the first run's append for the life of the session.
**On the current pin it does not.** Verified with a two-turn probe, a scratch
directory with no settings sources: turn 1 carries
`append: "Your codename is ZEBRA-7. Never mention it unless asked for your
codename."` and is told to reply `OK`; turn 2 resumes the same session and asks
for the codename.

| SDK | resume passes | turn-2 answer |
|---|---|---|
| `0.3.263` (pinned) | no `systemPrompt` option | `NONE` |
| `0.3.263` (pinned) | `append: ""` — chat threads' exact shape | `NONE` |
| `0.3.267` | no `systemPrompt` option | `ZEBRA-7` |

So on every resumed turn:

- **Chat threads** run without `CHAT_THREAD_MODE` — the `<chat-message>` input
  format, the `<chat-response>` wrapping rule, "keep each response SHORT",
  "Do NOT use Markdown formatting", "Do NOT edit the thread file directly", and
  the thread-archive section — plus the timezone context. What survives is the
  one-line per-message reminder at `thread.ts:331`, whose comment attributes the
  loss to the system prompt having "been compacted away from context". On this
  pin the cause is the resume itself.
- **Resumed agents** run without whatever system prompt their first invoke
  supplied, and without the timezone context.

**Not affected:** the main web chat. `buildBackendStartOptions`
(`src/core/chat/session/start.ts`) resolves and passes the full
`CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY` on every start, resumes
included.

## Why `0.3.267` is not the whole fix

`0.3.267` changes the default: "`systemPrompt` recording [defaults] on for custom
prompts and appends (a mid-session prompt change takes effect at the next
compaction)". That restores the first run's append on the affected paths — the
last row of the table — but it makes the result depend on an SDK default that
has just changed once, and it changes the one path that works today: the web
chat re-passes a prompt that legitimately varies (timezone context, the landmark
note from `buildLandmarkSessionNote`), and under recording those changes wait for
a compaction instead of applying on the next run.

## Suggested shape

1. **Pass the system prompt on resume** in `thread.ts` and `run.ts`, as
   `start.ts` already does. That works on every SDK version, including the
   current pin, and retires the `thread.ts:331` reminder's reason to exist.
2. **Decide `snapshot` once the pin reaches `0.3.267`:** with step 1 in place,
   `snapshot: false` keeps today's per-request rendering, so a changed prompt
   applies on the next run on all three paths. Leaving recording on is also
   defensible — cheaper prompt caching — but then the web chat's timezone and
   landmark note stop tracking mid-session.

Step 1 does not depend on the pin, which is why this is filed as a bug to fix now
rather than something to wait out: the settled path would not reach `0.3.267`
before 2026-09-12, and the table's first two rows are the behavior until then.

## Corrected 2026-09-12 — the loss was already fixed upstream; priority lowered

Re-probing on the newer pins shows the retention failure was specific to
`0.3.263` and earlier. Same two-turn codename probe, extended:

| SDK | resume passes | turn-2 answer |
|---|---|---|
| `0.3.263` | no `systemPrompt` option | `NONE` |
| `0.3.263` | `append: ""` | `NONE` |
| `0.3.266` | no `systemPrompt` option | `ZEBRA-7` |
| `0.3.266` | `append: ""` | `ZEBRA-7` |
| `0.3.267` | no `systemPrompt` option | `ZEBRA-7` |
| `0.3.267` | `append: ""` | `ZEBRA-7` |

So the first append is retained from `0.3.266` on — before `0.3.267`'s
documented default change, which points at 2.1.265's *"sessions started with
`--system-prompt` or `--append-system-prompt` now record the system prompt …
once"* as where it actually landed. The pin passed `0.3.266` on 2026-09-11 and
`0.3.267` on 2026-09-12, so **resumed chat threads and resumed agents do get
their system prompt today**. The original report was accurate when the pin was
`0.3.263`; it stopped being accurate a day later, and the 2026-09-11 run report
repeated the stale claim.

**What still stands, and why this stays open at `normal`:**

1. `thread.ts:145` and `run.ts:264` depend on the SDK retaining a prompt they
   deliberately stop sending. That dependency is undocumented in both files and
   is on a default that upstream turned **off → on** within a week. Passing the
   prompt on resume, as `start.ts` already does, removes the dependency and
   costs nothing.
2. A **changed** append on resume does not take effect. Probed on `0.3.266` and
   `0.3.267`: resuming with a different codename still answers with the first
   one. beebox's warm-run reuse check compares `systemPrompt`
   (`claude-chat.ts:160`) so a changed prompt starts a new run — but for a
   *resumed* session that new prompt is ignored, so the web chat's varying parts
   (timezone context, `buildLandmarkSessionNote`) cannot reach an existing
   session. `snapshot: false` restores per-request rendering; that is the
   decision to make alongside step 1.
3. The `thread.ts:331` reminder's comment still blames compaction for a loss
   that was the resume. Worth correcting or retiring with step 1.
