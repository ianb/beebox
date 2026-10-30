# The pi engine

[pi](https://github.com/earendil-works/pi) is an open-source coding-agent
harness. A box can use it as its engine, beside Claude Code and Codex. pi runs
inside the box server process as a TypeScript library. It runs only OpenRouter
models that the owner added in admin. Plan and probe results:
[pi-box-engine](plans/pi-box-engine.md). Model policy for all engines:
[model-policy](model-policy.md).

## Turn it on

1. Set an `openrouter` key and grant it to the box (Admin → Secrets).
2. Add at least one model under Admin → OpenRouter models.
3. Under Admin → Agent engine and model, choose pi as the default engine, or
   turn it on under Available engines.

The pi option stays disabled until steps 1 and 2 are done, and names the
missing step. pi has no default model of its own. Choosing pi saves the
current default with it when that is an added model, and otherwise the first
added model. A pi box with no added default reports `needs-default-model`; a
pi box without the key reports `needs-key` (`piReadiness`,
`src/core/agent/readiness.ts`). Automatic engine recovery never moves a box to
or from pi.

On a box that can run pi, each added model whose settings pi does not ship
shows a note in Admin → OpenRouter models. pi builds such a model from
OpenRouter's listing. A listing with no context length cannot run, and the row
says so. The admin note and the run use the same lookup (`lookupPiModel`,
`src/core/agent/pi-run/session/model.ts`).

## What runs and where state lives

- Runtime: `src/core/agent/pi-run/` (session factory, batch agent, validation).
  Chat backend: `src/services/claude-chat/pi-chat.ts`.
- Session files: `<box>/.beebox/pi/sessions/`, pi's documented JSONL format.
  Chat history, the chat review and usage import read them in place.
- pi's agent directory: `<box>/.beebox/pi/agent/`. The key is passed to pi in
  memory and is never written there.
- The bash tool runs with the box agent's environment from `buildScriptEnv`,
  not the server's. A chat's shell has `BBX_CHAT_SESSION_ID` from its first
  turn, because Bee Box picks the pi session id before the session opens.
- That filter keeps secrets out of the shell's own environment. It is not a
  wall: pi's tools run as the box server's OS user, so `read` on
  `/proc/self/environ`, or a context file linked to it, reaches the server's
  environment. Claude and Codex agents have the same reach through
  `/proc/<server pid>/environ`. The boundary is the per-box OS user, as the
  security overview records under "Managed-site code and same-user trust".
- Tools: `read`, `bash`, `edit`, `write`, `ls`. The box validator checks each
  `edit` and `write` and sends findings back to the model in the same turn.

## Nested AGENTS.md

pi loads the `AGENTS.md` of the working directory and its ancestors when the
session opens. Claude Code also loads a deeper directory's `AGENTS.md` when a
tool touches a file there; pi does not, so Bee Box's `read`, `edit` and
`write` tools do it (`src/core/agent/pi-run/session/nested-guidance.ts`).
They are pi's own tool definitions, registered as custom tools of the same
names; no extension runs.

After one of these tools runs on a file in the box, each instruction file
(`AGENTS.md`, else `CLAUDE.md`) between the working directory and the file's
directory is appended to the tool result in a `<nested-agents-md path="...">`
block, with its `@` includes expanded. A file goes in once per session; a
resumed session can deliver it again. Reading the instruction file itself
counts as delivery. An include the root file already expanded is not
repeated. One file adds at most 12,000 characters. bash and `ls` deliver
nothing.

A box agent can write a symlink. An instruction file whose real path is
outside the box is not read, and the server logs a warning. On an `edit` or
`write` the guidance arrives after the change, so the model may need a second
edit; the knowledge audit `pi-nested-agents-before-edit` checks the order with
`read_before_edit`.

## Choices that close pi off from the box

A box agent can write files under the box, including `.pi/` and
`.beebox/pi/agent/`. Each of these files would change how pi runs inside the
server, so pi ignores them:

- **Offline.** `PI_OFFLINE=1` is set before pi loads. pi makes no catalog
  refresh call to pi.dev and downloads no ripgrep or fd binary. The `grep` and
  `find` tools are never offered, so the download path stays closed even
  without the variable. The agent uses `rg` through bash.
- **No extensions.** pi extensions are code and would run in the server
  process.
- **No settings files.** Settings are in memory, so `.pi/settings.json`
  cannot enable packages.
- **No `auth.json`.** Credentials are in memory. pi runs a stored key that
  starts with `!` as a shell command, with the server's environment.
- **No `models.json`.** It could point the OpenRouter provider, and the key,
  at another host.
- **No `SYSTEM.md`.** It would replace pi's base prompt. The box's guidance
  reaches pi through `AGENTS.md` (nested ones through the file tools),
  `.agents/skills` and the appended system prompt.

## What it cannot do

- Run models from other providers, or use a Claude or ChatGPT subscription.
- Accept a chat id coined by the browser. A new pi chat goes through
  `?session=new`.
- Steer a running step from the chat UI. A message sent mid-turn waits for
  the turn, as on Claude.
- Show raw transcripts in `bbx session --raw` or `bbx feedback`.
- Run `deepseek/deepseek-chat-v3.1`. pi's catalog marks it as a reasoning
  model, so pi turns reasoning on, and the model then writes its tool calls
  inside its reasoning. No tool runs. Use `deepseek/deepseek-v3.2`.

## Cost is an estimate

pi prices each message from its catalog. Batch runs print `pi estimated cost`;
a chat turn's result carries the same figure in `total_cost_usd`. The figure
matched OpenRouter's bill for DeepSeek, Qwen and Particle in the 2026-10-29
probe. For Kimi k2, cache reads were undercounted by half, because pi's
catalog prices Kimi's cache read at 0. A model built from OpenRouter's listing
with no listed price counts as $0. A run with a spending limit refuses such a
model. The OpenRouter key's usage line in admin is the bill.

## Upgrade

`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` are pinned to
the same exact version in `beebox/package.json`. Bump both together. pi has no
semver policy, so then run the pi tests (`test/core/agent/pi-run/`,
`test/core/agent/invoke/pi-agent.test.ts`, `test/core/chat/session/run.pi.test.ts`)
and the live smoke, `pnpm pi-smoke` from `beebox/` (`src/dev/pi-smoke.ts`).
It needs `BBX_OPENROUTER_API_KEY` in the environment or `beebox/.env`, and
runs in a throwaway box with its own secret store. On each model it runs a
batch turn that reads a file, a resume, a structured call, a bash call that
must not see a server variable, and a chat turn read back from the session
file. With no model argument it runs `deepseek/deepseek-v3.2` (reasoning on)
and `qwen/qwen3-coder` (reasoning off), for under $0.01. It stops once pi's
estimate passes $0.25.
