# OpenClaw: identity files, their schema, and how personality reaches the model

*Reviewed 2026-08-02; OpenClaw at commit `1ffc31983`.*

Mechanism-level walkthrough of the pipeline from workspace markdown files to the
assembled system prompt. Siblings: `deep-bootstrap-ritual.md` (how the files get
filled in during first contact), `deep-identity-evolution-and-function.md` (how
they change over a workspace's life), `reception.md`. A higher-altitude view of
persona injection is in [../openclaw-hermes/compare-ux-prompt.md](../openclaw-hermes/compare-ux-prompt.md);
this doc goes a level below it.

## 1. The file set

A workspace (default `~/.openclaw/workspace`, or `workspace-<profile>`) is seeded
with six templates plus a conditional seventh. Filenames are constants in
`src/agents/workspace.ts:23-31`; seeding is `ensureAgentWorkspace()`
(`src/agents/workspace.ts:287-402`), which writes each template with `flag: "wx"`
so an existing file is never overwritten.

| File | Constant | Conceptually holds | Machine-parsed? |
|---|---|---|---|
| `AGENTS.md` | `DEFAULT_AGENTS_FILENAME` | Workspace operating manual: read order, memory discipline, safety defaults | No |
| `SOUL.md` | `DEFAULT_SOUL_FILENAME` | Persona/behavioral character — "who you are" in the first person | No |
| `TOOLS.md` | `DEFAULT_TOOLS_FILENAME` | User's local tool notes | No |
| `IDENTITY.md` | `DEFAULT_IDENTITY_FILENAME` | External presentation record: name, creature, vibe, emoji, avatar | **Yes** |
| `USER.md` | `DEFAULT_USER_FILENAME` | Profile of the human: name, address, pronouns, timezone, notes | No |
| `HEARTBEAT.md` | `DEFAULT_HEARTBEAT_FILENAME` | Heartbeat-poll guidance | No |
| `BOOTSTRAP.md` | `DEFAULT_BOOTSTRAP_FILENAME` | The one-time onboarding ritual; agent deletes it when done | No |
| `MEMORY.md` / `memory.md` | `DEFAULT_MEMORY_*` | Curated long-term memory (loaded only if present) | No |

`IDENTITY.md` is the only file the runtime reads as *structured data*. Everything
else is inert prose that gets pasted into the prompt verbatim.

The distinction between SOUL and IDENTITY is legible in the templates. `SOUL.md`
(`docs/reference/templates/SOUL.md`) is second-person coaching about behavior —
"Be genuinely helpful, not performatively helpful", "Have opinions", "Remember
you're a guest" — with sections `Core Truths` / `Boundaries` / `Vibe` /
`Continuity`, and closes with `_This file is yours to evolve. As you learn who
you are, update it._`. `IDENTITY.md` (`docs/reference/templates/IDENTITY.md`) is
a five-field record, each field blank with a parenthesised hint on the following
line:

```
# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:**
  _(pick something you like)_
- **Creature:**
  _(AI? robot? familiar? ghost in the machine? something weirder?)_
- **Vibe:**
  _(how do you come across? sharp? warm? chaotic? calm?)_
- **Emoji:**
  _(your signature — pick one that feels right)_
- **Avatar:**
  _(workspace-relative path, http(s) URL, or data URI)_
```

`USER.md` is the same shape aimed outward (`Name` / `What to call them` /
`Pronouns` / `Timezone` / `Notes` + a free `## Context` section), and ends with a
norm rather than a schema: "you're learning about a person, not building a
dossier."

### `.dev.md` variants

`AGENTS.dev.md`, `SOUL.dev.md`, `TOOLS.dev.md`, `IDENTITY.dev.md`, `USER.dev.md`
are a **pre-filled alternate persona** used by `openclaw gateway --dev`. They are
not a schema variant — same format, different content. `ensureDevWorkspace()`
(`src/cli/gateway-cli/dev.ts:56-89`) loads each `*.dev.md` template and writes it
to the *undecorated* filename in the dev workspace, so a dev workspace boots as
C-3PO ("Clawd's Third Protocol Observer", flustered protocol droid, 🤖, avatar
`avatars/c3po.png`) with a fully written SOUL instead of the blank
fill-me-in templates. Each `loadDevTemplate` call carries an inline fallback
string in case the packaged template is missing. The dev SOUL also demonstrates
the intended end state of a bootstrapped workspace: first-person, quirk-laden,
several hundred lines of voice.

Templates ship under `docs/reference/templates/` and are read at runtime via
`resolveWorkspaceTemplateDir()`; `loadTemplate()` strips the YAML frontmatter
(`stripFrontMatter`, `src/agents/workspace.ts:68-80`) before writing, so the
`summary:`/`read_when:` docs metadata does not land in the workspace.

## 2. Parse rules and schema

`src/agents/identity-file.ts` is the whole parser — 107 lines, no YAML, no
frontmatter, no heading awareness.

`parseIdentityMarkdown(content)` (line 38) splits on newlines and for **every**
line: trims, strips a leading `- ` bullet, finds the first `:`, takes the left
side as a label (with `*` and `_` removed, lowercased) and the right side as the
value (with leading/trailing `*`/`_` stripped). Recognised labels are `name`,
`emoji`, `creature`, `vibe`, `theme`, `avatar` — anything else is silently
dropped. There is no `break`, so on repeated labels **the last occurrence in the
file wins**. Headings, code fences, and prose are not excluded; any line anywhere
in the file that reads `Name: X` sets the name.

Placeholder rejection is a hardcoded string set (`IDENTITY_PLACEHOLDER_VALUES`,
lines 14-20) matched after `normalizeIdentityValue()` strips wrapping `*`/`_`,
strips a wrapping `(...)`, folds en/em dashes to `-`, collapses whitespace, and
lowercases. That is why the template's em-dash "your signature — pick one that
feels right" is recognised. The five entries correspond exactly to the five
template hints; edit a hint in the template without editing the set and the
placeholder starts being parsed as a real value.

Validation beyond that is essentially nil: no length cap, no emoji check, no
character-class check. `identityHasValues()` (line 79) is the only gate — if none
of the six fields is set, `loadIdentityFromFile()` returns `null` rather than an
empty object. Malformed content never throws: the `try/catch` around
`readFileSync` returns `null` for missing/unreadable files, and a file of pure
prose simply yields `{}` → `null`.

The struct is wider than the config schema. `AgentIdentityFile` has
`name | emoji | theme | creature | vibe | avatar`; `IdentitySchema`
(`src/config/zod-schema.core.ts:107-115`, `.strict()`) has only
`name | theme | emoji | avatar`. The bridge is in
`src/commands/agents.commands.identity.ts:142-143`:

```ts
const fileTheme =
  identityFromFile?.theme ?? identityFromFile?.creature ?? identityFromFile?.vibe ?? undefined;
```

so `Creature` and `Vibe` collapse into config's single `theme` when
`openclaw agents set-identity --from-identity` promotes the file into config.
Nothing else reads `creature`/`vibe` at all.

Writes back into the file are equally thin. `agents.create` over the gateway
(`src/gateway/server-methods/agents.ts:426-437`) **appends** `- Name: …` (plus
optional `- Emoji:`/`- Avatar:`) to `IDENTITY.md` after collapsing whitespace via
`sanitizeIdentityLine()` (`\s+` → single space). Because the parser is
last-occurrence-wins and the writer appends, repeated `agents.create`-style
writes accumulate stanzas whose last one is authoritative.

### Avatar resolution

`src/agents/identity-avatar.ts` resolves `avatar` to one of
`{none, local, remote, data}`. Source precedence: **config first**
(`resolveAgentIdentity(cfg, agentId)?.avatar`), then the workspace `IDENTITY.md`
(lines 26-35). Classification is by prefix — `http(s)://` → `remote`, `data:` →
`data`, else treated as a path. Local paths are resolved against the workspace
root, `realpath`'d, then checked against four gates (lines 46-74):

| Check | Failure reason |
|---|---|
| `isPathWithinRoot(workspaceRoot, realPath)` after symlink resolution | `outside_workspace` |
| Extension in `.png/.jpg/.jpeg/.gif/.webp/.svg` | `unsupported_extension` |
| Exists and `isFile()` | `missing` |
| `size <= AVATAR_MAX_BYTES` (2 MiB, `src/shared/avatar-policy.ts:3`) | `too_large` |

`~`-prefixed and absolute paths are permitted syntactically but still must land
inside the workspace after realpath, so they fail closed. Consumers:
`src/infra/outbound/identity.ts` (channel display identity — note it only
forwards `remote` avatars as `avatarUrl`), `src/discord/monitor/reply-delivery.ts`
(webhook avatars), and `src/gateway/server-http.ts:568`.

## 3. Budgets, truncation, and what is *not* scanned

All caps live in `src/agents/pi-embedded-helpers/bootstrap.ts`.

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_BOOTSTRAP_MAX_CHARS` | 20 000 | per-file cap; override `agents.defaults.bootstrapMaxChars` |
| `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS` | 150 000 | across all bootstrap files; override `agents.defaults.bootstrapTotalMaxChars` |
| `MIN_BOOTSTRAP_FILE_BUDGET_CHARS` | 64 | below this remaining budget, stop adding files |
| `BOOTSTRAP_HEAD_RATIO` / `BOOTSTRAP_TAIL_RATIO` | 0.7 / 0.2 | head/tail kept on truncation |

Truncation is head+tail, not a plain cut (`trimBootstrapContent`, lines 114-147):
70 % of the budget from the front, 20 % from the end, and between them a marker

```
[...truncated, read SOUL.md for full content...]
…(truncated SOUL.md: kept 14000+4000 chars of 52000)…
```

which both tells the model the file was cut and names the file to re-read. 10 %
of the budget is deliberately left unspent. `buildBootstrapContextFiles()`
(lines 187-246) walks files in fixed order, decrements a running
`remainingTotalChars`, warns on each truncation, and stops entirely once the
budget is spent — so ordering determines who gets starved: `AGENTS.md`,
`SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`,
then memory files (`loadWorkspaceBootstrapFiles`, `src/agents/workspace.ts:441-495`).
A missing file is not skipped; it is injected as `[MISSING] Expected at: <path>`,
which is itself charged against the budget.

**Workspace files are not injection-scanned.** OpenClaw does have a scanner —
`detectSuspiciousPatterns()` and `wrapExternalContent()` in
`src/security/external-content.ts` (13 regexes for "ignore previous
instructions", `<system>` tags, `elevated=true`, homoglyph-folded marker
spoofing, random per-wrap boundary IDs) — but its call sites are email/webhook
hooks, `web_fetch`, `web_search`, the browser tool, and channel metadata.
`detectSuspiciousPatterns` has **no non-test caller anywhere in `src/`**. Nothing
in the bootstrap path calls any of it: `resolveBootstrapContextForRun` →
`buildBootstrapContextFiles` does truncation and budgeting only. The one
sanitiser in the prompt path, `sanitizeForPromptLiteral()`
(`src/agents/sanitize-for-prompt.ts`, strips Unicode Cc/Cf/U+2028/U+2029), is
applied to the **workspace directory path string**, not to any file content
(`src/agents/system-prompt.ts:378-380`). The threat model is explicit and
consistent: workspace files are the operator's own trusted config, so untrusted-
content handling stops at the workspace boundary.

Two other integrity notes: the loader caches file contents by mtime
(`readFileWithCache`), and `loadExtraBootstrapFiles()` (workspace.ts:515-581)
does allow extra glob-matched bootstrap files but requires (a) the resolved path
stays inside the workspace *after* realpath and (b) the basename is one of the
recognised bootstrap filenames (`VALID_BOOTSTRAP_NAMES`) — so a workspace cannot
be tricked into injecting arbitrary files.

## 4. Prompt assembly

`buildAgentSystemPrompt()` (`src/agents/system-prompt.ts:~370-660`) builds one
flat string. Section order, in emission order:

1. `You are a personal assistant running inside OpenClaw.`
2. `## Tooling` → `## Tool Call Style` → `## Safety` → `## OpenClaw CLI Quick Reference` → `## OpenClaw Self-Update` → `## Skills (mandatory)` → `## Memory Recall` → `## Model Aliases`
3. `## Workspace` (+ workspace notes, `## Documentation`, `## Sandbox`)
4. `## Authorized Senders`, `## Current Date & Time`
5. `## Workspace Files (injected)` — a two-line *pointer*, not the content: "These user-editable files are loaded by OpenClaw and included below in Project Context."
6. `## Reply Tags`, `## Messaging`, `## Voice (TTS)`
7. `## Group Chat Context` (or `## Subagent Context` under `minimal`), `## Reactions`, `## Reasoning Format`
8. **`# Project Context`** — the only `#`-level header besides the opening line
9. `## Silent Replies`, `## Heartbeats`, `## Runtime`

The identity files land at step 8, near the end, roughly 400 lines of prompt
after the opening line. `src/agents/system-prompt.ts:608-627`:

```ts
lines.push("# Project Context", "", "The following project context files have been loaded:");
if (hasSoulFile) {
  lines.push(
    "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
  );
}
for (const file of validContextFiles) {
  lines.push(`## ${file.path}`, "", file.content, "");
}
```

Two things follow. First, each file is headed by its **absolute path**
(`## /home/user/.openclaw/workspace/SOUL.md`), not a friendly label. Second,
`SOUL.md` gets a bespoke activation sentence, gated on a basename check
(`baseName.toLowerCase() === "soul.md"`, lines 610-614) — the only file in the
set with a hardcoded behavioral instruction attached, and the only place the
prompt tells the model to *embody* rather than merely read. `IDENTITY.md` and
`USER.md` get no such framing; they arrive as unannotated data.

### Prompt modes

`PromptMode = "full" | "minimal" | "none"` (line 17).

- `full` — everything above.
- `minimal` — subagents/cron. Drops Skills, Memory Recall, Self-Update, Model
  Aliases, User Identity, Reply Tags, Messaging, Silent Replies, Heartbeats;
  Project Context still renders.
- `none` — line 414 short-circuits: `return "You are a personal assistant
  running inside OpenClaw."`. Nothing else. Contrary to what the mode name
  suggests it does not merely trim hardcoded sections; **Project Context,
  including SOUL and IDENTITY, is dropped entirely** because the function returns
  before `contextFiles` is ever consulted. `none` has no config surface and no
  caller in `src/` — `resolvePromptModeForSession()`
  (`src/agents/pi-embedded-runner/run/attempt.ts:226-231`) only ever returns
  `minimal` or `full` — so it is currently reachable only by a direct call to
  `buildAgentSystemPrompt`.

Under `minimal`, the file *set* also shrinks earlier in the pipeline:
`filterBootstrapFilesForSession()` (`src/agents/workspace.ts:497-513`) restricts
subagent and cron sessions to `MINIMAL_BOOTSTRAP_ALLOWLIST` = AGENTS, TOOLS,
SOUL, IDENTITY, USER — i.e. HEARTBEAT, BOOTSTRAP, and MEMORY are dropped, but
persona and identity survive into subagents.

### The CLI-backend (Claude Code / Codex) path

When the agent is a delegated CLI rather than the embedded pi runner,
`src/agents/cli-runner.ts:88-121` calls the same
`resolveBootstrapContextForRun` and the same prompt builder, then hands the
result to the child process as a **command-line argument**, not as a message.
`DEFAULT_CLAUDE_BACKEND` (`src/agents/cli-backends.ts:36-63`) sets
`systemPromptArg: "--append-system-prompt"`, `systemPromptMode: "append"`,
`systemPromptWhen: "first"` — so the whole OpenClaw prompt, Project Context and
SOUL included, is *appended to* Claude Code's own system prompt on the first
turn of a session only, and omitted on `--resume` turns (Claude Code carries it
in session state). `DEFAULT_CODEX_BACKEND` declares no `systemPromptArg` at all,
so under the Codex backend the persona has no delivery channel through this
mechanism. The CLI path also force-appends "Tools are disabled in this session.
Do not call tools." to `extraSystemPrompt`.

The other re-route is the gateway's OpenAI-Responses-compatible surface:
`buildAgentPrompt()` (`src/gateway/openresponses-prompt.ts:43-46`) folds inbound
items with `role: "system"` **or** `role: "developer"` into a single
`extraSystemPrompt` string, which then renders under `## Group Chat Context` —
i.e. caller-supplied developer instructions land *above* Project Context and are
merged into one block, not kept as distinct roles.

Plugins can also intervene: `applyBootstrapHookOverrides()`
(`src/agents/bootstrap-hooks.ts`) fires an internal `agent:bootstrap` hook whose
context carries the mutable `bootstrapFiles` array, so a plugin can add, edit, or
remove SOUL/IDENTITY content before budgeting. `before_agent_start` /
`before_prompt_build` hooks can additionally replace `systemPrompt` outright
(`src/plugins/hooks.ts:142`).

## 5. SOUL vs IDENTITY: where the separation holds and where it blurs

The intended split is clean: SOUL = internal behavior and voice, consumed only by
the model; IDENTITY = external presentation, consumed by both the model and the
runtime's non-LLM surfaces.

Runtime consumers of IDENTITY (never of SOUL):

| Consumer | Uses | Source |
|---|---|---|
| Message prefixing | `[<name>]` prefix on outbound messages | `resolveIdentityNamePrefix`, `src/agents/identity.ts:48-57` |
| Ack reactions | `emoji` as the L4 fallback reaction (after per-account, per-channel, global) | `resolveAckReaction`, `identity.ts:13-46` |
| Channel display identity | `name`, `emoji`, remote `avatarUrl` | `src/infra/outbound/identity.ts` |
| Discord webhook replies | avatar | `src/discord/monitor/reply-delivery.ts:65` |
| `openclaw agents list` | name/emoji + a `source` label (`identity` or `config`) | `src/commands/agents.config.ts`, `agents.commands.list.ts:39` |
| Gateway session metadata | `theme` | `src/gateway/session-utils.ts:365` |

The blurring is real in three places:

1. **The prompt does not preserve the split.** Both files are pasted into the
   same `# Project Context` block with identical `## <path>` framing. Only SOUL
   gets an "embody this" instruction; IDENTITY's name/emoji arrive as
   undifferentiated text, so the model learns its own display name only by
   reading a data record.
2. **Two precedence orders for the same data.** Avatar resolution prefers
   **config over file** (`identity-avatar.ts:26-35`), while `buildAgentSummaries`
   prefers **file over config** (`agents.config.ts`, `identity ?? configIdentity`).
   A workspace where the two disagree renders differently depending on which
   consumer asks.
3. **The IDENTITY template invites soul-content.** `IDENTITY.dev.md` carries
   `## Role`, `## Soul`, `## Relationship with Clawd`, `## Quirks`, and
   `## Catchphrase` sections — i.e. the shipped example of an IDENTITY file is
   half a SOUL file. None of that is parsed; it survives only because the whole
   file is also pasted into the prompt.

## 6. Multi-agent resolution

Everything above is per-agent, keyed on `agentId`. `resolveAgentWorkspaceDir()`
(`src/agents/agent-scope.ts:255-271`):

1. `agents.<id>.workspace` if configured;
2. for the default agent, `agents.defaults.workspace`, else
   `~/.openclaw/workspace[-<profile>]`;
3. for any other agent, `<stateDir>/workspace-<id>`.

Null bytes are stripped from the result (`stripNullBytes`). Every identity read
goes through this function — `loadAgentIdentityFromWorkspace(workspace)`,
`resolveAvatarSource(cfg, agentId)`, `buildAgentSummaries` — so each agent has an
entirely independent SOUL/IDENTITY/USER/AGENTS set, seeded from the same
templates by `ensureAgentWorkspace()` when the agent is created
(`src/gateway/server-methods/agents.ts`, gated on
`agents.defaults.skipBootstrap`). Config-level `agents.<id>.identity` is the
per-agent override layer on top of the file. Agent creation writes the new
agent's name into its `IDENTITY.md` immediately, so a second agent starts with a
name but a blank (template) SOUL.

## 7. Surprises

- **`promptMode: "none"` silently discards the persona.** The name reads as
  "skip the boilerplate sections", but the early return at
  `system-prompt.ts:414` also drops the entire `# Project Context` block.
- **The identity parser is a whole-file line scanner with no scoping.** Any line
  containing `Emoji:` anywhere — inside a quote, a code block, a memory excerpt
  pasted into IDENTITY.md — sets the field, and the last one wins.
- **`Creature` and `Vibe` are parse-only.** Both are recognised by the parser and
  both collapse into a single config `theme` on promotion; neither has an
  independent consumer.
- **Docs drift on subagent injection.** `docs/concepts/system-prompt.md` states
  "Sub-agent sessions only inject `AGENTS.md` and `TOOLS.md`"; the code's
  `MINIMAL_BOOTSTRAP_ALLOWLIST` also includes SOUL, IDENTITY, and USER. Subagents
  do inherit the persona.
- **A missing file costs budget.** `[MISSING] Expected at: <path>` is injected
  and charged against `bootstrapTotalMaxChars` rather than skipped.
- **Onboarding completion is inferred from template divergence.** For legacy
  workspaces with no state file, `ensureAgentWorkspace` decides onboarding is
  done by byte-comparing `IDENTITY.md`/`USER.md` against the templates
  (`workspace.ts:362-385`) — an agent that filled in IDENTITY but reverted it
  exactly would be re-issued BOOTSTRAP.md.
- **Bootstrap files are cached by mtime and by session.** `bootstrap-cache.ts`
  keys on `(workspaceDir, sessionKey)`, so a persona edit mid-session may not be
  picked up until the cache entry turns over.

## Open observations

- The per-file 20 k / total 150 k character budget applies to *all* injected
  workspace files on *every* turn; the docs explicitly warn that `MEMORY.md`
  growth is the usual cause of surprise context cost. Truncation is head+tail
  with a named re-read marker, which is a cheap way to keep a truncated persona
  legible rather than merely cut.
- The trust boundary is drawn at the workspace: injection scanning exists and is
  applied to email/web/browser/channel-metadata content, and deliberately not to
  workspace files. Anything that can write into a workspace file has unmediated
  system-prompt access.
- Exactly one line of the prompt converts a persona file into behavior ("If
  SOUL.md is present, embody its persona and tone…"), gated on the literal
  basename `soul.md`. Renaming the file or splitting the persona across files
  silently loses the activation.
- The structured half of identity is five ad-hoc `Label: value` lines with a
  hardcoded placeholder blacklist — no frontmatter, no schema validation, no
  error surface. Malformed content degrades to "no identity", never to an error.
