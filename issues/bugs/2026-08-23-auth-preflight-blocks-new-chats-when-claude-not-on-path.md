---
title: "New chats fail with \"Claude Code is not logged in\" when the CLI is merely not on the server's PATH"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — a journey walkthrough could not start a second chat
stories: [chat/start-a-chat-scoped-to-a-place-in-the-box]
---

Every new chat in a box fails immediately with

```
Claude Code is not logged in — run `claude auth login` on this machine
```

while chats started earlier keep working. Reproduced twice in one session,
with the older chat answering normally in between.

**The machine is logged in.** `claude auth status` reports
`{"loggedIn": true, "authMethod": "claude.ai"}`. Following the instruction in
the error changes nothing, because nothing is wrong with the login.

## What is actually happening

`checkClaudeAuth` (`src/core/agent/auth-preflight.ts`) runs before an
interactive session's first SDK run — which is why an existing chat is
unaffected and a new one is not. It calls `authStatus()`, which is

```ts
execFile("claude", ["auth", "status"], { timeout: 10000 }, …)
```

(`src/services/claude-cli.ts:27`) — resolving `claude` from `PATH`. The box
server's `PATH`, as spawned by the dev router, is:

```
…/callback-box/bin : …/src/callback-box/node_modules/.bin : …/pnpm/…/node_modules
```

`claude` is at `~/.local/bin/claude`, which is not on it. `execFile` fails
ENOENT, the `err` branch returns `{ loggedIn: false, error }`, and the
preflight raises `ClaudeAuthError`. A missing binary is reported as a missing
login.

## Why the guard is blocking a working agent

The agent does not use that binary. `src/core/sdk-binary-path.ts` says so
directly:

> The system installer at `~/.local/bin/claude` is *not* what the SDK uses — by
> Anthropic's design it ignores `$PATH` and looks only at its sub-packages.

So the preflight probes a **different** Claude Code than the one that would
have served the chat, and refuses on its absence. In the observed session the
agent was demonstrably fine: the pre-existing chat answered every message
throughout.

## Worth deciding rather than assuming

- Should a `PATH` miss block at all? The thing it predicts — an SDK run failing
  on auth — is not what a missing CLI implies.
- If the probe stays, ENOENT should be distinguished from a real logout, since
  the current advice is unactionable in the ENOENT case.
- `sdk-binary-path.ts` already resolves the binary the SDK uses. Probing that
  one would at least make the check ask about the right thing.

The preflight's own doc comment says it exists so that a missing login is not
"an opaque `success: false` from the Agent SDK stream". That intent is good;
this failure mode inverts it, turning a healthy agent into a confident wrong
diagnosis.

## Consequence for the product's shape

The journey this surfaced in is "build an inventory up over a month, and come
back to ask about it". Coming back means a new chat. The one thing that was
reliably broken is the thing that use case is made of.
