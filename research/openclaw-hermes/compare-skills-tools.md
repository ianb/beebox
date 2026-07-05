# Skills, Tools, Plugins, Extensibility — CBX vs. OpenClaw vs. Hermes

Factual comparison across three systems' extensibility surfaces. CBX = Callback Box
(`callback-box/`, this monorepo). OpenClaw and Hermes Agent are the two comparable
open-source personal-assistant/agent systems. Sourced from `cbx-proactivity-context.md`,
`cbx-agent-core.md`, `cbx-data-model.md`, `openclaw-skills-plugins.md`,
`hermes-skills-tools.md`.

---

## 1. Side-by-side

### 1.1 Skill format & discovery

| | CBX | OpenClaw | Hermes |
|---|---|---|---|
| Unit of "skill" | No native concept — closest analogues are **schema `instructions`**, **guide cards**, **procedures**, and Claude Code's own native `.claude/skills/*` (used by the *dev-agent* building CBX, not by box agents) | `SKILL.md` dir, AgentSkills-spec frontmatter (`name`, `description`, + `metadata.openclaw`) | `SKILL.md` dir, Anthropic-style frontmatter + `metadata.hermes` block |
| Discovery | Glob-based per mechanism: `.claude/rules/*.md` via Claude Code `paths:` glob; `**/*.landmark.card` for landmarks; schema registry for card types | 6-tier precedence directory scan (workspace → `.agents/skills` → `~/.agents/skills` → `~/.openclaw/skills` → bundled → plugin-declared), canonical name from frontmatter | 4-tier (in-repo bundled → user-local `~/.hermes/skills` → optional bundled → external dirs), local wins on collision |
| Central manifest | None — filesystem *is* the registry (landmarks, schemas, rules all discovered by glob, no index file) | None — same directory-scan philosophy | None for skills; `.bundled_manifest` tracks sync provenance only |
| Category/index blurb | Card-type catalog compiled into agent guide by `cardTypesSection` | none observed | `DESCRIPTION.md` per category — one-line blurb distinct from any skill's own description |

### 1.2 Lazy/progressive disclosure into prompt

All three systems converge on the same idea — cheap index always visible, full body fetched
on demand — but implement it at different granularities:

- **CBX**: Two-tier by design, but the mechanism is per-artifact rather than one unified
  "skill list." `.claude/rules/*.md` are genuinely lazy — Claude Code's native `paths:` glob
  auto-injects a rule file's *full content* only when the agent touches a matching path (e.g.
  editing `*.memo.card` loads `card-memo.md`). The agent guide (`agent-guide.md`) is the
  always-loaded index-equivalent: it lists every card type and points to
  `docs/generated/card-<type>.md` for on-demand detail, but reading that file is a plain `Read`
  tool call, not a governed slash-command/index mechanism. Directory `CLAUDE.md` is the other
  lazy channel — loads only when `cwd` is inside that directory (used deliberately for
  landmark-scoped chat sessions). No token-cost accounting or context-window-relative
  threshold exists anywhere in CBX's prompt assembly.
- **OpenClaw**: `formatSkillsForPrompt()` injects only `name`/`description`/`location`/
  `version` per eligible skill as XML, explicitly modeled on a deferred-tool-search pattern;
  documented deterministic token formula (`195 + Σ(97 + len(name)+len(description)+
  len(filepath))`). Snapshotted once per session, refreshed only on file-watch/remote-connect
  events.
- **Hermes**: `build_skills_system_prompt()` builds a compact per-category index
  (name + one-line description only); full content fetched via `skill_view`. Goes one step
  further than OpenClaw with a "coding posture" that can demote whole categories to
  names-only (drop descriptions) under token pressure — but a skill name is never fully
  hidden. Two-layer cache (in-process LRU + disk snapshot keyed by file mtimes) makes this
  cheap across restarts, unlike CBX's `agent-guide.md` regen (mtime/version-cached but
  regenerates the whole guide, not a per-skill index).

### 1.3 Agent-authored skills — creation/patching/curation lifecycles

- **CBX**: Nothing shaped like "skill" in the box itself. The closest agent-authored
  extension points are box-local **schemas** (`config/schemas/*.ts`, discoverable via
  `config/schemas/CLAUDE.md`, requires `cb init` re-run), **tricks** (helper scripts),
  **views** (React components), and **landmarks** (agent *proposes*, human/agent edits, guided
  by `docs/landmark-curation.md`). None of these have a formal create/edit/patch/delete tool
  surface, an approval gate, or a usage-driven lifecycle (stale/archive/pin). The box's
  *cb retro* mechanism (§7.4 of `cbx-proactivity-context.md`) is architecturally the nearest
  analogue to Hermes's Curator — a periodic, evidence-gathering, confidence-graded background
  process — but its target is **guide/personality cards**, not skills, and it has no notion of
  a reusable "procedural memory" artifact at all.
- **OpenClaw**: No agent-authored skill creation observed in the researched material — skills
  are installed (ClawHub/git/local) or bundled, not authored in-session by the agent itself.
  (`skill-creator` exists as a bundled *skill* — a human-facing meta-skill — but is distinct
  from an agent tool for programmatic creation.)
  Skills are also architecturally inert relative to plugins: they carry no code, only
  instructions + gating metadata.
- **Hermes**: The most developed lifecycle of the three. `skill_manage(action=...)` tool gives
  the agent `create`/`edit`/`patch`/`delete`/`write_file`/`remove_file`, always targeting
  `~/.hermes/skills/` (never the in-repo tree, which needs `write_file`+`git commit` via a
  separate meta-skill). Writes gated by frontmatter/name/size validation, an optional approval
  stage (writes always stage — "too large to review inline"), a delete-target path-traversal
  guard, and a pin mechanism. System prompt actively instructs "patch it immediately... don't
  wait to be asked" — a closed-loop self-improvement nudge with no CBX equivalent. Layered on
  top: usage telemetry (`skill_usage.py`) drives an inactivity-triggered background **Curator**
  (`agent/curator.py`) that prunes (active→stale→archived, never delete) and optionally
  consolidates near-duplicate skills, restricted to agent-created skills only, pinned/
  external/hub skills untouchable.

### 1.4 Plugin/extension architecture

- **CBX**: Deliberately **not** agent-extensible at this layer. Connectors (`src/connectors/`)
  and CLI commands (`src/cli/commands/`) live in the callback-box source tree, outside any box,
  explicitly not agent-editable (`docs/knowledge-taxonomy.md`). There is no plugin manifest, no
  capability-registration API, no lifecycle hooks exposed to a box. The only "extension" surface
  a box agent can touch is data-level (schemas, procedures, views, tricks) — code-level
  extensibility is a human/source-change operation.
- **OpenClaw**: `extensions/` (~149 dirs) is a flat namespace where every plugin is a native
  OpenClaw plugin registering against typed capability APIs (`registerProvider`,
  `registerChannel`, `registerTool`, event hooks like `before_tool_call`) via
  `openclaw.plugin.json` + a declaration-only Plugin SDK (`dist/plugin-sdk`) for third-party
  authors. Manifest inspected *before* code execution for config validation.
- **Hermes**: `plugins/` uses `plugin.yaml` + `register(ctx)`, `PluginContext` facade covering
  tools, CLI/gateway/dashboard hooks, provider registration for image/video/web-search/browser/
  TTS/transcription, and a host-owned `ctx.llm` facade for trusted plugins. Directory layout
  varies by `kind` (`standalone`/`backend`/`exclusive`/`platform`/`model-provider`), each with
  different auto-load policy. Four discovery sources including pip entry-points — broader
  packaging integration than OpenClaw's directory-only model.

### 1.5 MCP (consume + serve)

- **CBX**: **None.** No MCP client or server configuration anywhere in the agent-invocation
  code (confirmed by grep across `src/core`/`src/webapp`/`src/services` in `cbx-agent-core.md`
  §5.1). The SDK's `permissionMode: "bypassPermissions"` with no `allowedTools`/
  `disallowedTools`/MCP config means CBX simply hasn't opened this door in either direction.
- **OpenClaw**: Both directions, extensively documented (856-line `docs/cli/mcp.md`). Server:
  `openclaw mcp serve` bridges channel conversations as MCP tools/resources. Client: config
  registry (`mcp.servers`) with stdio/sse/streamable-http transports, per-CLI-backend adapters
  (Claude/Gemini/Codex), tools folded into the same effective-tool-inventory/policy pipeline as
  native tools, and explicitly unified into the **Tool Search** deferred-catalog alongside
  native and plugin tools.
- **Hermes**: Both directions too, in *three* code paths. Serves a 9-tool messaging bridge
  (explicitly modeled on OpenClaw's), a second curated-tool-subset server for Codex
  interop, and consumes via a 5000-line general client engine (`tools/mcp_tool.py`) supporting
  stdio/HTTP/SSE, OAuth, sampling (server-initiated LLM completions back through the host), and
  a curated "Nous-approved" catalog (`optional-mcps/`) for arbitrary additions. MCP tools land
  in `mcp-<server>` toolsets and are deferrable by default under the same `tool_search.py`
  mechanism as everything else.

### 1.6 Distribution / registries

- **CBX**: None. Box-local schemas/procedures/tricks/views are hand-authored per box; the
  monorepo's own template-sync mechanism (`config/template-versions.json`) distributes
  *upstream* callback-box changes into boxes, but there is no third-party marketplace, no
  install command, no security-scanning gate for external content.
- **OpenClaw**: **ClawHub** (`clawhub.ai`) — single registry for both skills (folder-based,
  `@owner/skills/<slug>`) and plugins (npm-scoped `@owner/package`), owner-scoped publishing,
  mandatory automated security scanning before releases go live, `openclaw skills verify` trust
  envelope, fail-closed `security.installPolicy` gate before any install.
- **Hermes**: Multiple layers — bundled/optional-bundled sync (in-tree, not a registry),
  **Skills Hub** (`skills_hub.py`) importing from four external sources (Anthropic's own repo,
  Claude marketplace, LobeHub, OpenAI's — plus user-addable "taps"), a 4-tier trust model
  (`builtin`/`trusted`/`community`/`agent-created`) with regex-based static-analysis scanning
  (`skills_guard.py`) distinct from OpenClaw's scan-on-publish model (Hermes scans on
  *install*, keyed by trust tier, and optionally on *agent-created* skills too).

### 1.7 Tool gating

- **CBX**: **No gating of any kind.** `permissionMode: "bypassPermissions"` unconditionally on
  every SDK call — full stock Claude Code tool set (Read/Write/Edit/Bash/Glob/Grep/WebFetch/
  WebSearch/Task/TodoWrite/NotebookEdit) for every agent invocation, chat or reactor, with zero
  `allowedTools`/`disallowedTools`. The only two hooks (`sdk-hooks.ts`) are advisory-only
  (`additionalContext` injection or a nudge), never blocking. The real access boundary is
  `cwd` + `additionalDirectories` (filesystem scoping), not tool authorization — behavior
  boundaries are enforced entirely through prompt content (the agent guide's "laws," schema
  instructions) plus post-hoc validation (git pre-commit blocking invalid cards).
- **OpenClaw**: Multi-layered — per-skill `requires`/`os`/`primaryEnv` gates, per-agent
  `agents.defaults.skills`/`agents.list[].skills` allowlists (replacement not union), config-
  level `skills.entries.<name>.enabled`, tool profiles (`coding`/`messaging`/`minimal`) that
  determine whether MCP tools are folded in, `tools.deny` denylist, and hook-based approval
  gating (`before_tool_call` can block/cancel/override/require-approval).
- **Hermes**: Toolset-based (`_HERMES_CORE_TOOLS` composed into named `TOOLSETS`), one bundle
  per messaging channel with deliberate exceptions (`hermes-webhook` restricted to 4 safe tools
  because webhook payloads carry untrusted content — a direct prompt-injection mitigation CBX
  has no equivalent for, since CBX's Gmail connector instead keeps untrusted body text in a
  sibling `.body.txt` file, out of the card, rather than restricting the *agent's* tools).
  `check_fn` per-tool availability probing, `override=True` + explicit config opt-in required to
  shadow a built-in tool, approval/confirmation UX (`write_approval.py`) as a first-class layer
  distinct from OpenClaw's hook-based approval.

---

## 2. Confirmations — where CBX matches

- **Lazy/conditional loading via native harness mechanisms is the same idea CBX already uses,
  just via Claude Code's own primitives rather than a bespoke skill loader.** `.claude/rules/
  *.md` (path-glob-triggered) is functionally identical to OpenClaw's/Hermes's "index always
  visible, full body on demand" pattern — CBX gets this for free from Claude Code's
  `settingSources` auto-load rather than building a custom `skill_view`/`tool_search` bridge.
  Directory-scoped `CLAUDE.md` is the same mechanism at directory rather than file-type
  granularity.
- **Schema `instructions` as behavior-definition is architecturally the same move as
  Hermes's/OpenClaw's SKILL.md-as-behavior**: both are "prose injected into agent context when
  a specific artifact type is being handled, instead of a code branch keyed on type." CBX just
  keys this off card *type* (declared once, in one place, mechanically compiled to both a rule
  file and a doc) rather than off a freestanding skill directory a model chooses to invoke.
  The `chat-thread` schema's `instructions` field encoding the entire seen/reply protocol
  (`cbx-data-model.md` §5.1) is a clean example of the same "procedural memory attached to a
  data shape" idea Hermes states explicitly for skills ("capture how to do a specific type of
  task").
- **No central manifest, filesystem-is-the-registry** is shared with both competitors at the
  *skill-discovery* layer (glob-scan, no index file) — CBX extends this same philosophy further
  than either competitor, since it applies it to card types, procedures, landmarks, *and*
  connectors' data, not just to one extensibility mechanism.
- **Guide cards' confidence/source evidence model** (confirmed/high/medium/low/hypothesis;
  user-stated/feedback/inferred/default) plays a similar role to Hermes's trust tiers for
  skills (builtin/trusted/community/agent-created) — both are "how much do we trust this
  belief/artifact and who put it there," though CBX's model governs *behavioral guidance*
  provenance, Hermes's governs *installed-code* provenance.

---

## 3. Divergences — different choices and trade-offs

### 3.1 Full toolset, no gating at all — vs. governed tool surfaces everywhere else

CBX gives every agent invocation the complete stock Claude Code tool set with
`bypassPermissions` and zero allow/deny lists; both competitors treat tool-surface shaping as a
first-class, multi-layered concern (per-skill gates, per-agent allowlists, tool profiles,
approval hooks, trust-tiered toolsets). Trade-off: CBX's approach is dramatically simpler to
reason about and never suffers from "the tool I need isn't available this turn" — but it also
means CBX has **no defense-in-depth against a compromised or misbehaving box agent** beyond
filesystem scoping (`cwd`) and prompt-level social contract (the "laws," schema instructions).
Hermes's `hermes-webhook` toolset restriction (4 safe tools only, because webhook payloads carry
untrusted content) is a concrete pattern CBX has no analogue for at the tool layer — CBX
instead solves the *same* untrusted-content problem at the data layer (Gmail body kept in a
sibling `.body.txt`, never loaded into frontmatter/context). Both are valid mitigations for the
same threat, but CBX's is the only one of the three that has never been generalized to "an
agent invocation over untrusted content should also get a narrower tool surface."

### 3.2 Schemas-as-behavior vs. skills-as-behavior — different granularity and different author

CBX's `instructions` are declared by whoever writes the schema (source-tree, human, in
practice), always active whenever a matching card is touched — deterministic, not a model
choice. Both OpenClaw's and Hermes's skills are declared as free-standing files the *model*
chooses to invoke via a description match — probabilistic activation, but far more granular
(any recurring workflow, not just "this card type"). This means CBX has excellent coverage for
"how do I handle this card" but nothing for "how do I do this general task" (e.g. a debugging
methodology, a specific external-tool integration workflow) unless it happens to be schema-
shaped. Hermes's `software-development` skill category (TDD, systematic-debugging, plan,
simplify-code) is exactly the kind of general-competence knowledge CBX has no storage location
for at all — it would currently have to live awkwardly in the always-on agent guide or a
one-off `docs/generated/*.md` page, competing for context budget regardless of whether the
current task needs it.

### 3.3 No agent-authored extensible-instruction artifact vs. both competitors having one

Neither OpenClaw nor Hermes lets an agent create a new *card type* the way CBX does (box-local
schemas) — that's a CBX-only capability, and a strong one (a new Zod schema is far more
structurally rigorous than a new markdown file). But conversely, CBX has no equivalent of
"write down a reusable *procedure I just learned*, in a form other future sessions/agents will
discover unprompted." CBX's *procedures* (`config/procedures/*.procedure.card`) are the closest
structural analogue (multi-step, agent-runnable) but are typically boxholder/human-authored
config, not a lightweight thing an agent spontaneously writes mid-task the way Hermes's
`skill_manage(action='create')` is explicitly nudged to happen ("don't wait to be asked").

### 3.4 No usage-driven lifecycle / curation loop for any extension artifact

Hermes's Curator (usage telemetry → active/stale/archived/pinned state machine → optional
LLM-driven consolidation of near-duplicates) has no CBX counterpart for *any* artifact type —
not schemas, not procedures, not views, not tricks. CBX's `cb retro` is structurally similar
machinery (periodic, evidence-gated, confidence-graded, background-agent-driven) but is scoped
to guide/personality *belief* content, never to pruning/consolidating the box's own extension
surface. A box accumulating box-local schemas or tricks over months has no mechanism analogous
to "this hasn't been touched in 90 days, archive it" — cruft just sits there forever (this
mirrors the general cb-codehealth concern, but nothing automates the signal-gathering side the
way Curator's telemetry does).

### 3.5 No plugin/capability-registration layer at all

Both competitors let third-party code register new providers/channels/tools/hooks against a
typed API; CBX's connectors are the nearest functional equivalent but are compiled into the
callback-box source tree, not independently distributable, versioned, or installable per-box.
This is a deliberate trade-off given CBX's single-user, filesystem+git, source-tree-owns-code
model — but it means adding a new external integration (a new messaging platform, a new data
source) is always a CBX-repo change, never something a box or its agent can pull in
independently, and CBX has no equivalent of OpenClaw's Plugin SDK / Hermes's `PluginContext`
facade for third parties to target.

### 3.6 No MCP in either direction

Both competitors treat MCP client+server as core infrastructure, unifying it with native tools
via a deferred-catalog abstraction (OpenClaw's Tool Search, Hermes's `tool_search`/
`tool_describe`/`tool_call` bridge). CBX has neither — no way for a box agent to reach an
external MCP server's tools (e.g. Linear, a filesystem server, a specialized API) without that
capability being hand-built as a CBX connector, and no way for CBX itself to expose its own
card/job state to an external MCP client (e.g. driving CBX from Claude Desktop or another
agent). Given CBX already runs *inside* Claude Code (which itself has native MCP support), this
gap is more "unexercised" than "architecturally precluded" — the SDK's `Options` object simply
never sets any MCP-related field.

---

## 4. Steal-this — prioritized ideas for CBX

Ranked roughly by (impact × how well it fits CBX's existing architecture) ÷ effort, given CBX's
constraints: Claude Agent SDK (not a custom agent loop), single-user boxes, filesystem+git as
the only durable state, existing `cb retro` infrastructure, existing schema-`instructions`
pattern.

### 4.1 Adopt a box-local skills directory, seeded from Claude Code's own native mechanism (Low effort, high fit)

CBX already runs on Claude Code, which has a **native `.claude/skills/` directory** with
exactly the SKILL.md format both competitors converged on independently — CBX doesn't need to
build a loader, a lazy-injection mechanism, or a token-cost formula; Claude Code already does
all of it. The gap isn't infrastructure, it's that **box agents currently have no reason to
write to `.claude/skills/`** — nothing tells them to, and nothing in the agent guide mentions
it as an option. Concretely: add a short section to the agent guide (or, better, a targeted
`docs/generated/skills-guide.md` referenced from the guide, matching the "discoverable not
always-on" pattern already used for `config/schemas/CLAUDE.md`) that tells the agent it *can*
write a `.claude/skills/<name>/SKILL.md` when it discovers a reusable multi-step workflow that
isn't card-type-specific — the general-competence gap identified in §3.2 (a debugging
methodology, a connector-specific quirk workaround, an external-CLI-tool recipe). This costs
almost nothing (no new code, one guide edit + a knowledge-audit entry to verify it lands) and
directly closes the biggest capability gap versus both competitors: general procedural
knowledge that doesn't map to a card type.

### 4.2 A `skill_manage`-equivalent is *not* needed — but a nudge sentence is (Very low effort)

Don't build Hermes's structured create/edit/patch/delete tool — CBX's box agents already have
unrestricted Write/Edit, so a dedicated tool would be pure ceremony for a single-user box with
no approval-gate concept to hook into. What's missing is only the *prompt-level nudge* Hermes
found valuable: "when you find a skill outdated or wrong, patch it immediately — don't wait to
be asked." Add one sentence like this to whatever guide section results from §4.1. This is
squarely "arrange context, don't automate judgment" (per the user's own stated preference) —
exactly the right level of intervention here.

### 4.3 Extend `cb retro`'s discovery lens to cover skills usage, not just chat belief-mining (Medium effort, high fit given existing infra)

Given `cb retro` already exists as a periodic, confidence-graded, evidence-quoting background
sweep (`cb-plan`-adjacent infra CBX already dogfoods), the marginal cost of teaching it to also
notice "this `.claude/skills/*` file hasn't been referenced in git commits/tool-use logs for 90
days" or "these two skills look like near-duplicates" is much lower than building Hermes's
separate Curator subsystem from scratch. This wouldn't need new telemetry infrastructure if
git history + `cb search`'s `contains:` mechanism can approximate "last touched" — worth
checking whether Claude Code's own session transcripts (already read by retro, §7.4) log which
skill files got `Read`. This is a genuine "steal the idea, not the code" — reuse `cb retro`'s
existing observation → ledger → integrate → report pipeline rather than adding a second
background-agent framework. Medium effort because it requires deciding what "usage" means for
a file with no dedicated telemetry today (unlike Hermes's `skill_usage.json`, bumped
explicitly by `skill_view` calls).

### 4.4 A narrow, threat-specific tool-gating pattern for untrusted-content agent turns (Medium effort, targeted)

Not a general allowlist system (that would be a large, invasive change to a codebase built
around `bypassPermissions` everywhere, and the user's own strictness bias would still want it
scoped carefully rather than half-built) — but Hermes's `hermes-webhook` toolset restriction is
a concrete, small pattern worth lifting for CBX's own known untrusted-content surface: chat
jobs/messages arriving from external connectors before triage has categorized them. Currently
CBX's mitigation is entirely data-layer (Gmail body kept out of frontmatter). Consider whether
the *processing* of an as-yet-uncategorized inbox item (the `guess`/`_unsure` triage path,
`cbx-proactivity-context.md` §2.2) should run with a narrower tool surface (no `WebFetch`/
`Bash` network egress) until it's past the triage gate — a bounded application of the SDK's
per-invocation `Options`, not a system-wide policy. This is genuinely new engineering (CBX's
current agent wrapper has no tool-restriction code path at all), so it's scoped down: propose
it, don't build it unilaterally, since it's a security-posture decision the user should weigh
in on (per this environment's own guidance on lint/config changes generalizing to "ask before
narrowing an established permissive default").

### 4.5 MCP client support for box agents (Higher effort, optional/deferred)

Lowest priority of the concrete ideas, and arguably out of scope unless a specific external
integration need arises: CBX already gets a connector-equivalent capability by writing a
TypeScript connector in the source tree, which is more structurally sound (typed, tested,
git-reviewed) than pointing at an arbitrary MCP server. The case for MCP would only be "a box
wants to reach a specific external MCP server (e.g. Linear) without CBX shipping a bespoke
connector for it" — a real but currently-hypothetical need. If it comes up, the SDK-level
plumbing is small (Claude Agent SDK's `Options` already supports MCP server config natively;
CBX would only need to decide config-file shape and whether/how MCP tool schemas interact with
the existing `permissionMode: "bypassPermissions"` posture). Not worth building speculatively.

---

## Key source/doc index

| Area | Primary sources |
|---|---|
| CBX context layers, guide cards, box-local schemas | `cbx-proactivity-context.md` §3 |
| CBX tool surface / permission mode / hooks | `cbx-agent-core.md` §5 |
| CBX schema `instructions` mechanism | `cbx-data-model.md` §2.3, §7 |
| CBX retro (nearest curation analogue) | `cbx-proactivity-context.md` §7.4 |
| OpenClaw skills, gating, lazy injection | `openclaw-skills-plugins.md` §1–2 |
| OpenClaw plugins/MCP/ClawHub | `openclaw-skills-plugins.md` §3, §5, §6 |
| Hermes skill lifecycle, Curator, security scan | `hermes-skills-tools.md` §1 |
| Hermes tools, toolsets, tool_search | `hermes-skills-tools.md` §2 |
| Hermes plugins, MCP | `hermes-skills-tools.md` §3–4 |
