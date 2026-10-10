# Deep dive: how OpenClaw defines a plugin (2026-10-09)

*Snapshot of `openclaw/openclaw@23b8ffe` (version `2026.9.9`, cloned 2026-10-09), its `docs/plugins/` and `docs/tools/` trees, ClawHub listing pages, and public GitHub issues. Paths are into the OpenClaw repo unless prefixed `research/` or `beebox/`. Written for one Bee Box question: should Bee Box have a plugin system, and is a plugin a bundle of existing pieces, a new kind of thing, or a distribution mechanism ([issue](../../issues/closed/exploration/2026-08-19-plugins-and-the-medium-content-line.md)).*

## 0. What changed since the 2026-07 notes

- [compare-skills-tools §1.4](compare-skills-tools.md): "~149 dirs" in `extensions/` and a single `dist/plugin-sdk`. Now 166 dirs (164 manifests); the root `openclaw/plugin-sdk` import is **removed**, only documented subpaths remain (`docs/plugins/sdk-migration.md`).
- [openclaw-architecture-review §2](../openclaw-architecture-review.md): "only one memory plugin at a time". Slots are now `memory` and `contextEngine` (`docs/tools/plugin.md:213`). Its manifest-discovery and validate-before-code claims still hold.
- [compare-security](compare-security.md): plugins inside the trust boundary. Still true, now stated in the plugin docs (`docs/plugins/architecture.md:917`). New: install-time **capability consent** and per-hook grants (§4), which the docs call review gates, not a sandbox.
- [compare-skills-tools §1.6](compare-skills-tools.md): ClawHub has "mandatory automated security scanning". Scanning exists (VirusTotal, ClawScan, static analysis: `docs/tools/skills.md:384`) but arrived after the February 2026 ClawHavoc campaign (§6); the publish gate is still a GitHub account of minimum age.
- Not in any earlier note: **compatible bundles** (Agent Plugins, Codex, Claude, Cursor layouts installed as content packs), feature plugins with native Control UI, per-call plugin permission requests, a compat registry with dated removal windows.
- [deep-installation](deep-installation.md) and [deep-openclaw-canvas-a2ui](deep-openclaw-canvas-a2ui.md) make no plugin claims this note supersedes; canvas remains a bundled plugin.

## 1. Packaging and manifest

A native plugin is an npm package (TypeScript ESM, Node 24.16+) with two metadata files (`docs/plugins/building-plugins.md:30-125`):

- `openclaw.plugin.json` at the package root, required. Required fields `id` and `configSchema` (JSON Schema). OpenClaw reads it "to validate configuration without executing plugin code"; a missing or invalid manifest is a plugin error (`docs/plugins/manifest.md`). It also carries `categories`, `contracts` (static ownership: `tools`, `trustedToolPolicies`), `toolMetadata` (`optional`, `sideEffecting`), `activation` (`onStartup`, `onCommands`, `onCapabilities`), `skills` dirs, `cliCommands`, `uiHints`, `controlUi`/`dashboard`, `mcpServers`, `backupResources`, `doctorContract` (state migrations), `channels`, `providers`, `kind: memory` for slot plugins. Example: `extensions/memory-lancedb/openclaw.plugin.json`. The manifest is explicitly **not** for hooks or the runtime entrypoint.
- `package.json#openclaw` (`docs/plugins/manifest/package-json.md:27-124`): `extensions` (source entrypoints, must stay inside the package), `runtimeExtensions` (built JS), `setupEntry` (light module for onboarding/status without loading the runtime), `compat.pluginApi` (semver floor), `install.minHostVersion`, `install.expectedIntegrity` (sha512 verified on install), `install.npmSpec`/`clawhubSpec`, `channel.configuredState` (env checks).
- Entry: `definePluginEntry({ id, register(api) {...} })` or `defineToolPlugin(...)`; registration is synchronous (`docs/plugins/architecture.md:550-555`).

Ownership is declared twice: statically in `contracts` so the host can route without loading code, and at runtime by the register call.

## 2. What a plugin can add

`src/plugins/plugin-api.types.ts` exposes 60 `register*` methods:

- **Capabilities** (`docs/plugins/architecture.md:32-56`): `registerProvider` (text inference), `registerCliBackend`, `registerEmbeddingProvider`, `registerSpeechProvider`, `registerRealtimeTranscriptionProvider`, `registerRealtimeVoiceProvider`, `registerMediaUnderstandingProvider`, `registerTranscriptSourceProvider`, `registerImageGenerationProvider`, `registerMusicGenerationProvider`, `registerVideoGenerationProvider`, `registerWebFetchProvider`, `registerWebSearchProvider`, `registerChannel`, `registerGatewayDiscoveryService`, `registerMigrationProvider`.
- **Tools and commands**: `registerTool` (`optional: true` requires a `tools.allow` opt-in, `docs/plugins/tool-plugins.md:122`), `registerToolMetadata`, `registerCommand` (slash), `registerCli` (root CLI command), `registerNodeHostCommand`.
- **Memory/context slots**: `registerContextEngine`, `registerMemoryCapability`, `registerMemoryPromptSupplement`, `registerMemoryCorpusSupplement`, `registerCompactionProvider`, `registerStorageProvider`. `plugins.slots.memory`/`.contextEngine` pick one; "Core decides whether a discovered plugin is enabled, disabled, blocked, or selected for an exclusive slot" (`architecture.md:114`).
- **Scheduling/background**: `registerService` (with `gateway_start`/`gateway_stop`), `registerSessionSchedulerJob`, `registerRuntimeLifecycle`; hooks `cron_changed`, `cron_reconciled`, `heartbeat_prompt_contribution` (`docs/plugins/hooks/reference.md:133,240-244`).
- **UI**: `registerControlUiDescriptor` (pages, nav, panels, dashboard widgets, or replacements for workspace, session list, composer, transcript, tool results), `registerWidgetPresenter`, `registerBoardWidgetContentKind`, `registerInteractiveHandler`. Behind a default-off lab (`gateway.controlUi.experimental.customPlugins`); "runs trusted JavaScript in the Control UI origin" with the operator's Gateway authority (`docs/plugins/feature-plugins.md:19-47`).
- **Gateway surface**: `registerHttpRoute`, `registerGatewayMethod`, `registerGatewayAccessPolicy`, `registerMcpServerConnectionResolver`, `registerAgentHarness`, `registerAgentExecutorController`, `registerAgentToolResultMiddleware`, `registerConfigMigration`, `registerSecurityAuditCollector`.
- **Hooks**: `api.on(name, handler, { matcher, priority, timeoutMs })` typed; `api.registerHook` for the older coarse `command:new` system (`docs/tools/plugin.md:261-280`). Typed catalog (`hooks/reference.md:126-244`): `before_model_resolve`, `agent_turn_prepare`, `before_prompt_build`, `before_agent_run`, `before_agent_reply`, `before_agent_finalize`, `agent_end`, `heartbeat_prompt_contribution`, `model_call_started/ended`, `llm_input`, `llm_output`, `before_tool_call`, `after_tool_call`, `resolve_exec_env`, `tool_result_persist`, `before_message_write`, `inbound_claim`, `channel_pairing_requested`, `message_received`, `message_sending`, `reply_payload_sending`, `message_sent`, `before_dispatch`, `reply_dispatch`, `session_start/end`, `before/after_compaction`, `before_reset`, `gateway_start/stop`, `cron_reconciled`, `cron_changed`, `before_install`, `skill_changed`. `before_tool_call`, `before_agent_run`, `before_install` fail closed at 15 s; observers log and continue (`reference.md:93-99`).
- **Skills**: a plugin lists `skills` dirs in its manifest; they load at the lowest precedence so a same-named workspace or managed skill overrides them (`docs/tools/skills.md:265-276`).

Loaded plugins are classified by what they registered: `plain-capability`, `hybrid-capability`, `hook-only`, `non-capability` (`architecture.md:71-90`).

## 3. Discovery and installation

Roots and precedence (`docs/plugins/manifest/package-json.md:125-135`): `plugins.load.paths` > source-checkout bundled > tracked global install (`~/.openclaw/extensions`) > other bundled > workspace (`<workspace>/.openclaw/extensions`). Duplicate ids keep the winner only. Workspace-origin plugins are disabled by default (`docs/tools/plugin.md:209`).

Three tiers (`docs/plugins/plugin-inventory.md`, generated): 66 plugins in the core npm package, 96 "official external packages" installed on demand, 3 source-checkout only. All 165 live in the monorepo's `extensions/`.

Install (`docs/tools/plugin.md:116-144`): `openclaw plugins install <spec>` from `clawhub:`, `npm:`, `git:github.com/<owner>/<repo>@<ref>`, `--link ./dir`, `--marketplace <src>` (Claude marketplaces), archives. For unpinned npm specs the installer walks back to the newest version whose `compat.pluginApi` fits the host. Installs apply to the running Gateway; a plugin whose runtime fails stays installed with the failure visible (`docs/plugins/manage-plugins.md:62-69`). Gates in order: `security.installPolicy` (operator-owned local command returning allow/warn/block over the staged source; `--force` cannot override a block; `docs/tools/plugin.md:146-175`), capability consent (§4), `before_install` hooks of loaded plugins.

Skills install separately: `openclaw skills install @owner/<slug>` into workspace `skills/`; `openclaw skills verify @owner/<slug>` fetches the `clawhub.skill.verify.v1` envelope and exits non-zero on a failed scan (`docs/tools/skills.md:334-396`). ClawHub publishes skills with `clawhub skill publish` and plugins with `clawhub package publish`; code plugins must carry `compat.pluginApi` and `build.openclawVersion` (docs.openclaw.ai/clawhub).

**Compatible bundles** (`docs/plugins/bundles.md`): Agent Plugins (`plugin.json`), Codex (`.codex-plugin/`), Claude (`.claude-plugin/`), Cursor layouts are detected and their skills, commands, hook packs, MCP servers, LSP defaults mapped in "without importing runtime code": "content packs with selective feature mapping and a narrower trust boundary". `VISION.md:86-93`: "Prefer bundle-style plugins when they can express the capability. Use code plugins when the capability needs runtime hooks, providers, channels, tools, or other in-process extension points."

## 4. Trust and permissions

`docs/plugins/architecture.md:915-921`: native plugins "run in-process with the Gateway. They are not sandboxed. A loaded native plugin has the same process-level trust boundary as core code"; "a malicious native plugin is equivalent to arbitrary code execution inside the OpenClaw process." Issue #66887 (closed 2026-04-15) is the operational version: one third-party plugin's `info.id` mismatch after an update took every channel down.

Around that boundary:

- **Capability consent** (`manage-plugins.md:137-199`): before install/enable of a third-party plugin the operator sees declared channels, providers, tools, hooks, MCP servers, CLI commands, skills, dangerous config flags. The acceptance token "hashes the exact declared capability surface, not the plugin's executable files"; a widened surface needs fresh consent; local-path installs re-prompt every time. Bundled and catalog-verified official plugins skip it.
- **Hook grants** (`docs/plugins/hooks.md:118-146`): non-bundled plugins need `plugins.entries.<id>.hooks.allowConversationAccess: true` for prompt/transcript hooks; `allowPromptInjection: false` blocks prompt-shaping hooks. "These are specific registration gates, not a sandbox ... Install only plugins you trust."
- **Trust-gated calls**: `dispatchHookAgentTurn`, `registerTrustedToolPolicy` refuse unless provenance is `bundled` or `trusted-official`; `--link`/`--force` do not grant it (`docs/tools/plugin.md:356-394`).
- **Per-call approvals**: `before_tool_call` may return `requireApproval` (title ≤80 chars, description ≤512, severity, allowed decisions, typed `scope` such as `message-send`/`payment`/`external-post`) routed through the chat approval UI (`docs/plugins/plugin-permission-requests.md`). Optional tools are the discovery-time gate; this is the per-call gate.

## 5. Versioning and updates

All plugin APIs are experimental: "These contracts can change between OpenClaw releases. Pin the OpenClaw version used to develop and deploy your plugin" (`docs/plugins/sdk-overview.md:25-36`). Versions are dates (`2026.9.9`); `compat.pluginApi` and `install.minHostVersion` are semver floors over them.

A compat registry (`src/plugins/compat/*.ts`, `docs/plugins/compatibility.md`) records each contract as `active`/`deprecated`/`removal-pending`/`removed` with an owner and a `removeAfter` date or named gate. Policy: never remove in the release that adds the replacement; adapter, diagnostics, docs, tests of both paths, wait, remove "only with explicit breaking-release approval"; windows capped at three months. On 2026-08-29 all 44 doctor compat records were renewed to 2026-11-29.

The actual breaks: 2026.3.22 removed `openclaw/extension-api` "with no compatibility shim" (`CHANGELOG/2026.3.22.md:9`); 2026.4.25 removed `registerEmbeddedExtensionFactory`; the July 2026 sweep removed the root SDK barrel and manifest/provider/runtime aliases; 2026.7.2-beta.5 broke `@larksuite/openclaw-lark`; 2026.10.1-beta.1 removed four subpaths (`infra-runtime`, `channel-message`, `command-auth`, `config-runtime`) and broke `@tencent-weixin/openclaw-weixin`, a channel OpenClaw's own setup recommends, and the migration doc says some removed helpers (file locking) have no typed replacement (issue #166404, open 2026-10-07, beta blocker). Ten more annotation families are `removal-pending` as of 2026-10-01.

So: a formal deprecation process, and a third-party channel plugin breaking about once a quarter anyway. What mitigates it is the installer walking back to a compatible version and the Gateway keeping a failed plugin inert instead of crashing.

## 6. Skills vs plugins, and what the community builds

A skill is a folder with `SKILL.md` (AgentSkills frontmatter: `name`, `description`, optional `user-invocable`, `command-dispatch: tool`, gating by `metadata.openclaw.requires.{bins,anyBins,env,config}` and `os`; `docs/tools/skills.md:438-560`). No code; it teaches the agent to use tools that exist. A plugin is code that adds tools, channels, providers, hooks, UI. Bundles sit between: skills plus MCP/hook metadata, no in-process code.

Counts:
- `extensions/`: 164 manifests. `categories`: models 56, channels 25, voice 16, web 10, infrastructure 9, developer-tools 8, security 7, media 7, memory 5, the rest ≤4. By declaration: 61 register providers, 30 declare `contracts.tools`, 28 channels, 15 ship skills, 6 declare UI, 2 are `kind: memory`. Model providers and chat channels are two thirds of the tree.
- Bundled skills: 50 in `skills/`, 20 `SKILL.md` inside `extensions/`, plus `custodian-skills/`.
- ClawHub (fetched 2026-10-09): plugins page header "Plugins 2.4K"; a community index counted 13,729 skills on 2026-02-28 (5,705 on 2026-02-07). Of the 25 most-downloaded plugins, 22 are `@openclaw` (WhatsApp 195k, Matrix 54.9k, Codex 51.7k, DeepSeek 24k, Discord 17.6k, Memory LanceDB 15.7k). The three third-party entries: a Chrome-extension channel (`@sider`, 20.3k), a prompt-injection filter (`@gendigital`, 20k), a context engine (`@openviking`, 8.8k). Each needs in-process hooks or a slot.

What went wrong:
- **ClawHavoc** (Koi Security, 2026-02-01; incidentdatabase.ai/reports/6951): of 2,857 ClawHub skills audited, 341 malicious; 335 used a fake "Prerequisites" section telling users to paste a script that installed Atomic Stealer. Skills carry no code, so the attack was social: the SKILL.md told the human what to run. Publishing required a GitHub account at least one week old. Response: user reporting (auto-hide after 3 unique reports), then scan state on listing pages and `openclaw skills verify`.
- Host updates breaking plugins OpenClaw itself recommends (§5).
- One bad plugin taking the Gateway down (#66887).

Reading: the community writes skills by the ten-thousand and code plugins by the hundred; the code plugins that gain traction outside the core team are channels and hook-only policy filters. OpenClaw's own vision (`VISION.md:71-99`) now steers authors to bundles first, to hosting in their own repos, and says "the bar for adding optional plugins to core is intentionally high", while 165 plugins still live in the monorepo.

## 7. Dispositions for Bee Box

OpenClaw's nine months answer the question from the other side: what costs them most is the in-process code API, what people author is prose, and their guidance now says bundle first.

1. **Reject** an in-process registration SDK (60 `register*` methods, typed hook catalog, compat registry). Bee Box compiles code surfaces into beebox (`beebox/src/connectors/`, commands) by design ([compare-skills-tools §1.4](compare-skills-tools.md)); a box is single-user and its agent already has host power. The SDK buys provider and channel breadth Bee Box does not want, at the price of a quarterly third-party break and a documented "not sandboxed" boundary. Connectors stay beebox source changes.
2. **Adopt** bundle-first as the definition: a Bee Box plugin is a **content pack of existing pieces**, not a new runtime kind. Contents are the boxholder's 2026-09-24 list in the issue: docs, a trigger skill, command-line tools (tricks), views, schema stubs. Each already has a loader (`config/schemas/` via `src/core/schema-watcher.ts`, box `src/views/`, `config/procedures/`, `src/tricks/`, managed skills under `.claude/skills/`). This matches the Omi and TiddlyWiki evidence in the issue: the extension people use is a prompt at a hook; code is the escalation.
3. **Adapt** manifest-before-code. One manifest per bundle listing what it contributes (card types, view names, trick names, skill names), read and validated before activation: schema compile, view typecheck against `beebox/{cards,schema,view-widgets}`, name-collision check against the box. OpenClaw's `contracts` block is the model: declare ownership statically so the host can route and detect conflicts without loading. Skip plugin `configSchema`; box config is cards.
4. **Adapt** low-precedence overlay. OpenClaw loads plugin skills lowest so a same-named box skill wins (`docs/tools/skills.md:270`). Apply it to every bundle piece: bundle contributes, box-local same-name overrides, and a bundle update to a piece the box edited parks the way template updates park today (`_config/template-versions.json`). This is the issue's "schema stub the agent extends" and TiddlyWiki's shadow-tiddler finding, with parked templates as the existing implementation.
5. **Adapt** the compat floor, not the compat registry. A bundle's `package.json` declares a `beebox` peer range; the public specifiers are the only API it may import; activation refuses out-of-range bundles with a message. No deprecation-adapter registry: OpenClaw needed one for 60 entry points and dozens of SDK subpaths; three specifiers do not. Keep OpenClaw's honesty of calling the boundary experimental until a second party builds against it.
6. **Reject** a registry now; distribution is a git remote or an npm dependency of the box package (the box already has `package.json` and `node_modules`). ClawHub shows an open registry plus a weak publish gate becomes a scanning programme (ClawHavoc), and downloads concentrate in first-party packages anyway (22 of 25). Revisit when a second box wants a bundle someone else wrote.
7. **Later**: the capability-consent listing (show the human what a bundle declares before it activates; re-ask when the surface widens). Cheap once item 3 exists; matters once third-party bundles exist. Also later: `plugins inspect --runtime`'s cold-versus-live distinction as a `bbx doctor` line per bundle ("declared X, loaded Y").
8. **Reject** exclusive slots. OpenClaw needs them because memory and context engines are swappable; in Bee Box memory is the medium (cards, git, retrieval) and stays in core per the issue's medium/content line.
9. **Reject** plugin-owned UI pages and Control UI replacements. Bee Box views are box-authored `.tsx` compiled against `beebox/view-widgets`; that is already the plugin UI surface and stays under the same typecheck rather than a default-off lab running with operator authority.

Net: yes to a plugin system, defined as a named bundle of pieces a box can already hold plus a manifest and a version floor; no new runtime kind; a distribution mechanism second. The next artifact is the per-subsystem medium/content decision the issue asks for, with items 3-5 as the mechanism.
