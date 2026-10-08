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
