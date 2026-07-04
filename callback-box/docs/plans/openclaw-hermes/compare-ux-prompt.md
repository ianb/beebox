# Comparison: UX Surfaces & Prompt Surface

Callback Box (CBX) vs. OpenClaw vs. Hermes Agent. Sources: `cbx-data-model.md`,
`cbx-agent-core.md`, `cbx-proactivity-context.md`, `openclaw-ux-prompt.md`,
`hermes-ux-prompt.md`, `hermes-onboarding-voice-detail.md`.

---

## 1. Side-by-side

### 1a. Prompt assembly

#### Section inventory

| | CBX | OpenClaw | Hermes |
|---|---|---|---|
| **Builder** | No single builder. Layers: Claude Code preset prompt + auto-loaded box `CLAUDE.md` (`@`-includes `agent-guide.md` + briefing cards) + `.claude/rules/*.md` + a per-surface `append` string (`CHAT_SYSTEM_PROMPT`+tz+`NARRATION_OVERLAY`, or the short reactor prompt) | One 1,426-line builder (`buildAgentSystemPrompt`, `src/agents/system-prompt.ts`), documented in `docs/concepts/system-prompt.md` | `build_system_prompt_parts()` (`agent/system_prompt.py`) over a ~2,000-line guidance library (`agent/prompt_builder.py`) |
| **Identity/persona** | Compiled personality section at the tail of the generated agent guide (from `main.personality.card`, confidence/source-tracked); briefing card for facts | `SOUL.md` (persona) + `IDENTITY.md`/`USER.md`/`AGENTS.md` workspace files, fixed order under `# Project Context`; `promptMode: none` collapses to one hardcoded line | `SOUL.md` slot #1 (injection-scanned, cap-truncated) or hardcoded default; `USER.md` as memory target `"user"` with a usage meter in its header |
| **Tool docs** | Stock Claude Code tools; `cb` CLI documented in agent guide + `docs/generated/cb-commands.md` (read on demand) | Native tool-use schemas primary; `## Tooling` one-liner reminders secondary; `tool_search` directory hint for deferred schemas | Native schemas; heavy *behavioral* guidance blocks (task completion, parallel calls, tool-gated guidance) |
| **Skills/procedures** | Procedures + guides as cards/docs, pointed to from the agent guide; per-card-type `instructions` delivered lazily via path-glob rules | `<available_skills>` XML index, byte-compatible with Anthropic's Agent Skills format; lazy bodies; char budget | `<available_skills>` categorized index with a "mandatory — err on the side of loading" header; two-layer cache (LRU + disk snapshot); platform/tool/fallback frontmatter gating; focus-mode demotes (never hides) categories |
| **Channel/surface context** | Per-surface append: chat wire-format tags (`<speech>`/`<typed>`/`<chat-app>`), narration overlay, landmark note; reactor gets a 4-step job prompt | Channel-conditional builder sections + plugin-contributed formatting hints; trusted/untrusted metadata split (§3 below) | `PLATFORM_HINTS` dict of ~20 per-channel rendering briefs (WhatsApp/Telegram/email/cron/cli/webui…), user-overridable with replace/append semantics; `MEDIA:/path` cross-platform attachment protocol |
| **Time** | Timezone/local-time blurb appended once at session start (fresh sessions only) | Timezone only, never the clock; live timestamps ride message envelopes; model calls `session_status` for wall-clock | Date-only timestamp line ("byte-stable for the full day"); model runs `date` for wall-clock |

#### Cache-boundary strategies

Three distinct philosophies:

- **OpenClaw — explicit boundary marker.** `SYSTEM_PROMPT_CACHE_BOUNDARY`
  (`<!-- OPENCLAW_CACHE_BOUNDARY -->`) splits stable prefix from per-turn dynamic
  suffix; the Anthropic adapter emits two system blocks, prefix with
  `cache_control: ephemeral`. Supporting machinery: in-process SHA-256-keyed prefix
  memoization, CRLF/whitespace normalizers that exist *solely* so sections hash
  identically across platforms, `HEARTBEAT.md` classed as dynamic and rendered below
  the boundary, timezone-not-clock.
- **Hermes — freeze the whole thing.** Three tiers (stable / context / volatile) but
  all three are joined and **frozen per session** on `agent._cached_system_prompt`;
  the only rebuild trigger is context compression. Mid-session memory writes
  deliberately don't appear until rebuild; the git snapshot is probed once and the
  *prompt text tells the model* to re-run `git status`; an `ephemeral_system_prompt`
  channel exists for text that must never enter the cached string.
- **CBX — delegate to Claude Code.** CBX sends `systemPrompt: {preset:
  "claude_code", append}` **once, at session creation only** (resumes send no
  prompt at all — `agent-run.ts:208` and two other sites), and leaves
  `settingSources: ["user","project"]` so the CLI itself loads CLAUDE.md/rules.
  Cache discipline is inherited from Claude Code rather than engineered; the one
  home-grown pattern is the same shape as Hermes's frozen snapshot: live-toggle
  behavior (narration mode) works by keeping the rule text always-resident and
  referencing a per-turn `<chat-app>` signal, because the prompt can never be
  re-sent mid-session.

#### Per-model-family prompt dispatch

- **Hermes** is the standout: `tool_use_enforcement` targets GPT/Codex/Gemini/
  Gemma/Grok/GLM/Qwen/DeepSeek (Claude and Hermes's own models deliberately
  absent); Google models get an OpenCode-derived operational block; GPT/Codex get
  XML-tagged `<mandatory_tool_use>`/`<act_dont_ask>` sections and are sent the
  prompt under the `developer` role; edit-format steering is per-family (V4A diff
  for GPT/Codex, str_replace for everyone else). Blocks cite the observed failure
  incidents that motivated them (Opus stub-stopping, DeepSeek fabrication).
- **OpenClaw** dispatches per *harness* rather than per family: on the Codex
  harness, SOUL/IDENTITY/USER are re-routed as developer instructions under
  `## OpenClaw Agent Soul` instead of system-prompt text; provider plugins can
  inject `stablePrefix`/`dynamicSuffix` or override named sections
  (`interaction_style`, `tool_call_style`, `execution_bias`).
- **CBX** has none of this — it is Claude-only by construction (the Agent SDK
  spawns Claude Code), so the entire per-family problem is out of scope. Model
  choice is an ID string passed through to the SDK; no prompt text varies by model.

#### Prompt-size observability

- **Hermes**: `hermes prompt-size` builds a real offline agent (dummy creds, no
  network) and reports byte/char per tier, skills index, memory, user profile, and
  tool-schema JSON; `agent/context_breakdown.py` is the live-session equivalent.
  Answers "where does my fixed budget go" as a first-class CLI command.
- **OpenClaw**: `SessionSystemPromptReport` — char counts, SHA-256 hashes,
  per-tool/per-skill breakdowns, deliberately without storing prompt text; plus
  committed prompt-snapshot fixtures (§ Divergences).
- **CBX**: the knowledge-audit harness (`src/dev/knowledge-audit.ts`) measures
  *token* cost empirically from session logs — initial (always-on baseline) vs.
  peak/added — and appends to a **committed ledger** (`src/dev/context-history.yaml`)
  keyed by box + audit + monorepo HEAD, so a CLAUDE.md trim shows up as a diff.
  `CB_LOG_PROMPTS=1` proxies the wire for full prompt capture, and `--docid-debug`
  embeds `<!-- DOCID:path -->` markers so a doc's presence in a prompt is greppable.
  CBX measures *outcomes* (real tokens billed, taxonomy-level correctness); the
  other two measure *composition* (bytes per section, pre-send).

### 1b. UX surfaces

| | CBX | OpenClaw | Hermes |
|---|---|---|---|
| **Operator dashboard** | React SPA: Dashboard (attention cards, schedules, activity, health), Browse (card/file browser), Chat, Questions, History, Capture, Landmarks, Admin/Settings; tRPC + WS subscriptions | Lit SPA Control UI: chat + overview/activity/workboard/instances/sessions/usage/cron, agents/skills/skill-workshop/nodes/dreams, full config editor (per-channel setup, MCP, logs, exec approvals), command palette | FastAPI + React dashboard on :9119: Chat, Config, Models, Profiles+ProfileBuilder, Skills (with editor), MCP, Cron (visual ScheduleBuilder + AutomationBlueprints form), Plugins, Channels, Webhooks, Sessions, Analytics, Logs, Files, Docs; frontend plugin SDK; 18 i18n locales; pluggable auth gate |
| **Agent-rendered UI** | `views/*.tsx` — agents write real React components, compiled server-side, rendered via `?view=` on card paths and embeddable in chat via `[Name](view:slug)`; renderer registry with page/chat/companion/embed modes | Canvas plugin: agent drives a WKWebView on a paired node (`present`/`navigate`/`eval`/`snapshot`) + **A2UI**, a JSONL declarative-UI protocol pushed live to native clients; canvas content can deep-link back into agent runs | None equivalent; closest is webui markdown+LaTeX+Mermaid rendering and `MEDIA:` previews |
| **Terminal** | `cb` CLI (operator-oriented, not a chat surface) | Large lazy-registered CLI (~20 command groups incl. `doctor`, `tui` chat, `browser` automation) with managed startup latency | Classic prompt_toolkit chat + a flagship **React/Ink TUI** (JSON-RPC sidecar): virtualized scrollback, subagent tree, skills/plugins hubs, ~55 slash commands, pets, Journey timeline, skin engine |
| **Voice** | Browser dictation in chat UI (speech input, mic overlay, recovered-dictation handling); no TTS surface documented | Deepest stack: Talk mode (native + realtime WebRTC/relay), Gateway-owned global wake-word config + on-device detection (incl. the standalone `swabble` daemon), ~14 TTS providers, PSTN telephony plugin (Twilio/Telnyx/Plivo) | Push-to-talk + continuous VAD with TTS feedback-guard; ~6 STT providers (local faster-whisper default), ~11 TTS incl. local voice cloning; gateway auto-transcribes platform voice notes; voice/audio message-type distinction |
| **Onboarding** | None documented; `cb init` (schemas/rules/docs generation) is box setup, not human onboarding | `setup`/`onboard` guided CLI + extensive `doctor` subsystem; native apps have 4-step onboarding, QR/setup-code pairing | 3,418-line modular wizard: first-run 3-way choice (Quick/Nous-OAuth, Full/BYO-keys, Blank Slate), per-section rerun, ~35 provider flows (incl. reading Claude Code's credentials), config backup before touching, Tauri bootstrap installer for desktop |
| **Native apps** | None; Chrome extension (callback-clerk) is the only non-browser client | macOS menu-bar app, released iOS App Store app (+watchOS, Live Activity), released Android app, shared Swift kit | Electron desktop app with a written design system + tested main process, embedded terminal (⌘L send-to-composer); Tauri installer |
| **Messaging channels** | Telegram-style conversational surface (via reactor chat jobs) | 8+ channels with per-channel config UIs in the dashboard | ~15 platforms incl. WhatsApp/Signal/iMessage/QQ/WeChat/Yuanbao; gateway slash commands from any chat surface |

---

## 2. Confirmations — where CBX matches the field

- **Layered instruction files are the consensus architecture.** All three converge
  on: a small always-loaded core (CBX agent-guide.md ≈ OpenClaw `AGENTS.md`+`SOUL.md`
  ≈ Hermes SOUL.md+stable tier), conditional/lazy detail (CBX `.claude/rules/` path
  globs and `docs/generated/` ≈ OpenClaw lazy SKILL.md bodies ≈ Hermes `skill_view`
  progressive disclosure), and an explicit "don't restate what's already loaded"
  discipline (CBX `chat-session-prompts.ts:9-12` says it in a doc comment; OpenClaw
  strips sections for sub-agents via `promptMode: minimal`; Hermes removed its
  Gemini parallel-calls bullet when the universal block landed, to avoid
  double-sending). CBX's choice to make card-type instructions *path-triggered*
  (rules fire only when the agent touches a matching file) is arguably finer-grained
  lazy loading than either competitor's skill index.
- **Token-budget observability is a shared instinct, and CBX is not behind.**
  Hermes `prompt-size`, OpenClaw's `SessionSystemPromptReport`, and CBX's
  knowledge-audit ledger all exist to answer the same question. CBX's committed
  `context-history.yaml` (empirical tokens over time, diffable per trim) is the only
  one of the three with *longitudinal* tracking; the gap is point-in-time
  composition breakdown (§4).
- **Views attach to data.** CBX's "views attach to cards, no standalone views"
  matches OpenClaw's A2UI surfaces being bound to sessions/nodes and Hermes's
  dashboard pages being bound to config objects. More notably, CBX's
  agent-authored compiled `.tsx` views are a *stronger* live-rendered-UI capability
  than Hermes has at all, and roughly peer to OpenClaw's Canvas/A2UI (different
  trade-off: real React with server compile vs. a constrained declarative protocol).
- **Prompt-injection posture via trust boundaries** exists in all three, at
  different depths: CBX keeps behavioral boundaries in prompt content plus
  advisory hooks; OpenClaw splits trusted vs. untrusted channel metadata; Hermes
  threat-scans context files. CBX's per-turn `<chat-app>` snapshot as the signal
  for always-resident rules parallels Hermes's frozen-snapshot-plus-"re-run git
  status" pattern — both accept staleness in the cached prompt and route freshness
  through the turn.
- **Everyone regenerates agent-facing docs from source-of-truth code.** CBX
  `generateDocs()` (mtime/version-cached, template re-sync, auto-commit) is the
  most aggressive: OpenClaw and Hermes cache prompt fragments, but neither
  round-trips generated docs back into the user's workspace and commits them.

## 3. Divergences — different choices, real trade-offs

- **Owning the prompt vs. renting it.** OpenClaw and Hermes hand-build the entire
  system prompt and therefore control byte-level cache layout, per-model dispatch,
  and section-by-section measurement. CBX builds an *append* to Claude Code's
  preset and lets `settingSources` auto-load the rest — which means CBX code
  literally cannot see its own wire prompt except through the `CB_LOG_PROMPTS`
  proxy. Trade-off: CBX gets Claude Code's tooling, caching, compaction, and
  transcript machinery for free and stays small; it gives up cache-boundary
  engineering (no equivalent of OpenClaw's stable/dynamic split — the timezone
  blurb and narration overlay ride in the one-shot prompt), multi-model support,
  and cheap prompt introspection. Given CBX is deliberately Claude-only, most of
  what it gives up is cost it never pays — the introspection gap is the real loss.
- **Untrusted-metadata handling.** OpenClaw's trusted system-block /
  untrusted-user-block split (with sender names *excluded* from the trusted block
  because they're attacker-controlled) and Hermes's context-file threat scanner +
  allow-listed `/steer` marker are both explicit injection architectures. CBX's
  chat wire format (`<speech>`/`<typed>`/`<attachments>`) tags provenance but the
  research docs show no trust-tiering of connector-derived content, consistent
  with `permissionMode: bypassPermissions` everywhere — CBX currently runs on a
  single-boxholder trust model. Fine today; becomes the first thing to revisit if
  untrusted inbound channels (public email, group chats) grow.
- **Prompt regression testing.** OpenClaw commits full prompt-snapshot fixtures
  (regenerated by script, corroborating the entire layer stack end-to-end) and
  asserts structure in unit tests. Hermes freezes and caches but doesn't snapshot.
  CBX has doctests and the knowledge audit, but no fixture asserting "this is what
  a fresh chat session's assembled context looks like" — a prompt-surface
  regression currently shows up only as a behavior change or a token-ledger drift.
- **Dashboard as config editor vs. dashboard as data browser.** OpenClaw and
  Hermes both treat the web UI as the *system's* control plane (config forms,
  channel setup, skill editors, model pickers). CBX's SPA is the *box's* surface —
  browse cards, answer questions, capture, chat; system config stays in files/CLI.
  This matches CBX's files-are-the-database stance; the cost is that anything an
  operator tunes (schedules, connectors, model defaults) has no GUI affordance.
- **Persona file conventions.** Both competitors converge on user-editable
  `SOUL.md`. CBX instead *compiles* personality from a confidence/evidence-tracked
  card, and mines it from retrospectives (`cb retro`). CBX's is the more
  sophisticated lifecycle (provenance, confidence ladder, automatic accrual);
  SOUL.md is the more legible one (open a file, type who your agent is). These
  aren't exclusive — see §4.
- **Onboarding depth tracks distribution model.** Hermes (installed by strangers,
  ~35 provider flows) and OpenClaw (App Store apps, pairing, `doctor`) invest
  heavily; CBX (single known boxholder) invests zero. Correct prioritization —
  but the *Blank Slate* pattern (Hermes: everything off, minimal toolset) and
  sectioned re-runnable wizards are worth remembering when CBX gains its second
  user.
- **Playfulness as engineered surface.** Hermes ships pets and a
  learning-timeline "Journey" view explicitly annotated as zero-prompt-cost
  display concerns; the Journey is the visible face of "the agent is learning."
  CBX has rich learning machinery (guide cards, retro, confidence ladders) with
  no user-visible progress artifact — arguably the bigger miss than pets.

## 4. Steal-this — prioritized ideas for CBX

1. **Prompt snapshot fixtures in CI** (OpenClaw). Capture what a fresh chat/reactor
   session actually sends — the `append` string is trivially snapshotted today, and
   `CB_LOG_PROMPTS` already exists to capture the full wire prompt (CLAUDE.md +
   rules + agent guide included) for a fixture box. Commit the rendered result;
   regenerate by script like OpenClaw's `generate-prompt-snapshots.ts`. Why: today a
   prompt-surface regression (a section silently dropped from the agent guide, a
   rules glob that stops matching) is only detectable behaviorally; a snapshot diff
   makes it a one-line code-review artifact. Effort: **small** (append-only snapshot
   in an afternoon; wire-level fixture ~1-2 days including a deterministic fixture
   box).
2. **`cb prompt-size`** (Hermes). A composition-side complement to the
   knowledge-audit ledger: render the agent guide + CLAUDE.md includes + per-surface
   append offline and report chars/tokens per section (laws, card-type catalog,
   personality, briefing, each rule file). The audit ledger says "the baseline grew
   400 tokens"; prompt-size says *which section* grew. All inputs are already
   assembled by `generateAgentGuide()`'s section functions, so per-section
   attribution is nearly free. Effort: **small** (a day).
3. **Untrusted-metadata split for connector content** (OpenClaw). When inbound
   items carry attacker-controllable strings (email senders/subjects, calendar
   invite titles, web captures), wrap them in an explicitly-untrusted block in job
   descriptions (`buildJobDescription` is the single choke point) and add one
   agent-guide law about lookalike instruction markers (Hermes's allow-listed
   marker pattern). Why: cheapest available hardening given `bypassPermissions`,
   and it front-runs the group-chat/public-inbox future. Effort: **small-medium**
   (the block is easy; auditing which connectors carry untrusted text is the work).
4. **A learning-progress view ("Journey")** (Hermes). CBX already has the data no
   one else has: guide cards with confidence ladders and verbatim-quote evidence,
   retro observations, personality evolution, git history. A `?view=` on a timeline
   of "what this box has learned" (guide-card confidence promotions, new
   procedures, retro integrations) makes the learning loop legible and builds
   justified trust in `cb retro`. Fits the existing views-attach-to-cards model —
   attach it to the personality or a briefing card. Effort: **medium** (data is in
   git + cards; it's a renderer plus a small extraction pass).
5. **Frozen-snapshot honesty markers** (Hermes). Adopt the pattern of *telling the
   model its context is a snapshot*: Hermes's coding brief says "re-run `git status`
   before trusting this." CBX's tz blurb and briefing includes are session-start
   snapshots in long-lived chat sessions; one sentence in the agent guide ("the
   briefing/time context was loaded at session start; re-check with `date` /
   `cb ...` when freshness matters") closes a real staleness class. Effort:
   **trivial**.
6. **Sectioned, re-runnable setup when multi-user arrives** (Hermes). Not now —
   but when CBX gets a second boxholder, copy the shape, not the size: independently
   re-runnable sections, config backup before writes, a Blank Slate tier, and
   detection of existing credentials (Hermes reads Claude Code's creds — CBX's
   users by definition have them). Effort: **deferred; medium when triggered**.
7. **Skip**: A2UI-style declarative UI protocol (CBX's compiled `.tsx` views are
   already stronger for its single-surface web app; a constrained protocol only
   pays off with multiple native clients), per-model-family dispatch (Claude-only
   by design), wake-word/telephony (no native-device story to hang it on), and
   explicit cache-boundary engineering (Claude Code owns the prompt lifecycle;
   revisit only if CBX ever leaves the preset).

## Addendum (2026-07-04): OpenClaw CLI command groups, enumerated

Boxholder asked to see the actual groups behind "large lazy-registered CLI (~20 groups)" — undercounted: `docs/cli/` documents **58 top-level command groups**. Grouped by theme:

- **Core agent/chat:** `agent` (run a turn), `agents` (multi-agent CRUD + bindings), `tui` (terminal chat UI), `message` (send/broadcast outbound), `sessions`, `transcripts`, `infer` (one-shot LLM call), `models` (list/status/failover config)
- **Proactivity:** `cron`, `commitments`, `tasks`, `workboard`, `flows`
- **Channels/devices:** `channels` (login/status/probe per platform), `pairing`, `devices`, `nodes` + `node` (companion-device control), `qr`, `voicecall`, `webhooks`, `message`
- **Gateway/ops:** `gateway` (start/stop/status), `daemon`, `proxy`, `dns`, `dashboard` (control UI), `logs`, `status`, `health`, `doctor` (diagnose + `--fix` config migrations), `backup`, `migrate` (import from Claude/Hermes), `reset`, `uninstall`, `update`, `system`
- **Extensibility:** `plugins`, `skills`, `mcp`, `hooks`, `acp`, `browser` (agent browser automation), `memory` (index/search/status), `attach`
- **Config/security:** `config` (get/set/unset), `configure`/`setup`/`onboard` (wizards), `approvals` (exec-approval policy), `sandbox`, `secrets`, `security` (audit), `policy`, `path`, `directory`
- **Misc:** `completion`, `docs`, `wiki`, `clawbot` (legacy alias), `crestodian` (their mascot/easter-egg maintenance persona)

Contrast with `cb`: this is the cost side of the daemon/gateway architecture — a large share of these groups (gateway, daemon, proxy, dns, pairing, devices, nodes, doctor-fix, channels-login) exist to *operate the always-on service and its device fleet*, a surface CBX doesn't have because boxes are directories and the router/worktree layer is dev-side. The groups that map to real CBX functionality (agent, cron, skills, memory, config, validate-ish doctor) are a small subset.

## Addendum (2026-07-04): wake words & swabble, unpacked

**swabble** (`apps/swabble/`, also standalone at steipete/swabble): Swift 6.2 wake-word *hook daemon* for macOS 26 — fully local (Speech.framework on-device models, zero network), pipeline = mic → on-device transcription → wake gate (default word `clawd`, alias `claude`) → run an arbitrary configured hook command (prefix/env, cooldown, min_chars, timeout). Not an assistant: a generic "heard the word, run this command" primitive with OpenClaw as the obvious hook. Ships CLI (`serve`, `transcribe` to TXT/SRT, `test-hook`, `mic list/set`, `doctor`, launchd service stubs) + `SwabbleKit`, a reusable gap-based wake-gating library (iOS 17+/macOS 15+) shared with the node apps.

**Wake-word architecture** (`docs/nodes/voicewake.md`): wake words are a **single global list owned by the Gateway** — no per-node customization. Stored in gateway SQLite (`voicewake_triggers`, `voicewake_routing_config`, `voicewake_routing_routes`; legacy JSON files are doctor-migration inputs only). Any client edits via `voicewake.get/set`; Gateway persists, normalizes (trim/dedup/count+length caps), and broadcasts `voicewake.changed` to all WS clients and nodes, with an initial-state push on node connect. Detection remains on-device per node; only config is centralized. The standout design: **trigger → target routing** — each wake word routes to `{mode:"current"}`, an `agentId`, or a `sessionKey`, so different spoken words address different agents/sessions. The wake word functions as a channel binding into their multi-agent router. Platform split: macOS/iOS keep local enable toggles; Android has no wake word (manual mic only).

## Addendum (2026-07-04): the native-app fleet ("nodes"), unpacked

Organizing concept: apps are **nodes** — peripherals for the agent, not chat clients (`docs/nodes/index.md`). A node connects to the Gateway WS (same port as operators) with `role: node`, passes device pairing (setup-code/QR, approved via CLI/UI), and exposes an agent-invokable command surface (`canvas.*`, `camera.*`, `device.*`, `notifications.*`, `system.*` via `node.invoke`), gated two-part: node-declared × gateway-allowlisted. Channels terminate at the gateway; nodes never receive chat directly.

- **iOS** (released, App Store, Fastlane): chat/voice/approvals + ShareExtension (share from any app into the agent), WatchApp target, ActivityWidget (Live Activity: agent-run progress on lock screen/Dynamic Island), push; some commands foreground-only per iOS limits.
- **Android** (released, Play): QR pairing, encrypted persistence, biometric lock, streaming chat, push, authenticated background presence beacons, Voice + Screen tabs; can advertise extra command families (device/personal-data) when enabled.
- **macOS**: menu-bar companion; can run in node mode exposing local canvas/camera to a remote gateway. Sibling `macos-mlx-tts` app does local Apple-silicon TTS.
- **Shared Swift kit** (`apps/shared/`): `OpenClawProtocol` (WS wire types, Swift twin of the TS protocol schema) + `OpenClawKit` (client/session logic) + `OpenClawChatUI` (chat rendering), consumed by macOS+iOS; `SwabbleKit` shared separately for wake-gating. Their one-protocol story in miniature: shared protocol/state core, per-platform UI.

CBX contrast: callback-clerk is a *human's* tool that talks to the box; a node is the *agent's* actuator on a device. Transferable idea if ever needed: capability-declaring peripherals (e.g. clerk exposing page-capture as an agent-invokable capability), not the app fleet itself.
