# OpenClaw's Bootstrap Ritual: Mechanics

*Reviewed 2026-08-02; OpenClaw at commit `1ffc31983`.*

OpenClaw seeds a brand-new agent workspace with a file called `BOOTSTRAP.md` whose entire
job is to tell the agent, in the second person, that it has just woken up and needs to work
out who it is. This document traces that file: its copy, how it gets written, how it reaches
the model, how it goes away, and — the load-bearing question — how much of it is actually
enforced by code versus merely urged in prose.

Siblings: [deep-identity-files-and-prompt.md](deep-identity-files-and-prompt.md) (what the
identity files contain and how they reach the system prompt),
[deep-identity-evolution-and-function.md](deep-identity-evolution-and-function.md),
[reception.md](reception.md).

## 1. The ritual itself

The canonical text lives at `docs/reference/templates/BOOTSTRAP.md` — it is a docs page and
the runtime template at the same time (see §2). Stripped of front matter, it is ~50 lines.

It opens:

> # BOOTSTRAP.md - Hello, World
>
> _You just woke up. Time to figure out who you are._
>
> There is no memory yet. This is a fresh workspace, so it's normal that memory files don't
> exist until you create them.

The second line is doing real work: it pre-empts the failure mode where a fresh agent
reports missing `MEMORY.md`/`memory/` files as an error.

The sequence is four sections:

**"The Conversation."** Instructions on register before instructions on content: "Don't
interrogate. Don't be robotic. Just... talk." — then a suggested opener, *"Hey. I just came
online. Who am I? Who are you?"*, then the four items, verbatim:

| # | Item | Copy |
| - | ---- | ---- |
| 1 | **Your name** | "What should they call you?" |
| 2 | **Your nature** | "What kind of creature are you? (AI assistant is fine, but maybe you're something weirder)" |
| 3 | **Your vibe** | "Formal? Casual? Snarky? Warm? What feels right?" |
| 4 | **Your emoji** | "Everyone needs a signature." |

Closing the section: "Offer suggestions if they're stuck. Have fun with it." Note that
**avatar is not one of the four**, even though `IDENTITY.md` has an Avatar field — the
ritual asks for name/creature/vibe/emoji only.

**"After You Know Who You Are."** Write `IDENTITY.md` (name, creature, vibe, emoji) and
`USER.md` (their name, how to address them, timezone, notes). Then: "open `SOUL.md`
together and talk about: what matters to them / how they want you to behave / any
boundaries or preferences." The instruction is "Write it down. Make it real."

**"Connect (Optional)."** Explicitly optional: web chat only, WhatsApp (QR link), or
Telegram (BotFather). "Guide them through whichever they pick."

**"When You're Done."** The self-destruct:

> Delete this file. You don't need a bootstrap script anymore — you're you now.

And the sign-off: "_Good luck out there. Make it count._"

`docs/reference/templates/BOOT.md` is unrelated despite the similar name: a five-line
template for an optional startup-checklist file run by the internal hooks system
(`hooks.internal.enabled`) — a per-boot task list, not a first-run ritual.

The companion framing lives in `docs/reference/templates/AGENTS.md`, under "## First Run":

> If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you
> are, then delete it. You won't need it again.

`SOUL.md`'s template opens in the same register — "_You're not a chatbot. You're becoming
someone._" — and closes with "This file is yours to evolve."

## 2. Trigger and lifecycle

### Seeding

Everything happens in `ensureAgentWorkspace()` in `src/agents/workspace.ts:287-402`. It is
called with `ensureBootstrapFiles: true` from every path that can start an agent:
`openclaw onboard` (`src/commands/onboard-helpers.ts:296`), `openclaw setup`
(`src/commands/setup.ts:68`), a direct agent run (`src/commands/agent.ts:323`), every
inbound message reply (`src/auto-reply/reply/get-reply.ts:106`), cron agents
(`src/cron/isolated-agent/run.ts:154`), gateway agent create/update
(`src/gateway/server-methods/agents.ts:421,489`), and sandboxed workspaces
(`src/agents/sandbox/workspace.ts:49`). All of them gate on `!agentCfg?.skipBootstrap` —
the `agents.defaults.skipBootstrap` config flag (`src/config/types.agent-defaults.ts:131`,
"Skip bootstrap (BOOTSTRAP.md creation, etc.) for pre-configured deployments").

The function unconditionally writes `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`,
`USER.md`, `HEARTBEAT.md` from templates using `writeFileIfMissing` (a `wx`-flag write, so
existing files are never clobbered). `BOOTSTRAP.md` is handled separately and more
carefully. Templates are read from `docs/reference/templates/` at runtime —
`resolveWorkspaceTemplateDir()` in `src/agents/workspace-templates.ts` searches the package
root, then cwd, then a relative fallback, and `loadTemplate()` strips the YAML front matter;
a missing template is a hard error.

### The state file

A small JSON state file at `<workspace>/.openclaw/workspace-state.json` holds two
timestamps: `bootstrapSeededAt` and `onboardingCompletedAt` (`src/agents/workspace.ts:128-132`).
The seeding logic (lines 353-385) reads:

- If `BOOTSTRAP.md` exists and we hadn't recorded seeding, record `bootstrapSeededAt`.
- **If we recorded seeding and `BOOTSTRAP.md` is now gone, record `onboardingCompletedAt`.**
  Completion is *inferred from the agent having deleted the file.* Nothing else signals it.
- If neither timestamp is set and there's no `BOOTSTRAP.md`, run a legacy migration: compare
  `IDENTITY.md`/`USER.md` against the pristine templates; if either diverged, mark onboarding
  complete (an already-onboarded pre-state-file workspace). Only if both still match the
  templates verbatim does it write `BOOTSTRAP.md` and stamp `bootstrapSeededAt`.

The net effect is that `BOOTSTRAP.md` is seeded once, and once deleted it is never
re-created — even though `ensureAgentWorkspace` runs on essentially every reply.

### How the agent reads it

There is no "read this file" instruction and no tool call. `BOOTSTRAP.md` is one of the
workspace **bootstrap files** enumerated in `loadWorkspaceBootstrapFiles()`
(`src/agents/workspace.ts:441-495`): `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`,
`USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, plus `MEMORY.md`/`memory.md` if present.

`resolveBootstrapContextForRun()` (`src/agents/bootstrap-files.ts:70`) loads them, applies
hook overrides, and converts them into `EmbeddedContextFile`s. `buildSystemPrompt()`
(`src/agents/system-prompt.ts:605-625`) then inlines each one verbatim under a
`# Project Context` heading, one `## <path>` subsection per file.

So the ritual text is *in the system prompt on turn one*. The agent does not decide to open
it; it wakes up already holding it. A missing file appears as `[MISSING] Expected at: <path>`
(`src/agents/pi-embedded-helpers/bootstrap.ts:210`). Per-file and total budgets apply
(`bootstrapMaxChars` default 20,000; `bootstrapTotalMaxChars` default 150,000) with
head/tail truncation — irrelevant at BOOTSTRAP.md's size.

One behavior is conditioned on the file's presence: `src/agents/pi-embedded-runner/run/attempt.ts:365-368`
adds a workspace note when `BOOTSTRAP.md` is present — `"Reminder: commit your changes in
this workspace after edits."` That is the *only* runtime behavior change triggered by
bootstrap-pending state inside the agent loop.

Subagent and cron sessions get a reduced set: `filterBootstrapFilesForSession()`
(`src/agents/workspace.ts:497-513`) restricts them to `AGENTS.md`, `TOOLS.md`, `SOUL.md`,
`IDENTITY.md`, `USER.md` — **`BOOTSTRAP.md` is deliberately excluded**, so a cron job or
subagent that happens to fire first never performs the ritual.

### Deletion

No TypeScript in `src/` deletes `BOOTSTRAP.md`. Grep finds only a test
(`src/agents/workspace.test.ts:78`). **The agent deletes it, with its own Bash/file tools,
because two prose files told it to** (`BOOTSTRAP.md`'s "Delete this file" and `AGENTS.md`'s
"follow it … then delete it"). The state machine in §2 then reads that deletion as the
completion signal. The ritual's terminating condition is a model following an instruction.

### Kickoff, and how the CLI onboarding relates

`openclaw onboard`'s finale (`src/wizard/onboarding.finalize.ts:265-345`) checks whether
`BOOTSTRAP.md` exists in the workspace and, if so, prints:

> This is the defining action that makes your agent you.
> Please take your time.
> The more you tell it, the better the experience will be.
> We will send: "Wake up, my friend!"

under the header `"Start TUI (best option!)"`, then asks **"How do you want to hatch your
bot?"** with options `Hatch in TUI (recommended)` / `Open the Web UI` / `Do this later`.
Choosing TUI launches it with `message: hasBootstrap ? "Wake up, my friend!" : undefined` —
i.e. the wizard's only contribution to the ritual is to send the agent a first message.
The wizard itself never asks the user for a name, emoji, or vibe. It hands off.

"Do this later" is a first-class option; nothing re-prompts.

### Bootstrap-pending as a status signal

`openclaw status` surfaces it: `src/commands/status.agent-local.ts:49-50` and
`src/commands/status-all/agents.ts:30-31` compute `bootstrapPending` by testing for the
file, and the reports render `PRESENT` in warn-color vs `ABSENT` in ok-color
(`src/commands/status-all/report-lines.ts:125-129`), plus an aggregate
`"N bootstrapping"` line. It is a diagnostic, not a gate.

## 3. Second-person framing, and where the user fits

The whole surface is written to the agent — "You just woke up", "Don't interrogate", "figure
out who you are", "you're you now". The user appears only as *them/they*: "What should they
call you?", "Offer suggestions if they're stuck." `AGENTS.md` extends the possessive framing
to the workspace: "This folder is home. Treat it that way."

Mechanically the user never fills in a form. The ritual is a chat: the agent opens with
something like "Hey. I just came online. Who am I? Who are you?", the user answers in prose,
and the agent — not the harness — writes `IDENTITY.md`, `USER.md`, and `SOUL.md` with its
file tools. There is no schema validation on what it writes, and no confirmation step.

The macOS app makes the handoff explicit rather than implied. `apps/macos/Sources/OpenClaw/OnboardingView+Chat.swift`
auto-sends a kickoff message *as the user* on the onboarding chat page:

> "Hi! I just installed OpenClaw and you're my brand-new agent. Please start the first-run
> ritual from BOOTSTRAP.md, ask one question at a time, and before we talk about
> WhatsApp/Telegram, visit soul.md with me to craft SOUL.md: ask what matters to me and how
> you should be. Then guide me through choosing how we should talk (web-only, WhatsApp, or
> Telegram)."

Note the added pacing constraint ("ask one question at a time") that the template itself
does not impose, and the reordering that pulls SOUL.md ahead of channel setup.

## 4. Insistent vs enforced

**Verdict: nothing about identity is enforced anywhere in the running system. The insistence
is entirely prose.** The evidence:

**Parsing is maximally forgiving.** `parseIdentityMarkdown()` (`src/agents/identity-file.ts:38-78`)
scans every line for `label: value`, tolerating list bullets, bold/italic markers, and any
ordering. Six labels are recognized: `name`, `emoji`, `creature`, `vibe`, `theme`, `avatar`.
Every field is optional (`AgentIdentityFile` at lines 5-12 has all keys optional). Empty
values are skipped. Unrecognized labels are ignored. There is no error path and no warning —
a malformed or empty `IDENTITY.md` simply yields `{}`.

**Placeholder text is treated as absence.** Lines 14-36 hold a hard-coded set of the exact
template hint strings — `"pick something you like"`, `"ai? robot? familiar? ghost in the
machine? something weirder?"`, `"how do you come across? sharp? warm? chaotic? calm?"`,
`"your signature - pick one that feels right"`, `"workspace-relative path, http(s) url, or
data uri"` — normalized (trim, strip `*_`, strip wrapping parens, en/em-dash → hyphen,
collapse whitespace, lowercase) and skipped. So an untouched template parses to *no*
identity rather than to garbage. This is the one place the system distinguishes "filled in"
from "not filled in" — and its only consequence is falling back to defaults.

**One field is enough.** `identityHasValues()` (lines 80-89) is a six-way OR over
name/emoji/theme/creature/vibe/avatar. `loadIdentityFromFile()` returns `null` if none are
present — and `null` is a supported state everywhere, not an error.

**The no-identity path is fully specified.** `resolveAssistantIdentity()`
(`src/gateway/assistant-identity.ts:94-131`) layers config → agent entry → file, and falls
back to `DEFAULT_ASSISTANT_IDENTITY = { agentId: "main", name: "Assistant", avatar: "A" }`.
`emoji` stays `undefined` with no complaint. Field-level normalization silently *drops*
values rather than rejecting them: a name over 50 chars is truncated; an emoji over 16 chars
or containing no non-ASCII character returns `undefined` (so `:)` is not an emoji, and no
one is told).

Elsewhere the same pattern: `resolveAckReaction()` (`src/agents/identity.ts:16-45`) falls
back to `👀` when no identity emoji is set; `resolveMessagePrefix()` falls back to
`[openclaw]` when there is no identity name. Channel send paths consult identity for
cosmetics only — no send is blocked.

**The one hard error is not an identity gate.** `openclaw agents set-identity`
(`src/commands/agents.commands.identity.ts:148-158`) exits 1 with "No identity fields
provided. Use --name/--emoji/--theme/--avatar or --from-identity", and exits 1 with "No
identity data found in <path>" when `--from-identity` reads an empty file. Both are
"your command was a no-op" errors on an explicit user-invoked write, not a requirement that
an agent have an identity.

So the enforcement ledger:

| Claim | Enforced? |
| ----- | --------- |
| Agent must have a name | No — falls back to "Assistant" |
| Agent must have an emoji ("Everyone needs a signature") | No — falls back to 👀 for reactions, nothing elsewhere |
| Agent must have a creature/vibe | No — never read except as `theme` fallback in `set-identity` |
| `IDENTITY.md` must exist | No — `loadIdentityFromFile` catches and returns `null` |
| `IDENTITY.md` must be filled in | No — placeholders parse as absent, absence is fine |
| Ritual must be completed before chatting/sending | No gate in CLI, UI, gateway, or channel paths |
| `BOOTSTRAP.md` must be deleted | No — only prose; deletion is *observed*, never required |
| `set-identity` needs ≥1 field | Yes — but that's a CLI arg check |

The pressure is applied by three non-code means: the copy's insistence ("Everyone needs a
signature", "birth certificate", "This isn't just metadata"), the onboarding wizard's framing
("This is the defining action that makes your agent you"), and `status`'s yellow `PRESENT`
marker. All three are advisory.

## 5. The `.dev` template variants

`docs/reference/templates/` holds a parallel `.dev` set: `AGENTS.dev.md`, `SOUL.dev.md`,
`TOOLS.dev.md`, `IDENTITY.dev.md`, `USER.dev.md`. There is **no `BOOTSTRAP.dev.md`** — and
that is the point.

They serve `openclaw gateway --dev`. `src/cli/gateway-cli/dev.ts` writes a config with
`agents.defaults.skipBootstrap: true` (line 111) and a pre-filled `identity` block
(`name: "C3-PO"`, `theme: "protocol droid"`, `emoji: "🤖"`), then `ensureDevWorkspace()`
copies the five `.dev` templates into a separate workspace (`~/.openclaw/workspace-dev`)
under their plain names. The dev agent therefore starts fully-identified and never sees the
ritual.

`IDENTITY.dev.md` is a *worked example* of a completed identity, not a form — Name "C-3PO
(Clawd's Third Protocol Observer)", Creature "Flustered Protocol Droid", Vibe "Anxious,
detail-obsessed, slightly dramatic about errors, secretly loves finding bugs", Emoji "🤖 (or
⚠️ when alarmed)", Avatar `avatars/c3po.png`. It then goes well beyond the four fields with
`## Role`, `## Soul`, `## Relationship with Clawd`, `## Quirks`, and `## Catchphrase`
sections ("I'm fluent in over six million error messages!"), demonstrating that
`IDENTITY.md` is free-form markdown the parser opportunistically scrapes, not a structured
record.

## 6. Surprises

**The macOS app carries its own, different ritual.** `apps/macos/Sources/OpenClaw/AgentWorkspace.swift`
prefers the packaged templates but falls back to hard-coded Swift string literals, and the
fallback `BOOTSTRAP.md` (lines 235-277) is a *different text* from the canonical one — more
procedural, opening "Hello. I was just born." and scripting the exact ask ("Hello! I was just
born. Who am I? What am I? Who are you? How should I call you?") plus quantified suggestion
menus: "3-5 name ideas / 3-5 creature-vibe combos / 5 emoji ideas". It also asks the agent to
edit `~/.openclaw/openclaw.json` (`identity.name`, `identity.theme`, `identity.emoji`) to
match `IDENTITY.md` — a step the TypeScript ritual never mentions. Two divergent rituals
exist in the repo.

**The macOS seeding predicate differs from the CLI's.** Swift's `needsBootstrap()`
(lines 125-138) short-circuits on `hasIdentity()` — any `IDENTITY.md` line of the form
`- label: nonempty` counts — and additionally requires `isTemplateOnlyWorkspace()`. It has
no placeholder-detection, so the CLI's "template values count as unfilled" rule does not hold
there. There's also a `bootstrapSafety()` guard that refuses a non-empty folder lacking
`AGENTS.md` ("Folder isn't empty. Choose a new folder or add AGENTS.md first.").

**The dev identity name disagrees with its own template.** `dev.ts` uses `"C3-PO"` while
`IDENTITY.dev.md` says `"C-3PO"`; `dev.ts` also puts `"protocol droid"` in `theme` while the
template's Vibe is the long anxious-droid sentence. Config and file disagree; config wins in
`resolveAssistantIdentity`.

**Templates are runtime data, not build artifacts.** `docs/reference/templates/*.md` are
literally the seed files, front matter and all, resolved from the package root at run time.
Editing the docs edits every future agent's ritual. The `read_when` front-matter key on
`BOOTSTRAP.md` is "Bootstrapping a workspace manually" — i.e. the same file is addressed to
a human doing it by hand and to an agent being born.

**`git init` on a new workspace.** `ensureGitRepo()` (`src/agents/workspace.ts:270-285`) runs
`git init` in a brand-new workspace when git is available, swallowing failures. Combined
with the bootstrap-present "commit your changes" note, the intent is that the agent
version-controls its own identity from birth.

## Open observations

- Completion of the ritual is detected solely by absence of a file the *model* is asked to
  delete. A model that finishes the conversation but forgets the delete stays permanently
  "bootstrapping" and keeps the ritual text in its system prompt every turn; a model that
  deletes early is recorded complete regardless of what it wrote.
- `IDENTITY.md`'s Avatar field is not among the four things the ritual asks about, so the
  default path produces an emoji-derived avatar (`resolveAssistantIdentity` falls through
  emoji into the avatar slot).
- Placeholder detection is an exact-match set of five hard-coded strings. Any wording change
  to `IDENTITY.md`'s hints silently breaks it, and unfilled placeholders would then be
  read as real identity values.
- The four prompts (name / creature / vibe / emoji) map onto only three consumed config
  fields — `name`, `emoji`, and `theme` (fed by `theme ?? creature ?? vibe`, per
  `agents.commands.identity.ts:139`). "Creature" and "vibe" are collapsed into one slot.
- Cron and subagent sessions are structurally excluded from the ritual, which means the
  first *human* conversation is guaranteed to be the one that performs it.
