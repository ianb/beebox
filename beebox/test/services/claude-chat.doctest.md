# ChatBackend service

`ChatBackend.start(opts)` returns a `ChatBackendRun` — a handle on a
long-lived `query()` call against `@anthropic-ai/claude-agent-sdk`. This file
covers the pure option and warm-pool rules of the real adapter.

```ts setup
import { buildQueryOptions, warmSlotKey, warmCompatible } from "../../src/services/claude-chat/core.js";
```

## Query options

The real Claude adapter forwards the exact BBX environment supplied by the
session starter to the SDK query options.

```ts
const exactEnv = {
  PATH: "/repo/beebox/bin:/usr/bin",
  BBX_SERVER_URL: "http://127.0.0.1:3210",
  BBX_AGENT_TOKEN: "agent-token",
};
const built = buildQueryOptions({
  cwd: "/tmp/box",
  systemPrompt: "system",
  resumeSessionId: "sess-abc",
  env: exactEnv,
});
JSON.stringify(built.queryOptions.env)
=> {"PATH":"/repo/beebox/bin:/usr/bin","BBX_SERVER_URL":"http://127.0.0.1:3210","BBX_AGENT_TOKEN":"agent-token"}
```

A chat session loads the box's project settings (`CLAUDE.md`, rules, skills,
hooks) and nothing from the host user's `~/.claude` or any directory above the
box. It also turns off the
claude.ai connectors of the server's Claude login, which belong to one person
(`issues/closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md`).

```ts
const isolated = buildQueryOptions({ cwd: "/tmp/box", systemPrompt: "system", env: {} });
isolated.queryOptions.settingSources
=> ["project"]

isolated.queryOptions.settings
=> {
  disableClaudeAiConnectors: true,
  claudeMdExcludes: [
    "/tmp/CLAUDE.md", "/tmp/CLAUDE.local.md", "/tmp/.claude/CLAUDE.md", "/tmp/.claude/rules/**",
    "/CLAUDE.md", "/CLAUDE.local.md", "/.claude/CLAUDE.md", "/.claude/rules/**",
  ],
}
```

Claude Code's built-ins that act through the host's Claude account are off in
every chat: scheduled and cloud routines, pushes to the account's devices, and
the account's projects, artifacts, designs and feedback. A box agent once sent
a test push through `PushNotification` to the host account's phone
(`issues/closed/bugs/2026-10-09-box-chat-agent-has-host-schedule-and-push-tools.md`).
Subagent tools (`Agent`, `SendMessage`, `TaskStop`) stay.

```ts continue
isolated.queryOptions.disallowedTools
=> [
  "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger",
  "PushNotification", "ReadNotifications", "Artifact", "Projects", "ClaudeDesign",
  "DesignSync", "SendFeedback",
]
```

## A warm subprocess only ever serves the chat it was warmed for

A warm slot has its session id baked in at spawn (`--session-id`), so the pool
is keyed by chat. The unkeyed slot — `""` — is the speculative one, for a send
that brings no id of its own.

```ts
const base = { cwd: "/tmp", systemPrompt: "x", env: {} };
const forChatA = { ...base, coinedSessionId: "aaaaaaaa-1111-4111-8111-111111111111" };
const forChatB = { ...base, coinedSessionId: "bbbbbbbb-2222-4222-8222-222222222222" };

JSON.stringify({ speculative: warmSlotKey(base), chatA: warmSlotKey(forChatA) })
=> {"speculative":"","chatA":"aaaaaaaa-1111-4111-8111-111111111111"}
```

A slot warmed for one chat is refused for another, and the speculative slot is
refused for a chat that brought its own id — it would start the conversation
under the wrong one:

```ts continue
JSON.stringify({
  sameChat: warmCompatible(forChatA, forChatA),
  otherChat: warmCompatible(forChatA, forChatB),
  speculativeForCoined: warmCompatible(base, forChatA),
  coinedForSpeculative: warmCompatible(forChatA, base),
})
=> {"sameChat":true,"otherChat":false,"speculativeForCoined":false,"coinedForSpeculative":false}
```

The provider env is baked in too. A slot warmed before the owner turned
Claude Code telemetry off still carries telemetry on, so it is refused:

```ts continue
JSON.stringify({
  telemetryTurnedOff: warmCompatible(base, { ...base, env: { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" } }),
  unchanged: warmCompatible(base, { ...base, env: {} }),
})
=> {"telemetryTurnedOff":false,"unchanged":true}
```
