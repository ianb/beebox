---
title: "`BBX_SERVER_URL` is underivable outside the serve process, so the documented secret-resolution path fails on a box without `publicUrl`"
workstream: secret-endpoint-derivation
area: beebox
priority: important
labels: [secrets, tricks]
filed-by: agent
discovered-by: Ian
discovered-in: main — a box agent spent a long session failing to resolve a granted secret
---

The agent guide gives box code exactly one way to use a credential:

```
POST $BBX_SERVER_URL/$BBX_BOX_NAME/api/secrets/resolve   (Bearer $BBX_AGENT_TOKEN)
```

On a box with no `publicUrl` in `_config/box.json`, `BBX_SERVER_URL` is absent
in any process that is not the server itself, so that instruction cannot be
followed. Box code then invents its own discovery, and the failure is reported
as a missing grant.

## Why it is absent

`buildScriptEnv` derives the value (`core/script-env.ts:140-147`), in priority
order: live ambient, then `box.json#publicUrl`, then `BBX_PUBLIC_URL` /
`PUBLIC_URL`. It cannot be inherited — `core/script-env-allowlist.ts:50`
withholds `BBX_SERVER_URL` and `BBX_BOX_NAME` deliberately, because a parent's
copy could point a subprocess at the wrong box.

The live ambient is `ambientPublicUrls`, a module-level `Map` in
`core/script-env.ts:78`, filled by `registerBoxPublicUrl` at
`webapp/server.ts:379` after the server binds. **That map is per-process
in-memory state, and it is populated only inside the serve process.** A `bbx`
CLI invocation is a fresh process: its map is empty, so with no `publicUrl`
configured there is nothing to derive from and the variable is simply never
set.

So the contract holds for code running inside the server and silently fails for
anything spawned through the CLI — which is how tricks run.

## What it cost

A box agent lost a long session to this. Its `generate-image` trick reads
`BBX_SERVER_URL` first and falls back to scraping the box's `hub-child.log` for
the newest `<box>: http://host:port/<box>` line. That fallback is fragile for a
reason this repo already knows well: a box child gets a **new port on every
restart**, and one was observed moving 60110 → 60157 within 32 seconds during a
router restart. The scraped port did not match the live one.

The agent then bypassed the trick and called the resolve endpoint by hand,
which **worked immediately** and returned `"suspect": false` — proving the grant
was correct the whole time.

## Two things that turned a bug into a long detour

**The failure is reported as a grant problem.** Box code that follows the guide
has no way to distinguish "could not reach the server" from "not granted", so a
transport failure surfaces as *"supply it and grant agent access for this box"*
— pointing the reader at a permission that is already right. A refusal comes
back as `{kind, message}`; a transport failure has no such shape, and nothing
supplies one.

**The documented shape puts secrets in transcripts.** The guide shows a `POST`
that an agent will naturally reproduce as a shell `curl` when debugging. Its
response body is the plaintext credential, so the value lands in the agent's
tool output and is written to the transcript on disk and rendered in the chat.
The trick keeps the value in-process; a debugging agent does not. A private
companion issue records one occurrence.

## Directions

- Make the value derivable where box code actually runs. A file-based
  registration the CLI can read, refreshed when the child rebinds, would
  survive both the process boundary and the port churn. In-memory ambient state
  cannot cross either.
- Give transport failures their own message, so "cannot reach the box server"
  never renders as "not granted".
- Reconsider the guide's worked example: an agent copying it into a shell
  leaks the credential it is trying to use. A `bbx` subcommand that performs
  the request and hands the value only to the process that needs it would keep
  the documented path off the transcript.
