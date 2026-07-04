# Channels, Gateway, Connectors — CBX vs. OpenClaw vs. Hermes

Factual comparison across the three systems' handling of external message/data
sources: the adapter contract, inbound routing, outbound formatting, and the
deeper question of what a "channel" even is. Sources: `cbx-proactivity-context.md`
(§4 connectors), `cbx-data-model.md` (§5 chat-thread cards), `openclaw-gateway-channels.md`,
`hermes-gateway-channels.md`.

## 1. Side-by-side

### Channel abstraction & adapter contract

- **CBX**: no channel abstraction — a **connector interface**: `{ name, produces,
  sync() }`. `sync()` pulls, writes/updates cards, commits with git trailers,
  optionally pushes, returns `{success, created, updated, pushed?, jobs?, error?}`.
  Four connectors total (Telegram, Google Calendar, Gmail, Google Drive), each
  hand-written against this one interface — no plugin loader, no capability
  declaration, no marketplace. Telegram alone is a real two-way *conversational*
  channel; the rest are one-way-ish data syncs with an optional push.
- **OpenClaw**: a rich `ChannelPlugin` contract (`id`, `meta`, `capabilities`,
  `config` required; ~25 more optional adapters — pairing, security, groups,
  mentions, outbound, streaming, threading, commands, agentTools, etc.).
  Capability declaration (`ChannelCapabilities`: chatTypes, polls, reactions,
  edit, threads, tts.voice, nativeCommands...) lets generic gateway code branch
  on what a channel *can* do rather than hardcoding per-channel logic. ~30
  channels shipped, most external as separate npm/ClawHub packages loaded lazily
  through a "registration mode" ladder (`cli-metadata → tool-discovery →
  discovery → full`) so listing/help doesn't pay full-load cost.
- **Hermes**: two-tier — built-ins hardcoded in a legacy if/elif adapter-creation
  chain (`_create_adapter`), and a `PluginManager`-discovered plugin tier
  (`plugin.yaml` + `register(ctx)`) that inserts a `PlatformEntry` (adapter
  factory, check_fn, validate_config, required_env, setup_fn) into a global
  registry, also lazily imported to dodge heavy SDK import cost. All adapters
  subclass one 5,623-line `BasePlatformAdapter` ABC. ~30 platforms, deliberately
  including scale outliers (three separate iMessage paths, two WhatsApp paths).

### Inbound routing → session mapping

- **CBX**: connector `sync()` writes/updates a card and (for chat) creates a
  `chat-job` card carrying a `source` filter; the reactor's chat-jobs path picks
  it up and resumes (or starts) a Claude Code session keyed by thread ref in
  `.callback-box/chat-sessions.json` (reactor path) or `chat-thread-sessions.json`
  (persistent per-thread `ChatSessionPool`, one live process at a time, parking/
  resuming). There is exactly one agent per box — routing decides *which
  session*, never *which agent*. No mention-gating, no allowlist tiers, no
  multi-agent binding resolution: a box is a single boxholder's single agent.
- **OpenClaw**: `resolveAgentRoute` walks nine binding tiers in strict priority
  (exact peer → thread-parent → peer-wildcard → guild+roles → guild → team →
  account → channel-wildcard → default) to pick an `agentId`, then derives a
  `sessionKey` (`agent:<agentId>:main` for DMs by default, or
  `agent:<id>:<channel>:group:<id>[:thread:<id>]`) governed by `dmScope`
  (main/per-peer/per-channel-peer/per-account-channel-peer). Purpose-built for
  **one gateway hosting many agents** across many channels/accounts, with
  broadcast groups fanning one inbound peer out to several agents in parallel.
- **Hermes**: `build_session_key()` = `agent:<namespace>:<platform>:<chat_type>:
  <chat_id>[:<thread_id>][:<participant>]`; namespace comes from a
  `multiplex_profiles` config letting one gateway process serve multiple
  Hermes profiles/credential scopes. DMs always per-user-isolated; group
  chats isolated per-user unless configured otherwise; threads shared across
  participants by default. The agent behind a session is an in-memory `AIAgent`
  cached by session_key (LRU cap 128, TTL 1h) — no subprocess-per-thread, unlike
  CBX's persistent-process-per-thread model.

### Outbound formatting

- **CBX**: no shared rendering layer — the agent authors markdown directly in a
  `chat-thread` card entry; delivery to Telegram is that connector's own
  concern. No documented chunking engine or markdown-IR abstraction.
- **OpenClaw**: `packages/markdown-core` defines a channel-agnostic Markdown IR
  (styled spans: bold/italic/strikethrough/spoiler/heading/code/code_block/
  blockquote/link) and one generic renderer,
  `renderMarkdownWithMarkers(ir, {styleMarkers, escapeText, buildLink})`. Each
  channel supplies only a marker map + escaping rules (e.g. Slack `mrkdwn`,
  Telegram markup) and reuses the same renderer — chunk-limit-aware rendering
  and channel-native markup happen in one pass. Chunking (`chunk.ts`) is fence-
  aware (never splits mid code-fence) with two modes (`length`/`newline`),
  configurable per channel/account.
- **Hermes**: no shared markdown IR described; each of the ~30 adapters formats
  its own outbound text. Streaming is more developed than CBX's — a
  `GatewayEventDispatcher` + `GatewayStreamConsumer` pipeline delivers
  incremental updates to platforms that support edits (e.g. Telegram streaming
  edits), and the TUI/web WS layer coalesces per-token frames into ~33ms
  batches.

### Data-ingest connectors vs. conversational channels

- **CBX**: explicitly splits its four connectors into a *conversational* one
  (Telegram, two-way chat) and *data-ingest* ones (Gmail, Calendar, Drive) that
  materialize cards — email threads, `.ics` files, sheet JSON — and are
  triaged/processed like any other inbox item, not "chatted with." Gmail bodies
  are deliberately kept **out** of agent-loaded frontmatter (a sibling
  `.body.txt`) so raw untrusted email content doesn't land in context
  automatically. Calendar/Drive have real two-way sync (content-hash diffing,
  conflict-naive) but are never a chat surface.
- **OpenClaw / Hermes**: no ingest/chat distinction exists at the architecture
  level — every external system is a **channel** feeding the same inbound →
  agent → outbound pipeline. Gmail-equivalent integration would be modeled as
  an "Email" channel adapter (Hermes actually ships one: IMAP/SMTP polling,
  15s interval, sender allowlist) producing chat turns, not cards. Neither
  system has a concept of "sync a read-only structured record store" distinct
  from "relay a conversation."

### Multi-agent routing / isolation

- **CBX**: one agent per box; "isolation" is achieved by having separate boxes
  (separate git repos, separate `~/src/boxes/<name>/`), not by an in-process
  routing layer. No concept of one gateway serving multiple agents.
- **OpenClaw**: `agents.list[]` — each a named workspace (`workspace`, `agentDir`,
  model, skills, sandbox, tools, own bootstrap files `AGENTS.md`/`SOUL.md`/
  `IDENTITY.md`/etc., own session store at
  `~/.openclaw/agents/<agentId>/sessions/`). One gateway process, many agents,
  routed to per-message by the binding-tier resolver above.
- **Hermes**: `multiplex_profiles` — one gateway process, multiple named
  profiles/credential scopes, namespaced into the session key. Less granular
  than OpenClaw's per-binding-tier routing (profile is closer to "which
  identity" than "which conversation gets which agent"), but four *entirely
  separate* interface subsystems (messaging gateway, TUI, web/desktop, ACP)
  each build `AIAgent` directly and share only the underlying `SessionDB` —
  a different kind of multi-surface isolation than OpenClaw's single-gateway
  model.

### Control-plane protocols

- **CBX**: tRPC over WebSocket for real-time (event-bus subscription,
  resumable per-turn chat stream), one deliberate raw-HTTP exception
  (`POST /chat/send`). No separate protocol for CLI vs. UI vs. connector
  control — `cb` CLI operates directly on the filesystem/git, not through a
  network control plane at all.
- **OpenClaw**: one **Gateway** process multiplexes WS control/RPC + HTTP APIs
  + plugin routes + Control UI on a single port. Custom WS protocol: `connect`
  handshake (role `operator`|`node`, scopes, optional signed device block) →
  `hello-ok` (feature discovery list, snapshot, negotiated auth, policy limits).
  Scope-gated broadcasts; two-stage agent-run RPC (`accepted` ack, then final
  `ok`/`error`, with streamed events between). A distinct **node** role
  (companion devices: camera/screen/canvas/system.run) is a separate concept
  from channels entirely — nodes never receive channel messages.
- **Hermes**: **no single protocol** — the messaging gateway is bespoke
  per-platform; but the TUI, web dashboard, and desktop app all speak the
  *same* JSON-RPC 2.0 dialect (`tui_gateway/server.py`, ~120 methods), over
  three transports (stdio, WebSocket, WS-mirror-to-sidecar) that are
  byte-identical at the frame level. The web server literally mounts
  `tui_gateway.ws.handle_ws` rather than reimplementing it. ACP is a fourth,
  separate protocol (stdio JSON-RPC per the ACP spec) for editor integration,
  sharing only the SessionDB and tool registry.

### Pairing / allowlists

- **CBX**: `config/box.json` allowed-emails style config; no formal
  code-based pairing flow described in the research docs.
- **OpenClaw**: device pairing for both operator and node roles at `connect`
  time (signed device block, `openclaw devices approve`, or CIDR-based
  auto-approve); DM/group access via per-channel `allowFrom` +
  `groupPolicy`/`groupAllowFrom`; a distinct **mention-gating** layer
  (`resolveInboundMentionDecision`) separately decides whether an authorized
  message becomes a live turn vs. stored-as-context, with an "implicit
  mention" concept (reply-to-bot, quoted-bot, bot-thread-participant) and a
  command bypass so `/status` still works unmentioned.
- **Hermes**: code-based pairing (`PairingStore` — salted-hashed codes, TTL,
  rate-limit, lockout, operator-only approval) as the escape hatch behind a
  fail-closed authorization chain (relay bypass → chat allowlists →
  per-platform env allowlists → adapter role auth → pairing → deny). A
  separate, finer slash-command access policy layer exists on top.

## 2. Confirmations — where CBX already matches

- **Telegram as thread cards ≈ session-per-conversation.** CBX's
  `chat-thread` card (`store/chat/<connector>/<ChatSlug>/thread.chat-thread.card`,
  an append-only `entries[]` array) is functionally the same idea as OpenClaw's
  `sessionKey`/Hermes's `build_session_key()` — a durable, addressable bucket per
  conversation that the agent's next turn resumes into. CBX's twist (the
  session *state itself is a git-tracked card*, not just a session-store row)
  is arguably a stronger persistence guarantee than either competitor's
  JSON/SQLite session stores, though at the cost of no shared markdown/chunking
  layer.
- **Per-box isolation ≈ per-agent workspace.** OpenClaw's `agents.list[]`
  entries (own workspace dir, own bootstrap files, own session store, own
  skills allowlist) are structurally identical to a CBX box (own git repo, own
  `CLAUDE.md`/agent-guide, own connector configs, own chat-session state) — CBX
  just achieves it by "one box = one git repo" rather than "one gateway
  process routing among many named workspaces." The isolation *properties*
  (separate credentials, separate context, separate session pool) match; the
  *mechanism* (OS-level separate directories/repos vs. in-process config
  entries) differs.
- **`seen` markers ≈ ambient/quiet context.** CBX's `chat-thread` entry kind
  `{ kind: "seen", callback-in?, wait-for?, text? }` — acknowledge without
  replying, optionally schedule a future re-check — covers similar ground to
  OpenClaw's "ambient room events" (unmentioned chatter fed as quiet context,
  no full turn) and Hermes's ability to receive-without-responding. All three
  systems recognize that "message arrived" and "agent should reply now" are
  different events.
- **Bot-loop / origin tagging.** CBX's connector-sync commit trailers
  (`Created-By`, `Pulled-By`, `Sent-By`) that distinguish who wrote what serve
  a similar disambiguation role to OpenClaw's explicit "bot loop protection"
  for bot-authored inbound messages — both are guarding against
  mistaking a system-authored write for new external input.

## 3. Divergences

- **Connector count and shape.** CBX: 4 connectors, hand-rolled, no plugin
  system. OpenClaw/Hermes: ~30 channels each, plugin-loaded, lazily imported.
  This is a direct function of scope — CBX serves one boxholder's small,
  fixed integration set (email/calendar/drive/one chat app); OpenClaw/Hermes
  are general-purpose messaging bridges meant to reach wherever a user's
  contacts already are. Trade-off: CBX's connector interface (`sync()`
  returning a result object) is trivial to read end-to-end in one sitting;
  OpenClaw's `ChannelPlugin` (30+ optional adapter fields) requires the
  capability-declaration machinery to stay legible at that scale, and Hermes's
  20,196-line `run.py` shows what happens when that machinery is skipped (a
  god-class held together by mixins, "organized by extraction not
  decomposition" per its own synthesis notes).
- **One agent vs. many.** CBX has no multi-agent routing because it has no
  multi-agent concept — a box *is* an agent (one boxholder, one identity, one
  filesystem-scoped context). OpenClaw's nine-tier binding resolver and
  Hermes's namespace/profile multiplexing solve a problem CBX doesn't have:
  many humans, many personas, or many isolated tasks sharing one always-on
  process. If CBX ever needed "one Telegram bot fronting several distinct
  boxholders" or "one agent identity split across several boxes," it would
  need to grow something like this — currently that's solved only by running
  separate box processes.
- **Streaming/incremental delivery.** Both competitors invest heavily in
  streamed partial output to the channel (OpenClaw's per-channel streaming
  adapter + `blockStreaming` capability flag; Hermes's `GatewayStreamConsumer`
  → `adapter.render_message_event()` incremental Telegram edits, plus 33ms
  frame coalescing on the JSON-RPC WS). CBX's SSE/tRPC turn-stream exists for
  the web chat UI but the docs don't describe an equivalent incremental-edit
  path for Telegram specifically — CBX chat sessions appear to deliver whole
  messages per turn to the connector-driven surface.
- **Control-plane unification.** Hermes's choice to have the web dashboard
  *literally reuse* the TUI's JSON-RPC-over-WS server (mounting the same
  handler rather than building parallel REST) is a distinctive piece of
  discipline neither CBX nor OpenClaw practices to the same degree — CBX has
  a tRPC-based single frontend protocol but no CLI-facing wire protocol at
  all (the `cb` CLI operates on the filesystem directly, no RPC layer to
  unify with); OpenClaw's Gateway multiplexes many concerns on one port but
  CLI/UI/node/operator are still distinct client roles within one protocol,
  not literally two different subsystems' servers being the same code.

### The deepest divergence: cards-first ingest vs. chat-first everything

This is worth treating as a real design fork, not just a feature gap.

OpenClaw and Hermes both model **every external system as a channel**: a
uniform inbound-event → route → agent-turn → outbound-reply pipeline, whether
the platform is Telegram, email (Hermes ships an IMAP/SMTP adapter), a generic
incoming webhook (OpenClaw's/Hermes's webhook adapters turn arbitrary HTTP POSTs
into agent turns via a route→prompt-template mapping), or an OpenAI-compatible
HTTP API. The unifying abstraction is **the conversation turn**: something
happened, optionally becomes context, optionally provokes a reply. This buys
enormous adapter-contract reuse — 30 platforms behind one dispatch mechanism —
and makes "hook up a new data source" cheap in the small (write an adapter,
normalize to `MessageEvent`, done).

CBX instead treats only Telegram as a conversation; Gmail, Calendar, and Drive
are **card-ingest** connectors whose job is to materialize durable, typed,
directly-editable state (an `email-thread` card, an `.ics` file, a sheet-as-JSON
directory) that then enters the *same* triage/pipeline machinery as a photo
capture or a voice memo — not a chat turn at all. The email body is
deliberately kept out of frontmatter specifically so it isn't context by
default. This is a strictly different ontology: OpenClaw/Hermes's world is
"messages, always"; CBX's world is "typed records that happen to sometimes
carry conversational ones."

The trade-off is real in both directions:

- **What chat-first buys them**: a new integration is "just another channel" —
  no separate data model, no triage pipeline, no card schema to design. Adding
  Signal or SimpleX or a webhook source is bounded, uniform work regardless of
  what the platform's data actually *is*. The cost is that anything which isn't
  naturally conversational (a spreadsheet, a calendar, a stream of receipts)
  either gets awkwardly chat-shaped (an agent "chatting" with itself about a
  new email) or needs a bespoke escape hatch outside the channel abstraction —
  and the docs for both systems don't describe one. Long-lived structured
  state (email dedup by Message-ID, calendar content-hash diffing, sheet
  formula preservation) has no obvious home in a channel/session model, whose
  natural unit of memory is a rolling conversation transcript, not a durable
  typed record with its own lifecycle directory.
- **What cards-first buys CBX**: email/calendar/drive data gets first-class
  identity — a person can `git log` a calendar file, `cb search` an email
  thread, or watch a card move `box/inbox/ → triaged/ → archive/` independent
  of any conversation ever happening about it. Triage confidence levels,
  landmarks, schemas, and validation all apply uniformly to ingested data
  the same way they apply to agent-authored content. The cost is that CBX has
  no answer for a genuinely chat-native, high-volume, many-platform world —
  extending to WhatsApp/Slack/Discord/SMS would mean either building N more
  Telegram-shaped two-way chat connectors (each bespoke, no shared adapter
  contract) or bolting on something OpenClaw/Hermes already solved generically.
  CBX's "connector" interface was never designed for chat-platform diversity;
  it was designed for a handful of structured data sources plus one chat app.

Put differently: OpenClaw/Hermes optimize for **breadth of channel**, CBX
optimizes for **depth of ingested-record fidelity**. Neither choice is wrong;
they reflect different product bets (OpenClaw/Hermes: be reachable everywhere
a user's contacts are; CBX: be a trustworthy long-term record of a single
boxholder's structured life). CBX's bet only holds up as long as most of its
integrations really are record-shaped rather than conversation-shaped — the
one place it already isn't (Telegram) required a special-cased two-way
connector that doesn't generalize, which is a soft signal that the
architecture would strain if CBX wanted to add a second or third genuine
chat platform.

## 4. Steal-this — prioritized for CBX

1. **A shared markdown-IR + chunking layer for outbound chat, modeled on
   OpenClaw's `packages/markdown-core`.** Today CBX's chat-authoring path
   trusts each connector to handle its own markdown-to-platform rendering, and
   there's no documented chunking strategy at all. If a message exceeds
   Telegram's length limit or contains a code fence, that's currently
   unhandled or handled ad hoc. Effort: **small-medium** — one IR + one
   Telegram marker map, ported as a single-connector need; pays for itself
   the moment a second chat channel is added, since the alternative is
   re-deriving chunking/escaping from scratch per channel. High leverage
   relative to cost because it's a prerequisite for steal-this #2.

2. **Mention-gating / visible-reply-gating pattern for any future group chat
   surface.** CBX's Telegram connector is presumably DM-oriented today; if
   CBX ever adds group chats (a shared Telegram group, a Slack channel), it
   will need OpenClaw's `requireMention` + implicit-mention (reply-to-bot,
   quoted-bot) + `groupChat.visibleReplies` (automatic vs. tool-gated) pattern
   to avoid the agent replying to every unrelated message in a group. Effort:
   **medium**, but only worth building *when* a second conversational surface
   is actually added — no reason to build ahead of need given CBX's
   single-boxholder scope. Flag now, build later.

3. **Incremental/streamed outbound delivery to Telegram**, mirroring Hermes's
   `render_message_event` streaming-edit path. CBX already has an SSE/tRPC
   turn-stream for the web UI; extending the same event stream to drive
   incremental Telegram message edits (where the Bot API supports it) would
   make long agent replies feel responsive on that surface too, not just in
   the web app. Effort: **medium** — the streaming infrastructure already
   exists on the CBX side (`events.turnStream`), so this is "wire an existing
   pipe to a second destination" rather than new plumbing. Worth doing
   opportunistically, not urgently.

4. **A card-ingest generalization for "channel-native structured data" as
   an alternative to naive per-platform reimplementation, if CBX broadens
   beyond Gmail/Calendar/Drive.** Rather than copying OpenClaw/Hermes's
   channel abstraction wholesale (which would fight CBX's cards-first
   ontology), the higher-leverage move if CBX wants more integrations is to
   extend the *connector* interface's shape — not adopt a chat-turn
   abstraction — since most candidate integrations (Notion, a bank feed, a
   to-do app) are naturally record-shaped like Gmail/Calendar, not
   conversation-shaped. Effort: **low** per new connector once the interface
   is proven, since the `{name, produces, sync()}` contract already
   generalizes across the four in-place connectors. This isn't "steal from
   them" so much as "don't steal from them here" — worth stating explicitly
   as a considered non-adoption, given how central the chat-first model is to
   both competitors' architectures.

5. **One protocol across surfaces, if/when CBX grows a second interactive
   client** (e.g. a CLI-driven chat mode alongside the web UI). Hermes's
   choice to have the web dashboard mount the TUI's exact JSON-RPC server
   rather than build a parallel API is the kind of discipline worth
   pre-committing to now, before a second surface exists, so it doesn't get
   bolted on as a divergent REST API later. Effort: **low now** (a design
   principle to write down), **expensive later** if ignored until a second
   surface is half-built on a different protocol. Lowest priority only
   because CBX doesn't currently have a second interactive surface in
   progress — but cheap to note as a constraint for whoever builds one.

## Addendum (2026-07-04): what OpenClaw's multi-agent routing is *for*

Boxholder question: why isn't there just one agent? Answer from their docs (`docs/concepts/multi-agent.md`): by default there IS one agent (`agentId: main`); multi-agent is opt-in for running several distinct relationships/personas out of one gateway process (`openclaw agents add work|coding|social`). An "agent" = full scope: workspace (SOUL.md persona, AGENTS.md, USER.md), per-agent auth profiles/credentials, session store, skill allowlist. Bindings route channel accounts to agents (two WhatsApp numbers → two agents; a Discord guild of strangers → a restricted agent).

Why one agent can't serve them: (1) other people reach the bot — memory accumulates per relationship, and personas must not leak across contexts (privacy, not organization); (2) credential blast radius — per-agent auth; (3) persona coherence — their instruction/memory files are global per agent; (4) trust tiers via skill allowlists.

**CBX reframe: this is our multiple-boxes feature at a different granularity.** They need in-process multi-agent because their runtime is a singleton daemon; separation must be built inside it (the 9-tier router, per-agent dirs, allowlists). CBX's isolation unit is the box — separate directory/git/config — with *stronger* isolation than theirs (their workspaces are default-cwd, not a boundary; absolute paths escape unless sandboxed). The only piece of their story not structurally ours: **channel bindings into different boxes** (e.g. two Telegram accounts → family box vs work box) — only relevant if boxes multiply and each wants its own chat ingress.
