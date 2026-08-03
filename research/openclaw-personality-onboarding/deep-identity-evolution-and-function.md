# OpenClaw Identity After t0: Evolution Pathways and Functional Roles

*Reviewed 2026-08-02; OpenClaw at commit `1ffc31983`.*

This note covers two questions the rest of the corpus leaves open. **Part A**: once
the first-run ritual has written `IDENTITY.md`, does anything change it again — by
CLI, by UI, by the agent itself, or on a schedule? **Part B**: which identity fields
are actually wired into runtime behaviour, as opposed to being personality flavour?

The ritual itself and the prompt-assembly of the workspace files are covered in
`deep-bootstrap-ritual.md` and `deep-identity-files-and-prompt.md`; external
criticism of the design is in `reception.md`. OpenClaw's nightly memory-distillation
loop ("dreaming") is documented in `../openclaw-hermes/deep-openclaw-dreaming.md` and
is referenced rather than re-described here.

## Identity lives in two stores that never sync themselves

This split is the single fact that explains most of what follows.

| Store | Shape | Written by | Read by |
| --- | --- | --- | --- |
| Config `agents.list[].identity` | `{ name?, theme?, emoji?, avatar? }` (`src/config/types.base.ts:225-231`) | `openclaw agents set-identity`, gateway `agents.create`/`agents.update`, hand-editing the config | Every runtime consumer in Part B |
| Workspace `IDENTITY.md` | Markdown `- Label: value` lines; parser also accepts `Creature` and `Vibe` (`src/agents/identity-file.ts:38-78`) | The agent during bootstrap (ordinary file-write tools); appended to by gateway agent create/update | The system prompt (as a context file), avatar resolution, the UI assistant identity, `agents list`, and `set-identity --from-identity` |
| Workspace `SOUL.md` | Free prose | The agent; the user | The system prompt only |

`resolveAgentIdentity` (`src/agents/identity.ts:6-11`) — the accessor nearly every
functional consumer calls — reads **config only**. It never falls back to
`IDENTITY.md`. So the file the bootstrap ritual asks the agent to fill in is, for most
runtime purposes, inert until a human runs a CLI command that copies it into config.

The parser drops the shipped placeholder strings (`src/agents/identity-file.ts:14-20`,
e.g. `"your signature — pick one that feels right"`), and `loadIdentityFromFile`
returns `null` when nothing survives — an unfilled template is indistinguishable from a
missing file.

---

# Part A — What happens to identity after the first session

## A1. The write paths that exist

| Pathway | Writes config? | Writes `IDENTITY.md`? | Triggered by |
| --- | --- | --- | --- |
| Bootstrap ritual | No | Yes — the agent edits it with its own file tools | The agent, once |
| `openclaw agents set-identity --name/--theme/--emoji/--avatar` | Yes | No | Human, manually |
| `openclaw agents set-identity --from-identity` | Yes (imports from the file) | No | Human, manually |
| Gateway `agents.create` | Yes (`entry.name`, workspace, model) | Yes — **appends** `- Name:`/`- Emoji:`/`- Avatar:` | Human, via Control UI or RPC |
| Gateway `agents.update` | Yes (name/workspace/model) | Appends `- Avatar:` only | Human |
| Gateway `agents.files.set` + the Control UI file editor | No | Yes — arbitrary content | Human |
| The agent editing `IDENTITY.md` / `SOUL.md` mid-life | No | Yes | The agent, unprompted |
| The agent calling `config.patch` via the `gateway` tool, or shelling out to `openclaw agents set-identity` | Yes | No | The agent, if it thinks to |
| `ui.assistant.{name,avatar}` config override | n/a (separate key) | No | Human |
| `openclaw gateway --dev` | Yes (hardcoded C3-PO) | Yes | Dev mode only |

`set-identity` is the only path that moves values *from* the file *to* config
(`src/commands/agents.commands.identity.ts:125-198`), and it is strictly manual — no
hook, boot step, or heartbeat calls it. It also collapses the file's `Creature` and
`Vibe` into the single config field `theme`
(`src/commands/agents.commands.identity.ts:142-151`), which is why those two
personality prompts have no config representation of their own.

The gateway paths **append** rather than rewrite (`src/gateway/server-methods/agents.ts:427-438`
and `:492-497`). Since `parseIdentityMarkdown` iterates lines and lets later
assignments overwrite earlier ones, the appended block wins — but the file accumulates
duplicate `- Name:` lines over repeated edits, alongside the still-unfilled template
placeholders.

The Control UI has no name/emoji form: `ui/src/ui/views/agents.ts` renders identity
read-only, and no UI code calls `agents.create`/`agents.update` at all (those are
API-only). What the UI does offer is a plain **text editor over the workspace files** —
`ui/src/ui/controllers/agent-files.ts:99-126` calls the gateway RPC `agents.files.set`
(`src/gateway/server-methods/agents.ts:671`), whose allowlist includes `IDENTITY.md` and
`SOUL.md` (`:66`). Editing identity in the UI therefore means editing the markdown, with
the same no-sync-to-config consequence. (`agents.files.list` hides `BOOTSTRAP.md` once
onboarding is marked complete, `:575-579`.)

## A2. Self-editing is permitted and invited, but functionally inert

The agent can rewrite its own identity files: `IDENTITY.md`, `SOUL.md`, `USER.md`,
`AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md` and `memory/` all sit at the root of the agent
workspace, which is the tool cwd for bash/exec/apply-patch
(`src/agents/pi-tools.ts:316,399,428`), and the workspace is initialised as a git repo
(`ensureGitRepo`, `src/agents/workspace.ts:390`). Nothing marks the identity files
read-only; the only relevant lever is the opt-in `tools.fs.workspaceOnly`
(`src/agents/tool-fs-policy.ts:8-30`, default off), which *confines* writes to the
workspace rather than excluding anything, plus read-only sandbox mode.

All of them are also loaded into every run as bootstrap context files
(`loadWorkspaceBootstrapFiles`, `src/agents/workspace.ts:441-495`), so the agent sees
its own identity text each session and could act on it.

The prose actively invites revision. `SOUL.md`'s closing lines
(`docs/reference/templates/SOUL.md:37-43`):

> Each session, you wake up fresh. These files _are_ your memory. Read them. Update
> them. They're how you persist.
>
> If you change this file, tell the user — it's your soul, and they should know.
>
> _This file is yours to evolve. As you learn who you are, update it._

Two qualifications:

1. **The code says "embody", not "update".** The only identity instruction the prompt
   builder emits is `src/agents/system-prompt.ts:618`: *"If SOUL.md is present, embody
   its persona and tone. Avoid stiff, generic replies; follow its guidance unless
   higher-priority instructions override it."* There is no counterpart telling the
   agent to revise it.
2. **The stronger wording is in an opt-in file.** `docs/reference/AGENTS.default.md:55-59`
   ("`SOUL.md` defines identity, tone, and boundaries. Keep it current.") is an
   alternate `AGENTS.md` a user must copy in by hand; no source file references it. The
   template actually seeded, `docs/reference/templates/AGENTS.md:20`, says only "Read
   `SOUL.md` — this is who you are", and its proactive-work and maintenance sections
   (`:195-213`) name `MEMORY.md` exclusively.

And the payoff is limited: an agent that rewrites `IDENTITY.md` changes its own prompt
and the avatar/UI-name fallbacks, but **not** the config fields that drive mention
matching, ack reactions, message prefixes, or outbound impersonation. A self-rename does
not make the agent answer to the new name in a Signal group.

The agent *could* close that gap on its own — the `gateway` tool exposes
`config.patch`/`config.apply` (`src/agents/tools/gateway-tool.ts:34-41`), and bash can
run `openclaw agents set-identity` — but on the Node path nothing tells it to. The
**macOS app is the exception**: it carries its own workspace bootstrap implementation
(`apps/macos/Sources/OpenClaw/AgentWorkspace.swift`), and its fallback `BOOTSTRAP`
template (`:258-272`) explicitly instructs the agent to write `~/.openclaw/openclaw.json`
and "Set identity.name, identity.theme, identity.emoji to match IDENTITY.md" — using a
pre-migration config shape (top-level `identity`, moved to `agents.list[].identity` by
`src/config/legacy.migrations.part-3.ts:198-219` and now rejected as a top-level key by
`src/config/legacy.rules.ts:80-81`).

Note also that the base system prompt carries no identity text of its own —
`src/agents/system-prompt.ts:414` is a fixed "You are a personal assistant running inside
OpenClaw." Everything persona-shaped reaches the model as bootstrap context files, under
a character budget (`bootstrapMaxChars` / `bootstrapTotalMaxChars`).

## A3. Nothing revisits identity on a schedule

The system has a real periodic-consolidation story — it just isn't pointed at identity.

| Candidate mechanism | Touches identity? | Evidence |
| --- | --- | --- |
| Heartbeat prompt | No | `src/auto-reply/heartbeat.ts:5-7` — "Read HEARTBEAT.md… Follow it strictly." The comment above it explicitly discourages open-ended reflection |
| `HEARTBEAT.md` template | No | `docs/reference/templates/HEARTBEAT.md` — five content lines, all about periodic *tasks* |
| Heartbeat-driven memory maintenance | No — targets `MEMORY.md` | `docs/reference/templates/AGENTS.md:202-213` ("like a human reviewing their journal") |
| Pre-compaction memory flush | No | `src/auto-reply/reply/memory-flush.ts:11-22` — hard-coded to `memory/YYYY-MM-DD.md` |
| Compaction / summarisation | No | `src/agents/compaction.ts`, `src/agents/pi-embedded-runner/compact.ts` — no identity references |
| `session-memory` hook | No | `src/hooks/bundled/session-memory/` writes `memory/YYYY-MM-DD-slug.md` |
| Dreaming / nightly distillation | No | See `../openclaw-hermes/deep-openclaw-dreaming.md`; its outputs are `DREAMS.md` and memory files |
| Cron / scheduled jobs | No | `src/cron/` is generic; no identity-related job ships |
| `boot-md` startup hook | No | `docs/reference/templates/BOOT.md` is an empty placeholder |
| Re-running the ritual | No | See below |

Onboarding state is terminal. `ensureAgentWorkspace` tracks `bootstrapSeededAt` and
`onboardingCompletedAt` in a workspace state file (`src/agents/workspace.ts:345-389`);
once `BOOTSTRAP.md` has been seeded and then deleted, `onboardingCompletedAt` is
stamped and `BOOTSTRAP.md` is never written again. The template itself closes with
"Delete this file. You don't need a bootstrap script anymore — you're you now."
(`docs/reference/templates/BOOTSTRAP.md:56-58`). There is no `openclaw agents
re-onboard`.

There is also a historical data point: `CHANGELOG.md:1304` records "Security: remove
bundled soul-evil hook" — the one shipped hook that mutated persona was deleted, as a
security fix.

**Verdict.** Identity in OpenClaw is write-once-by-ritual, edit-later-by-hand. The only
self-evolution is what an agent chooses to do to its own markdown, and that reaches the
prompt but not the runtime config. Memory has a documented consolidation loop; identity
has an aspirational sentence in a template.

## A4. Multi-agent: the ritual reruns, but identity does not carry over

Each agent gets its own workspace directory, and workspace creation is what seeds the
ritual. `openclaw agents add` calls `ensureWorkspaceAndSessions`
(`src/commands/agents.commands.add.ts:135,346` → `src/commands/onboard-helpers.ts:289-302`)
with `ensureBootstrapFiles: true` unless `agents.defaults.skipBootstrap` is set; the
gateway's `agents.create` does the same (`src/gateway/server-methods/agents.ts:420-422`).
A brand-new workspace matches the shipped templates exactly, so the
legacy-detection branch in `ensureAgentWorkspace` writes `BOOTSTRAP.md`
(`src/agents/workspace.ts:362-385`). **Agent N therefore wakes up with its own birth
certificate and runs its own "who am I?" conversation.**

Two wrinkles:

- **`entry.name` is not `entry.identity.name`.** `agents add [name]` and gateway
  `agents.create` set the agent's *administrative* label; neither writes
  `identity.name`. The gateway path compensates by appending `- Name:` (and optional
  `- Emoji:`/`- Avatar:`) to the new `IDENTITY.md`, so the newborn agent sees a name it
  did not choose while `BOOTSTRAP.md` still sits beside it asking it to choose one; the
  CLI path does not, so the new agent's config identity stays empty until someone runs
  `set-identity`. In the UI, `agent.name` is only a display fallback after identity name
  (`ui/src/ui/views/agents-utils.ts:146-178`).
- **The `agents add` wizard never asks about identity.** Its interactive branch
  (`src/commands/agents.commands.add.ts:179-367`) prompts for agent name, workspace,
  auth/model, channels, and bindings only — no emoji, theme, or avatar. Identity is
  deliberately deferred to the agent's own first conversation.
- **`skipBootstrap`** (`agents.defaults.skipBootstrap`) suppresses the whole ritual for
  every subsequently created agent.

Divergence over time is structural rather than managed: workspaces are independent
directories with independent files, no shared identity store, no inheritance from a
"parent" agent, and no mechanism that reconciles or compares them. Subagents are a
separate case — they run with a filtered bootstrap set
(`filterBootstrapFilesForSession` / `MINIMAL_BOOTSTRAP_ALLOWLIST`,
`src/agents/workspace.ts:497-509`, which does include `IDENTITY.md` and `SOUL.md`) and
are named by `agentId`/binding label, not by identity fields.

---

# Part B — What the identity fields actually do

## B1. Emoji and avatar as the UI avatar

Server-side avatar resolution (`src/agents/identity-avatar.ts`) has a narrower chain
than one might expect: config `identity.avatar` → `IDENTITY.md` `- Avatar:` → nothing
(`:27-35`). **No emoji fallback at this layer.** The resolved value is classified as
`remote` (http(s)), `data` (data URI), or `local`, and a local path is validated
against the workspace root, extension allowlist, and `AVATAR_MAX_BYTES` (`:40-93`);
every failure degrades silently to `{kind: "none", reason}`.

The emoji fallback lives one layer up, in two places:

- `src/gateway/assistant-identity.ts:105-130` builds the UI's assistant identity from
  `ui.assistant` → config identity → `IDENTITY.md`, and its **avatar** candidate list
  deliberately includes `identity.emoji` and the file's `emoji`
  (`:111-120`). Final fallback is `{ name: "Assistant", avatar: "A" }` (`:16-20`).
- `ui/src/ui/views/agents-utils.ts:82-103` (`resolveAgentEmoji`) tries live identity
  emoji → config identity emoji → live avatar → config avatar, each gated by
  `isLikelyEmoji` (`:58-80`: ≤16 chars, contains a non-ASCII codepoint, no `/`, `.` or
  `://`). Returns `""` if nothing qualifies, and the list view then falls back to the
  first letter of the agent label (`ui/src/ui/views/agents.ts:142,307`).

So the effective chain a user sees is: **avatar image → emoji → first initial → "A"**.
Local avatar files are inlined as base64 data URIs for the agents list
(`src/gateway/session-utils.ts:80-127`) and served at `/avatar/<agentId>` otherwise
(`src/gateway/control-ui.ts:117-183`).

## B2. Emoji as the acknowledgement reaction

`resolveAckReaction` (`src/agents/identity.ts:13-46`) resolves in four levels: channel
account → channel → `messages.ackReaction` → **the agent's identity emoji** → the
hardcoded `"👀"`. Levels 1–3 test `!== undefined`, so an explicit empty string disables
acks entirely and the emoji is never consulted.

Consumers: Discord (`src/discord/monitor/message-handler.process.ts:119-167`),
Telegram (`src/telegram/bot-message-context.ts:439-537`), Slack
(`src/slack/monitor/message-handler/prepare.ts:387-411`). Each feeds the value in as
`initialEmoji` of a status-reaction controller that also drives the working/done
lifecycle reactions. WhatsApp is the exception — it uses its own
`channels.whatsapp.ackReaction` and never touches identity
(`src/web/auto-reply/monitor/ack-reaction.ts:24-58`). Scope defaults to
`"group-mentions"` (`src/config/types.messages.ts:113-119`).

Two silent-failure modes: Telegram drops the reaction if the emoji is not in the chat's
`available_reactions` (`src/telegram/bot-message-context.ts:502-506`), and Slack's
outbound `iconEmoji` requires the `:shortcode:` form, so a raw Unicode emoji is ignored
(`src/channels/plugins/outbound/slack.ts:13`).

## B3. Name and emoji as mention triggers

`src/auto-reply/reply/mentions.ts` decides whether a group-chat message is addressed to
the agent. Pattern sources, first present wins (`:38-53`):

1. `agents.list[].groupChat.mentionPatterns`
2. `messages.groupChat.mentionPatterns`
3. **derived from `identity.name` and `identity.emoji`**

Because both config levels are tested with `Object.hasOwn`, an explicitly empty array
disables matching rather than falling through to derivation.

Derivation (`:8-21`):

```ts
const parts = name.split(/\s+/).filter(Boolean).map(escapeRegExp);
const re = parts.length ? parts.join(String.raw`\s+`) : escapeRegExp(name);
patterns.push(String.raw`\b@?${re}\b`);
...
if (emoji) patterns.push(escapeRegExp(emoji));
```

The name becomes `\b@?Name\b` (case-insensitive, whitespace-flexible, optional `@`);
**the emoji becomes a standalone unanchored token** — typing the agent's emoji anywhere
in a group message is a mention. There are no aliases and no nickname list. Text is
normalised by stripping zero-width/bidi characters and lowercasing (`:68-70`).

The same patterns are reused by `stripMentions` (`:128-160`) to scrub the agent's own
name/emoji out of a message body before slash-command and directive parsing — so the
identity name silently participates in command parsing too (callers include
`commands-context.ts`, `bash-command.ts`, `directive-handling.parse.ts`, `session.ts`,
`abort.ts`).

**This is the sharpest load-bearing edge.** Channels with native mentions treat the
derived regexes as a supplement: `canDetectMention = Boolean(botId) || mentionRegexes.length > 0`
(Discord `message-handler.preflight.ts:622`, Telegram `bot-message-context.ts:405`,
Slack `prepare.ts:308`). Channels *without* native mentions have no other source:

- iMessage — `const canDetectMention = mentionRegexes.length > 0;` (`src/imessage/monitor/inbound-processing.ts:263`, match at `:254`)
- Signal — same (`src/signal/monitor/event-handler.ts:590-600`)

An agent with no `identity.name` and no `identity.emoji` in **config** is unaddressable
in iMessage and Signal groups, and in `group-mentions` scope also stops acking. Since
the bootstrap ritual writes only `IDENTITY.md`, this is precisely the state a freshly
onboarded agent is in until someone runs `set-identity`.

Also note `\b@?${re}\b`: a name ending in a non-word character (an emoji, `+`, `)`)
never matches, because the trailing `\b` cannot fire.

## B4. Name as message prefix and outbound persona

- `resolveIdentityNamePrefix` returns `` `[${name}]` `` (`src/agents/identity.ts:48-57`);
  `resolveMessagePrefix` falls back to the literal `"[openclaw]"` when unset (`:79`).
- `responsePrefix: "auto"` at account/channel/global level resolves to the identity name
  (`:94-133`). A `{identity.name}` / `{identityName}` template variable is supported
  (`src/config/types.messages.ts:99`, resolver `src/auto-reply/reply/response-prefix-template.ts:59-61`);
  unresolved variables are left as literal text, so a missing name leaks
  `{identity.name}` into an outgoing message.
- Heartbeat replies get the same prefix (`src/infra/heartbeat-runner.ts:662`).
- Outbound impersonation: `resolveAgentOutboundIdentity`
  (`src/infra/outbound/identity.ts:26-37`) bundles name + emoji + **remote-only** avatar
  URL. Slack bot-token sends set `username`/`iconUrl`/`iconEmoji`
  (`src/channels/plugins/outbound/slack.ts:6-18`); Discord webhooks set `username`,
  falling back to the binding label, truncated to 80 chars
  (`src/channels/plugins/outbound/discord.ts:28-37`); Discord thread personas prefix
  `🤖` (`src/discord/monitor/reply-delivery.ts:53-72`). Cron/isolated-agent deliveries
  carry the same identity (`src/cron/isolated-agent/delivery-dispatch.ts:153`).

Local-file and data-URI avatars are dropped for outbound (only `kind === "remote"`
survives), so a bootstrap-chosen local avatar shows in the Control UI but not in Slack.

## B5. Prompt, voice, and everything else

- **Prompt persona.** `IDENTITY.md` and `SOUL.md` are bootstrap context files injected
  into every run (`src/agents/workspace.ts:441-495`), also mounted into the sandbox
  (`src/agents/sandbox/workspace.ts`). This is where `Creature` and `Vibe` do their
  only work — they exist purely as prompt text.
- **Voice.** The voice-call extension builds its persona from the identity name only:
  `` `You are ${agentName}, a helpful voice assistant on a phone call.` `` with
  `agentName = identity?.name?.trim() || "assistant"`
  (`extensions/voice-call/src/response-generator.ts:100-106`). No emoji or avatar binding
  to TTS voice selection anywhere.
- **CLI.** `agents list` prints `emoji name` plus a source label of `IDENTITY.md` or
  `config` (`src/commands/agents.commands.list.ts:30-45`). Note that
  `src/commands/agents.config.ts:104-105` prefers the **file** over config
  (`identity?.name ?? configIdentity?.name`) — the inverse of the avatar resolver and of
  the gateway — so the CLI can report a name the mention matcher does not know about.
- **Plugin surface.** `resolveAgentIdentity` is re-exported to extensions
  (`src/extensionAPI.ts:4`), as are `resolveAckReaction` (`src/plugin-sdk/index.ts:252`)
  and the mention helpers (`src/plugins/runtime/index.ts:337-339`). Channel extensions
  (IRC, Matrix, Mattermost, Nextcloud Talk, BlueBubbles) all consume the mention regexes.
- **No consumers found** for: desktop/push notifications, session or thread titles, log
  lines, or subagent naming. Those use `agentId` and binding labels.

## B6. Which fields are load-bearing, and where

| Field | Load-bearing consumers | Behaviour when unset in config |
| --- | --- | --- |
| `identity.name` | Mention regex (all group channels; the *only* source on iMessage/Signal), `stripMentions` before command parsing, message prefix, `responsePrefix: "auto"`, Slack `username`, Discord webhook name, voice-call persona, UI/CLI display | Prefix degrades to `"[openclaw]"`; `"auto"` prefix vanishes; `{identity.name}` leaks literally; group mentions fail entirely where there is no native mention API |
| `identity.emoji` | Ack/status reaction on Discord, Telegram, Slack; a standalone mention token; UI avatar fallback; Slack `iconEmoji` (shortcode form only) | Ack falls back to `"👀"`; one fewer mention trigger; UI falls back to an initial |
| `identity.avatar` | Control UI avatar endpoint and agents list (base64 inline), Slack `iconUrl`, Discord webhook avatar (remote URLs only) | `/avatar/<id>` 404s; UI falls back to emoji then initial; outbound avatar omitted |
| `identity.theme` | Surfaced through the gateway agents list and CLI output; no behavioural use found | Cosmetic |
| `Creature`, `Vibe` (file-only) | Prompt text; collapsed into `theme` if imported via `set-identity` | Cosmetic |

The onboarding conversation presents all of these as self-expression ("your signature —
pick one that feels right"). Operationally, `name` and `emoji` are the agent's
addressing scheme on every group channel and its acknowledgement signal on three of
them; `avatar` is its face in two UIs and two chat platforms. Setting them early matters
because they are the handles the routing and reaction layers use — but only after they
have been copied from the file the ritual writes into the config those layers read.

---

## Open observations

- **The bootstrap paradox is real but differently shaped than the critique assumes.**
  The problem is not only that identity is fixed at t0; it is that the ritual's output
  lands in a store (`IDENTITY.md`) that the functional layers do not read. The gap
  between "the agent named itself" and "the agent answers to that name" is one manual
  CLI invocation that nothing in the ritual mentions.
- **Three different precedence orders exist for the same two stores.** Avatar resolution
  prefers config over file; the gateway assistant identity prefers `ui.assistant` →
  config → file; the CLI prefers file over config; the mention matcher ignores the file.
  Any of these can disagree with the others on the same workspace.
- **Memory has the loop identity lacks.** Daily notes → curated `MEMORY.md`, prompted
  during heartbeats and pre-compaction, plus the dreaming pass. The architectural slot
  for a periodic identity revisit exists and is occupied for memory; identity's version
  of it is one sentence of template prose.
- **The macOS app knows about the gap; the Node path does not.** The Swift bootstrap
  template tells the agent to mirror `IDENTITY.md` into the config file (against a config
  shape that no longer exists); the shipped Node `BOOTSTRAP.md` says nothing about
  config. Two implementations of the same ritual have drifted apart on exactly the point
  that determines whether identity is functional.
- **Self-editing is invited without being instrumented.** `SOUL.md` says "this file is
  yours to evolve"; the system prompt says "embody"; the seeded `AGENTS.md` says "read".
  Only the opt-in `AGENTS.default.md` says "keep it current". Whether an agent ever
  edits its soul is left to whether it happens to notice the invitation.
- **Per-agent rituals reset the same trap N times.** Each new agent re-runs bootstrap in
  a fresh workspace, so each new agent also ends up with a name in a file and an empty
  identity in config — except via the gateway path, which pre-seeds a name the agent did
  not choose.
- **Failure modes are uniformly silent.** An over-size or out-of-workspace avatar, a
  Slack raw-Unicode `iconEmoji`, a Telegram reaction the chat disallows, a name ending in
  an emoji breaking the trailing `\b` — all degrade without surfacing a reason to the
  user.
