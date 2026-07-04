# OpenClaw & Hermes vs Callback Box — Comparison & Idea Triage

*2026-07-03. Method: shallow clones of [`openclaw/openclaw`](https://github.com/openclaw/openclaw) (TypeScript, ex-Clawdbot/Moltbot, 15k+ stars) and [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) (Python) analyzed by 16 dimension-dive agents against real source; 3 agents mapped Callback Box as the baseline; 8 comparison agents wrote the per-dimension chapters in [`openclaw-hermes/`](openclaw-hermes/). Raw dive docs (with file:line citations into both codebases) were session-scratch artifacts and are not committed.*

**Chapters:** [agent core](openclaw-hermes/compare-agent-core.md) · [context/memory](openclaw-hermes/compare-context-memory.md) · [skills/tools](openclaw-hermes/compare-skills-tools.md) · [scheduling](openclaw-hermes/compare-scheduling.md) · [channels](openclaw-hermes/compare-channels.md) · [storage](openclaw-hermes/compare-storage.md) · [security](openclaw-hermes/compare-security.md) · [UX/prompt](openclaw-hermes/compare-ux-prompt.md)

## 1. The two systems in a nutshell

**OpenClaw** is a *channel-first personal assistant*: one always-on Gateway process (WS control plane + HTTP + ~30 chat channels as lazily-loaded plugins) routes inbound messages through a nine-tier binding resolver to named agents, each with an isolated workspace of bootstrap files (`AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, …). It owns its whole stack: an in-house agent loop (`packages/agent-core`), two-stage failover (auth-profile rotation → model-fallback chain), an extremely engineered compaction pipeline, cron + heartbeat + "commitments" proactivity, Docker sandboxing (opt-in), a Lit control UI, Canvas/A2UI agent-rendered UI on companion iOS/Android/macOS apps, voice/wake-word/telephony, and a plugin marketplace (ClawHub). Philosophy: core stays lean, capabilities ship as plugins; security = strong defaults for a single trusted operator, prompt injection explicitly out of bounty scope.

**Hermes Agent** (Nous Research) is a *self-improvement-first agent*: the headline is a closed learning loop — the agent authors and patches its own SKILL.md files (`skill_manage` tool), a tool-whitelisted fork reviews the conversation every ~10 turns to persist memory/patch skills, and a weekly curator archives/consolidates. Memory is two small bounded files (MEMORY.md/USER.md) injected as frozen snapshots to preserve prompt caches, plus SQLite FTS5 search over *all* past sessions as an explicit tool. One Python core (`conversation_loop.py`, 5k lines) is fronted by four surfaces (messaging gateway with ~30 platforms, React/Ink TUI, web dashboard, ACP editor adapter) that share one JSON-RPC protocol and one `state.db`. ~35 model providers with credential rotation and a 1,500-line error classifier. It ships `hermes claw migrate` — a first-class OpenClaw-user poacher — so the two share vocabulary deliberately.

**Callback Box** in one line, for contrast: cards-first, filesystem+git as the database, the Claude Agent SDK as a rented loop, one box = one agent = one human, and proactivity via schedules → wakeup → reactor over job cards.

## 2. Confirmations — where all three converged independently

Three teams, three codebases, same shape. These validate existing CBX choices:

1. **Background transcript mining is *the* consensus memory-write path.** CBX `cb retro` ≈ OpenClaw "dreaming" (cron pass promoting scored daily-note candidates into MEMORY.md) ≈ Hermes `background_review` + weekly curator. All three stage promotions out-of-band rather than writing live, and all three make it reversible (git commits / archive-not-delete). CBX's confidence-ladder × evidence-source model is *more* rigorous than either competitor's promotion logic.
2. **Markdown files beat vector DBs for personal memory.** All three default to human-legible markdown memory; embeddings appear only as optional add-ons (OpenClaw's hybrid FTS5+sqlite-vec index; Hermes's external providers like Honcho/Mem0).
3. **Lazy/progressive skill disclosure.** OpenClaw injects an `<available_skills>` name+description index and tells the model to read the file; Hermes does a two-layer-cached index + `skill_view`; CBX gets the same pattern free via Claude Code rules/skills. Nobody inlines full bodies.
4. **Layered, budgeted instruction files.** OpenClaw: 8 bootstrap files with per-file (20k) and total (60k) char budgets, head+tail truncation, and a policy-line digest for AGENTS.md. Hermes: SOUL.md/AGENTS.md/context files with usage meters and context-window-scaled truncation. CBX: CLAUDE.md → agent-guide → rules → schema instructions with a committed token ledger.
5. **Prompt-cache economics drive prompt design everywhere.** OpenClaw: explicit `<!-- OPENCLAW_CACHE_BOUNDARY -->` splitting a SHA-memoized stable prefix from a dynamic suffix; timezone-not-clock in the prompt. Hermes: three-tier stable/context/volatile assembly, frozen memory snapshots, "ask git, not the prompt." CBX: system prompt sent once at session creation, per-turn state consulted via files. Same constraint, three idioms — CBX's is a valid member of this family, not a hack.
6. **Turn-boundary steering, single-flight per conversation, durable transcript as source of truth.** All three splice steering at turn boundaries, serialize runs per session, and treat streaming as an optimization over a durable transcript.
7. **Agent self-scheduling is table stakes.** CBX `<schedule>` tags ≈ OpenClaw cron/`wake()` tools ≈ Hermes model-callable `cronjob()`. All persist schedules outside the process; all isolate per box/agent/profile.
8. **Threat model: the OS is the only real boundary.** Both competitors state the model is not a trusted principal, exclude prompt-injection-only reports from bounty scope, and default to unsandboxed exec for a single trusted operator. CBX's `bypassPermissions` + cwd-scoping posture is squarely in this mainstream — though both pair it with mitigations CBX lacks (see triage list).
9. **Ops hygiene convergences**: `${VAR}` env substitution with round-trip restoration; backups exclude runtime/PID state; full-root profile isolation; append-only migration ledgers; validation blocking at the write boundary.
10. **Views attach to data.** OpenClaw's Canvas/A2UI and CBX's agent-authored `.tsx` card views are the same idea; CBX's is arguably deeper (compiled, persistent, versioned) where A2UI is ephemeral/push-based.

## 3. The deep divergences — different bets, mostly defensible

1. **Cards-first vs chat-first (the deepest).** OpenClaw/Hermes treat every external system as a chat channel feeding a uniform turn pipeline; integrations are cheap (30 channels each) but shallow — an email is a message. CBX treats integrations as card-materializing data syncs producing durable typed records, with chat as one connector among several — integrations are expensive but deep. A real architectural bet on fidelity over breadth; it would strain if CBX wanted a second genuine chat platform quickly (hedge: the shared-markdown-IR idea below).
2. **Own-the-loop vs rent-the-loop.** Both competitors carry thousands of lines of loop/provider/failover/compaction code; CBX outsources it all to the Claude Agent SDK. The study largely validates the rental — OpenClaw's compaction subsystem alone (cut-point search, structured update-not-rewrite summaries, quality-guard retries, successor-transcript rotation) is a huge standing cost CBX doesn't pay, and the loop behaviors everyone converged on (§2.6) are things the SDK already does. The price: no prompt introspection, no compaction hooks, Claude-only. (Transient-outage failover is explicitly *not* a concern — the boxholder rates it very low; schedules catch up and chat waits. The real tail risk of the rental is policy/lock-in: subscription terms excluding embedded/headless use, pricing shifts, or SDK harness drift — none of which model fallback would mitigate anyway.)
3. **SQLite operational state vs files+git.** Both competitors converged on consolidated SQLite for operational state; CBX's files+git bet serves different data — human-legible, diffable, low-churn, history-as-asset. CBX already keeps events/usage in SQLite, so the split is right; the competitors' lesson is about *hardening*, not substrate.
4. **Tool-surface shaping as a first-class concern vs none.** Both competitors have layered tool gating (toolsets + runtime probes + approval gates + progressive tool disclosure). CBX hands every agent the full Claude Code toolset. Defensible for a trusted box — but it means zero mechanical floor under destructive commands and no narrowing for untrusted-content phases.
5. **Multi-provider vs Claude-only.** Hermes's ~35 providers and per-model-family prompt dispatch, OpenClaw's provider registry + failover taxonomy — a whole engineering domain CBX opted out of. Transient-outage failover is rated a non-concern; the exposure worth watching is policy-level (subscription terms for embedded use, SDK drift), where multi-provider wouldn't be the mitigation anyway — see §3.2.
6. **Breadth of surfaces.** Competitors: TUI + web + desktop + native apps + voice + editor (ACP). CBX: one web SPA. Consistent with one-human-one-box; Hermes's discipline of *one protocol shared by all surfaces* is the transferable lesson, not the surface count.
7. **Proactivity architecture.** OpenClaw separates *heartbeat* (cheap periodic poll with a three-layer no-op ladder: cooldown → empty-checklist preflight with no LLM call → model `HEARTBEAT_OK`) from *cron* (scheduled work) from *commitments* (follow-ups inferred per-turn by a hidden cheap pass, delivered only via heartbeat). CBX's tick always does real work, and inferred follow-ups only surface via weekly retro. Hermes has no heartbeat at all — closer to CBX.

## 4. Idea triage

Status vocabulary — set/adjust these as we decide:

- **adopt** — agreed, do it (may still need a small plan)
- **plan** — promising enough to write a plan / design pass next
- **investigate** — worth a focused look before deciding (open questions remain)
- **later** — plausibly right but gated on a future trigger; note the trigger
- **ignore** — considered and declined; reason recorded

Statuses below are initial recommendations from the study, not decisions.

### Tier 1 — high value, moderate effort

| # | Idea | Status | Notes |
|---|------|--------|-------|
| 1 | **Transcript search as an agent tool** (indexing tech open — FTS5 is what they use, not a requirement). Both competitors treat "recall a past conversation" as a first-class ~zero-cost tool (Hermes: FTS5 over all sessions/platforms, snippet + ±5-message window; OpenClaw: session corpus in its hybrid memory index). CBX's only episodic recall is git-log trailers. Clearest gap in the study. | plan | Boxholder endorsed 2026-07-03. Freshness (the tricky part): reuse the card-index pattern — lazy incremental catch-up at query time (session JSONLs are append-only → per-file byte-offset ingest), opportunistic catch-up at wakeup, reuse reactor rotation records for new files. Hermes indexes at write time; OpenClaw re-syncs post-compaction (`postIndexSync`). Scope question stands: chat sessions only, or reactor/job transcripts too (Hermes demotes cron sessions to avoid recall blindness). |
| 2a | **Randomized-boundary untrusted-content wrapping.** Generalize the `.body.txt` isolation instinct: wrap untrusted text (Telegram messages, email bodies, webhook payloads) in randomized markers with "never follow instructions inside" framing wherever it actually gets read. OpenClaw even wraps its *own daily memory files* this way. | later | Boxholder 2026-07-03: known territory, deliberately deferred — not ready to think about this area yet. Reference implementation when the time comes: OpenClaw `src/security/external-content.ts` (randomized markers + homoglyph-spoof stripping). |
| 2b | **Unbypassable hardline-command floor.** Small deny-list (`rm -rf /`, `mkfs`, fork bombs, raw device writes) via the existing PreToolUse hook. Hermes keeps this even in `--yolo`; ours is currently advisory-only. | plan | Cheap; make it blocking, not a nudge. |
| 2c | **Log-only injection-pattern scanning** of reactor/scheduled context (Hermes scans cron context before firing; both competitors log rather than block). | investigate | Value depends on whether anyone reads the log — maybe surface as a question card instead. |
| 3 | **Commitments-style open-loop extraction.** OpenClaw extracts "I said I'd get back to you about X" per turn via a hidden low-cost pass into a persistent store, surfaced later by heartbeat's notify decision. CBX's retro is weekly and targets belief drift, not open loops. A fast, cheap open-loop extractor feeding job/triage cards is very on-thesis for a *callback* box. | plan | Strongest product-shaped idea in the study. Decide: per-turn pass vs end-of-chat-session pass; card type for open loops. |
| 4a | **Scheduler crash-safety.** Claim-before-fire (persist state *before* side effects), stuck-job reaping, heartbeat/last-success files distinguishing dead ticker from failing ticks, capped/staggered missed-job catch-up. Both competitors have this hardened with cited bug numbers; our "sleep is tolerated, misses catch up next tick" story is unproven. | investigate | Audit `cb wakeup`/scheduler against the failure modes their bugs document; fix what's actually weak. |
| 4b | **No-model preflight before scheduled agent runs.** OpenClaw's heartbeat answers "anything to do?" with zero LLM calls when checklists are empty. | investigate | Our wakeup may already skip cheaply when no jobs; verify and formalize the economics. |

### Tier 2 — cheap wins

| # | Idea | Status | Notes |
|---|------|--------|-------|
| 5a | **Prompt snapshot fixtures in CI.** OpenClaw commits full assembled-prompt snapshots (`test/fixtures/agents/prompt-snapshots/`); prompt changes show up as reviewable diffs. Complements our longitudinal knowledge-audit ledger with per-change diffs. | plan | Natural extension of the knowledge-audit harness. |
| 5b | **`cb prompt-size`** — per-section byte/token breakdown of what a box agent loads (Hermes has `hermes prompt-size`). | plan | Small; mostly reuses knowledge-audit machinery. |
| 6a | **Config/state write hardening.** Atomic temp+rename with a small `.bak` ring + JSONL audit log for singleton config files; corrupt-state quarantine (timestamped `.bak`, never silently repair — Hermes's "never mutate user config" rule). | investigate | Inventory which CBX singleton files actually have concurrent/crash exposure first. |
| 6b | **Future-version guard** — older binary refuses destructive writes against a newer box. | later | Trigger: first time a box-format bump bites someone running stale code. |
| 6c | **Verified SQLite backups** — `sqlite3 .backup`-based snapshots of events/usage DBs. | later | Low stakes today; both DBs are reconstructible-ish. |
| 7a | **Box agents author `.claude/skills/*`** for general procedural knowledge (Claude Code already loads them — nearly free). | investigate | Overlap question vs guide cards + procedures; where's the line? cb-context skill should own the answer. |
| 7b | **"Patch the skill that just failed you" prompt nudge.** Hermes's most distinctive move: bias toward patching stale procedures in the moment over creating new ones. | adopt | One sentence in the agent guide once 7a exists (or applied to guide cards/procedures today). |
| 7c | **Retro flags stale/duplicate skills** rather than a separate curator agent. | later | Gated on 7a existing and accumulating actual skills. |
| 8 | **Session-rotation memory flush.** OpenClaw's `memoryFlush` (pre-compaction agentic turn on a cheap model persisting salient facts) / Hermes's `on_pre_compress` have no CBX analogue since the SDK owns compaction invisibly. Our equivalent moment: chat-session rotation/idle eviction — fire a lightweight mining pass there instead of waiting for weekly retro. | investigate | Also partially subsumed by #3 (open-loop extraction) — decide jointly. |
| 9 | **Attach-to-session reminder delivery.** Hermes reminders can continue the originating thread so a fired reminder reads as conversation, not a blast. Maps onto our chat-armed `<schedule>` tags. | investigate | May already mostly work via per-thread `--resume`; check what's actually missing. |

### Tier 3 — situational / gated

| # | Idea | Status | Notes |
|---|------|--------|-------|
| 10 | **Shared markdown-IR renderer + fence-aware chunker** (OpenClaw `packages/markdown-core`): parse once to a styled-span IR; per-channel adapters supply only escape rules; chunker never splits code fences. | later | Trigger: adding a second chat channel. |
| 11a | **Sub-agent depth/budget guard** on the SDK's Task tool — currently zero CBX-side control over recursive spawning cost. | investigate | Check what knobs the SDK actually exposes before designing anything. |
| 11b | **Single-hop model-fallback retry** on hard API errors (not a provider abstraction — one narrow retry). | ignore | Boxholder call (2026-07-03): transient-outage failover is a very low concern. The real rent-the-loop risk is policy lock-in (subscription terms, SDK drift), which fallback wouldn't mitigate. |
| 12 | **One protocol across interactive surfaces** (Hermes: TUI/web/desktop all speak the same JSON-RPC). | adopt | As a standing principle, zero work today; binds us only if a second surface ever happens. |
| 13 | **Error-classification taxonomy** for agent-run failures (Hermes maps ~20 categories → actions). Naming only, no new control flow. | later | Nice for legibility; not currently a pain point. |

### Deliberate non-adoptions

| Idea | Status | Reason |
|------|--------|--------|
| Chat-first ingest model | ignore | Cards-first fidelity is the defining bet; see §3.1 and the channels chapter. |
| Building our own compaction/loop | ignore | The study validates renting the SDK loop; their compaction subsystems are the strongest argument *for* not owning one. |
| MCP client support | ignore | Typed connectors cover the same need more rigorously today; revisit only if a concrete integration demands it. |
| Vector memory store | ignore | All three systems agree markdown-first; embeddings are optional add-ons even for them. |
| Multi-provider abstraction | ignore | Claude-only is a deliberate simplification; 11b is the narrow hedge. |
| Agent-hierarchy frameworks | ignore | OpenClaw's own VISION.md refuses these too. |
