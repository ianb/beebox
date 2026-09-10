---
title: "Resumed chat threads and agents run without beebox's system prompt: the append is omitted on resume and the SDK does not retain it"
workstream: unattached
area: beebox
priority: important
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
