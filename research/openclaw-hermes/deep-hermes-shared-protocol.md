# Hermes "one protocol across surfaces" — deep implementation dive

Clone root for all citations: `/private/tmp/claude-501/-Users-ianbicking-src-callback-mono/b71d2662-11ec-4f27-9a9a-ef9beea687b1/scratchpad/hermes-agent`
(paths below are relative to that root unless stated otherwise).

**Skeptic's claim under test:** "one protocol across surfaces is hard — at least while allowing each surface to fully be itself."

**Verdict up front:** Half-right, and instructively so. The claim is *wrong* about the part of Hermes that's actually shared (chat/turn/session/approval/checkpoint core — single implementation, no LCD compromise visible). It's *right*, but not for the reason it implies, about the marketing framing: "~120 methods, one JSON-RPC protocol" understates how much of Hermes's real multi-surface behavior lives entirely outside that protocol — in REST endpoints, raw PTY byte-tunnels, ad hoc pub/sub, and native Electron IPC. Hermes doesn't disprove the skeptic by making one protocol serve everything; it disproves a narrower and more defensible claim: a *small, well-chosen* shared core (turn streaming, approvals, session resume) can be genuinely one implementation for all surfaces, provided everything surface-specific is pushed outside it rather than folded in.

Core files:
- `tui_gateway/server.py` — the JSON-RPC method registry (`@method(...)` decorator) and dispatch table; ~4900-13800 line range holds the handlers
- `tui_gateway/ws.py` — WebSocket transport, reuses `server.dispatch` verbatim
- `tui_gateway/git_probe.py`, `tui_gateway/event_publisher.py` — supporting gateway modules
- `hermes_cli/web_server.py` — web dashboard: mounts the WS JSON-RPC endpoint *and* ~204 separate plain REST endpoints, plus PTY/console/pub/events side-channel WebSockets
- `hermes_cli/dashboard_auth/` — web-only auth module tree (not exposed as RPC)
- `ui-tui/` — Ink/React TUI, own 794-line gateway client (`ui-tui/src/gatewayClient.ts`)
- `apps/desktop/electron/{preload.cjs,main.cjs}`, `apps/desktop/src/store/updates.ts` — Electron desktop app, native IPC bridge + version-skew check
- Tests: `tests/test_tui_gateway_server.py`, `tests/test_tui_gateway_ws.py`, `tests/hermes_cli/test_web_server_boot_handshake.py`, `test_web_server_pty_import.py`, `test_web_server_pty_reconnect.py`, `test_web_server_oauth_write.py`

---

## 1. Protocol inventory

Registration is a flat decorator into a single dict:

```python
# tui_gateway/server.py:1079-1084
def method(name: str):
    def dec(fn):
        _methods[name] = fn
        return fn
    return dec
```

`@method(...)` appears 118 times in `tui_gateway/server.py` only (lines 4908-13787), plus a small factory-generated set of `projects.*` methods (`_projects_method`, `tui_gateway/server.py:10344-10369`, itself calling `@method(name)` at line 10353) covering `projects.list`/`projects.get`/etc. — total is the reported ~120. Dispatch (`tui_gateway/server.py:1106-1156`) is a plain lookup with no per-surface branching and no method-level auth check. There is exactly one RPC registry — no fragmentation of the table itself, and no method appears twice under different names for different surfaces.

Taxonomy (file:line is the `@method(...)` registration):

| Category | Representative methods | Surface-neutral? |
|---|---|---|
| Session lifecycle / chat turn | `session.create`:4908, `session.list`:5052, `session.resume`:5288, `session.activate`:5842, `session.status`:7493, `prompt.submit`:8141, `prompt.background`:9575 | Yes — identical handler for stdio-Ink and WS clients |
| Streaming/interrupt | `session.interrupt`:7835, `subagent.interrupt`:7913, `delegation.pause`:7905 | Yes |
| Approvals / human-in-the-loop | `clarify.respond`:9749, `terminal.read.respond`:9754, `sudo.respond`:9760, `secret.respond`:9765, `approval.respond`:9770 | Yes — one handler, whichever transport currently owns the session |
| Checkpoints / rollback | `session.undo`:7573, `session.compress`:7601, `rollback.list`:12939, `rollback.restore`:12969, `rollback.diff`:13016, `spawn_tree.save/list/load`:7986/8029/8080 | Yes |
| Git/project context | `project.facts`:5142, `projects.discover_repos`:10567, `projects.tree`:10699 | Neutral in principle, but **not** where the desktop's real git tooling lives (see §4 — three separate git implementations exist) |
| Config/setup | `config.set`:9795, `config.get`:10752, `setup.status`:10906, `reload.mcp`:11051 | Yes |
| Voice | `voice.toggle`:12718, `voice.record`:12815, `voice.tts`:12892 | Nominally yes, but actual audio capture is surface-native code outside the RPC (browser `getUserMedia` vs. Electron's `requestMicrophoneAccess` IPC, `apps/desktop/electron/preload.cjs:50`) |
| Pets / cosmetic | `pet.info`:6447 … `pet.hatch`:7148 | Yes, purely presentational but plumbed uniformly |
| Billing/credits | `credits.view`:7247, `billing.charge`:7383, `billing.step_up`:7460 | Yes |
| Commands/slash/completion | `commands.catalog`:11204, `cli.exec`:11319, `complete.slash`:12215, `slash.exec`:12559 | Exist because Ink's `/slash` UX needed a first-class shell; web's command palette reuses them — neutral by accident of reuse rather than upfront design |
| Tools/skills/plugins | `tools.list`:13346, `skills.manage`:13624, `plugins.manage`:13708, `agents.list`:13516, `cron.manage`:13540 | Yes |
| Terminal/attachments | `terminal.resize`:8129, `image.attach`:9001, `file.attach`:9461 | Mostly yes, but `file.attach` is a method that was *added* specifically for one surface's need (see below) |
| Browser/shell | `browser.manage`:13141, `shell.exec`:13787 | Neutral as an RPC; what backs `shell.exec` on Electron overlaps with a wholly separate native PTY IPC channel (§3) |

`file.attach` (`tui_gateway/server.py:9461`) is a concrete instance of the protocol growing a method for one surface: the `DESKTOP_BACKEND_CONTRACT` v2 comment (`tui_gateway/server.py:3092`) states it was added because the desktop app, when pointed at a *remote* gateway, needed non-image file upload the local-fs Ink TUI never required.

## 2. Surface divergence mechanics — no capability handshake, one scalar version gate

There is no feature-discovery/capability-negotiation handshake. The WS "hello" is a single fixed event with one cosmetic field:

```python
# tui_gateway/ws.py:319-328
ready_ok = await transport.write_async({
    "jsonrpc": "2.0", "method": "event",
    "params": {"type": "gateway.ready", "payload": {"skin": server.resolve_skin()}},
})
```

No `capabilities`/`features`/protocol-version array. Grepping `hermes_cli/web_server.py` for `capabilit`/`feature_flag`/`handshake` turns up only *LLM* capabilities (vision/reasoning/tools of the model, e.g. `hermes_cli/web_server.py:4082,4137,12263`) — nothing that's a client/server negotiation mechanism. `tests/hermes_cli/test_web_server_boot_handshake.py` (188 lines) is misleadingly named: it tests event-loop non-blocking startup latency (does `/api/status` respond while a slow import runs in a thread), not protocol/capability negotiation.

Version skew is handled by a single monotonically increasing integer, checked one-directionally, and only by the Electron desktop client:

```python
# tui_gateway/server.py:3088-3093
# Monotonic GUI<->backend contract version. The desktop app refuses to drive a
# backend reporting less than its required value (or none at all — a pre-GUI
# checkout), surfacing a one-click "update to align" prompt instead of failing
# cryptically downstream. Bump whenever the desktop's backend contract changes.
# v2: adds the file.attach RPC (remote-gateway non-image file upload).
DESKTOP_BACKEND_CONTRACT = 2
```

The value is returned in `session.create`'s response (`tui_gateway/server.py:5045`) and session-info payloads (`:3154`, `:5194`). Client-side mirror:

```ts
// apps/desktop/src/store/updates.ts:90-94
// Must match tui_gateway's DESKTOP_BACKEND_CONTRACT that this build was written
// against. The backend reports its own value in session runtime info; a lower
// value (or none — a pre-GUI checkout) means GUI<->backend skew.
const REQUIRED_BACKEND_CONTRACT = 2
```

`reportBackendContract()` (`apps/desktop/src/store/updates.ts:123-140`) does nothing structural on mismatch — it pops a dismissible, cooldown-snoozed toast telling the user to update. There is **no per-method capability check**, no graceful per-feature degradation, and no protection against a client that's *ahead* of the server (only "server too old" is checked). `web/src` and `ui-tui/src` have no `BACKEND_CONTRACT`/`desktop_contract` reference at all — the web dashboard and Ink TUI ship in lockstep with the gateway (same repo/release) and just assume compatibility. So the entire version-skew mechanism is a single scalar "minimum server version" gate, scoped to exactly the one surface (Electron) that can legitimately point at a different-vintage remote backend — not a capability matrix, and not something that exists for the other two surfaces at all.

## 3. Where each surface "is itself"

**Electron-only, entirely outside the RPC protocol.** `apps/desktop/electron/preload.cjs:3` exposes `contextBridge.exposeInMainWorld('hermesDesktop', {...})` with ~50 `ipcRenderer.invoke('hermes:...')` calls, none touching `tui_gateway.dispatch`:
- Native file/save dialogs: `dialog.showOpenDialog` (`main.cjs:6623`, `:6758`), `dialog.showSaveDialog` (`main.cjs:3695`)
- OS notifications: `new Notification(...)` (`main.cjs:6550`)
- Window management: multiple `BrowserWindow` constructions for session windows, pet overlay, link-title probing (`main.cjs:4475`, `:5730`, `:5810`, `:5931`; enumerated in `apps/desktop/electron/session-windows.cjs`)
- Native filesystem ops: `readDir`, `gitRoot`, `revealPath`, `renamePath`, `writeTextFile`, `trashPath` (`preload.cjs:83-88`)
- **A full native git surface duplicating the RPC's project methods**: `worktreeList/worktreeAdd/worktreeRemove/branchSwitch/branchList/repoStatus/fileDiff/scanRepos` plus a `review.*` sub-API (`list/diff/stage/unstage/revert/commit/push/createPr`), `preload.cjs:89-111`, backed by `git-worktree-ops.cjs`, `git-review-ops.cjs`, `git-repo-scan.cjs`, `git-root.cjs`
- Native terminal: `hermesDesktop.terminal.{start,write,resize,dispose}` (`preload.cjs:114-118`) — a second, IPC-native PTY channel independent of the WS-based `/api/pty` the web dashboard uses

**Web-only concerns.** Auth/session-scoping lives in a standalone module tree, `hermes_cli/dashboard_auth/` (`audit.py`, `base.py`, `cookies.py`, `login_page.py`, `middleware.py`, `prefix.py`, `public_paths.py`, `registry.py`, `routes.py`, `token_auth.py`, `ws_tickets.py`), applied as HTTP middleware / WS-upgrade gating (`hermes_cli/web_server.py:12366` `_ws_client_reason`, `:12436` `_ws_host_origin_reason`, `:12502` `_ws_auth_reason`, `:12586` `_ws_auth_ok`). None of this exists for the Ink TUI — no network surface to protect — and it's bolted onto the *transport* layer, never expressed as RPC methods. `tests/hermes_cli/test_web_server_oauth_write.py` covers atomic OAuth-cred writes (`_save_anthropic_oauth_creds`, `0o600` perms) — another web/dashboard-only concern.

**TUI-only.** `ui-tui/` is a full Ink/React terminal renderer (30+ components: `markdown.tsx`, `streamingMarkdown.tsx`, `agentsOverlay.tsx`, `skillsHub.tsx`, `modelPicker.tsx`, `petSprite.tsx`, …) that owns its own 794-line gateway client (`ui-tui/src/gatewayClient.ts:1-16`), spawning the gateway as a child process over stdio (`node:child_process`, `node:readline`) *or* attaching over WS — a materially different transport-ownership model than the browser/desktop, which only ever speak WS.

**How surface needs get added — classified per the (a)/(b)/(c) framing:**
- **(a) New shared-protocol method for one surface's need**: `file.attach` (`tui_gateway/server.py:9461`), justified in the `DESKTOP_BACKEND_CONTRACT` v2 comment as remote-gateway non-image upload the local-fs TUI never needed.
- **(b) Side channels entirely outside the RPC protocol** — by far the dominant mechanism:
  - The Electron `hermesDesktop` IPC bridge (all of the git/dialog/notification/window/terminal items above)
  - Four *other* WebSocket endpoints on the web server besides `/api/ws`: `/api/console` (`hermes_cli/web_server.py:13076`), `/api/pty` (`:13432`), `/api/pub` (`:13662`), `/api/events` (`:13690`) — none speak JSON-RPC
  - **204 plain REST endpoints** in `hermes_cli/web_server.py` (`grep -c '@app\.\(get\|post\|put\|delete\|patch\)('` → 204), by top path segment: git (18), ops (15), profiles (14), dashboard (14), sessions (13), cron (13), skills (12), tools (10), mcp (9), providers (7), model (7), messaging (7), files (7), fs (6), config (6). **This is the single biggest correction to the "one shared protocol" framing**: the 118-method RPC table governs only the chat/turn/session/approval/checkpoint core; roughly 80% of dashboard functionality is plain REST, invisible to the Ink TUI entirely.
- **(c) Purely client-local presentation over shared data**: Ink's ANSI/markdown rendering (`ui-tui/src/components/markdown.tsx`) vs. the dashboard's DOM rendering both sit on top of the same `message.delta` event stream — genuinely shared data, surface-local presentation. This is the good case, and it's the minority of the surface-divergence work.

## 4. Lowest-common-denominator damage

No `TODO`/`FIXME`/`HACK` markers in `tui_gateway/server.py`, `tui_gateway/ws.py`, or `hermes_cli/web_server.py` — no visible inline scar tissue. But the *architecture* is itself the evidence, and it's substantial once you follow the web dashboard's "Chat" tab:

**The dashboard's Chat tab spawns the real TUI as a child process and screen-scrapes it, rather than driving the RPC as a native web client.** `/api/pty` (`hermes_cli/web_server.py:13432-13617`):

```python
# hermes_cli/web_server.py:13528
bridge = await asyncio.to_thread(PtyBridge.spawn, argv, cwd=cwd, env=env)
```

forks an actual `hermes --tui` child, pipes raw PTY bytes to the browser over WS (`:13541-13556` read, `:13581-13608` write), rendered client-side as an xterm.js-style terminal. This is not the shared JSON-RPC protocol — it's the TUI's own rendering, tunneled as raw bytes. The file states the reasoning directly:

```python
# hermes_cli/web_server.py:272-278
# In-browser Chat tab (/chat, /api/pty, /api/ws, …).  Always enabled: the
# desktop app and the dashboard's own Chat tab both drive the agent over the
# `/api/ws` + `/api/pty` WebSockets, so the embedded-chat surface is an
# unconditional part of the dashboard.

# hermes_cli/web_server.py:13620-13627
# /api/ws — JSON-RPC WebSocket sidecar for the dashboard "Chat" tab.
# Drives the same `tui_gateway.dispatch` surface Ink uses over stdio, so the
# dashboard can render structured metadata (model badge, tool-call sidebar,
# slash launcher, session info) alongside the xterm.js terminal that PTY
# already paints. Both transports bind to the same session id when one is
# active, so a tool.start emitted by the agent fans out to both sinks.
```

The browser Chat tab thus runs **two parallel transports simultaneously against the same session**: a raw-bytes PTY tunnel for pixel-perfect TUI rendering, plus the JSON-RPC WS for structured widgets the raw terminal can't express (model badge, tool-call sidebar). This is exactly the "web faking a PTY" failure mode the skeptic's framing would predict, confirmed in source rather than assumed.

That PTY-spawned child spins up its **own separate `tui_gateway.entry` process** — a third gateway instance, three processes removed from the dashboard server — and getting *that* gateway's events back into the dashboard sidebar needs a dedicated back-channel whose docstring spells out the convolution:

```python
# tui_gateway/event_publisher.py:1-12
"""Best-effort WebSocket publisher transport for the PTY-side gateway.

The dashboard's `/api/pty` spawns `hermes --tui` as a child process, which
spawns its own ``tui_gateway.entry``.  Tool/reasoning/status events fire on
*that* gateway's transport — three processes removed from the dashboard
server itself.  To surface them in the dashboard sidebar (`/api/events`),
the PTY-side gateway opens a back-WS to the dashboard at startup and
mirrors every emit through this transport.

Wire protocol: newline-framed JSON dicts (the same shape the dispatcher
already passes to ``write``).  No JSON-RPC envelope here — the dashboard's
``/api/pub`` endpoint just rebroadcasts the bytes verbatim to subscribers.
"""
```

That's a fourth ad hoc wire format ("no JSON-RPC envelope here"), purpose-built to stitch the PTY illusion back together with the structured-events illusion, plus a fifth (`/api/pub`, `hermes_cli/web_server.py:13662-13685`) that's a schema-less pub/sub relay.

**Duplicated git implementations with silently different capability envelopes.** `tui_gateway/git_probe.py:1-6` says outright:

```python
"""Git working-tree probing for the gateway: run git, resolve repo roots, fold
linked worktrees under their common root.

Probing runs where the gateway runs, so it resolves repos for both local and
remote backends (unlike the desktop's electron probe, which only sees the local
fs).
"""
```

At least three independent git-status/worktree implementations exist: the gateway's `git_probe.py` (RPC-adjacent), the web dashboard's 18 REST git endpoints (`hermes_cli/web_server.py:2067-2166`), and Electron's native IPC git surface (`git-worktree-ops.cjs`, `git-review-ops.cjs`) — with the gateway's own docstring flagging that the Electron variant has a *strictly narrower* capability (local fs only, no remote-backend support). This is the "surface wanted something the shared protocol couldn't cleanly express" pattern made concrete: instead of one git RPC every surface calls, the codebase grew three diverging git backends.

**Voice/audio and file dialogs** similarly needed surface-native code beneath the nominally shared `voice.record` RPC (`tui_gateway/server.py:12815`) — `getUserMedia` in the browser vs. `requestMicrophoneAccess` IPC in Electron (`apps/desktop/electron/preload.cjs:50`). The RPC is a thin coordination point, not the actual capture mechanism.

## 5. What's genuinely shared

The turn/session/approval core really is solved once, and the code backs up its own claim to that effect:

```python
# tui_gateway/ws.py:1-6
"""WebSocket transport for the tui_gateway JSON-RPC server.

Reuses :func:`tui_gateway.server.dispatch` verbatim so every RPC method, every
slash command, every approval/clarify/sudo flow, and every agent event flows
through the same handlers whether the client is Ink over stdio or an iOS /
web client over WebSocket.
"""
```

`handle_ws` (`tui_gateway/ws.py:283-424`) calls `server.dispatch` (`tui_gateway/server.py:1118-1156`) the same way the stdio loop does; `dispatch()` binds an optional `Transport` via contextvars (`bind_transport`/`reset_transport`, `tui_gateway/server.py:1130-1156`), so the same handler functions — `session.create`:4908, `prompt.submit`:8141, `approval.respond`:9770, `session.interrupt`:7835, `session.branch`:7764, `rollback.restore`:12969 — run unmodified regardless of whether output goes to stdout or a WS frame. Reading `approval.respond`'s body (`tui_gateway/server.py:9770-9789`) and `session.interrupt`'s (`:7835-7876`) confirms neither branches on transport type, client identity, or surface anywhere.

Streaming/backpressure — token coalescing and ordering guarantees between approval/tool frames and delta frames — is also solved once, in `WSTransport` (`tui_gateway/ws.py:70-252`): the `_STREAMING_EVENT_TYPES` coalescing logic (`:53-60`, `:106-207`) and the "flush non-streaming frames ahead of buffered tokens" ordering guarantee (`:140-159`) apply uniformly to every WS client (dashboard, desktop, and per the docstring, a hypothetical iOS client) — no per-surface variant.

Session resume/reconnect (`session.resume`:5288) and the WS-disconnect teardown path (`_close_sessions_for_transport`, invoked from `tui_gateway/ws.py:444-448`) are likewise single, transport-agnostic implementations.

## 6. Verdict and contrast with OpenClaw

**What actually held up.** The hard, state-machine-shaped problems — turn streaming, interrupt, approval/clarify/sudo flows, session resume — are implemented exactly once, run through the same dispatch path regardless of transport, and show no sign of lowest-common-denominator compromise (no transport-type branching found in any of the core handlers read). That part of the skeptic's worry is disproved: a shared core *can* serve genuinely different surfaces without watering itself down, provided the core is scoped to state/session semantics rather than presentation.

**What the skeptic was right about, in a more specific form than stated.** "One protocol across surfaces" is not really what Hermes has. The 118-method RPC table is real and clean, but it's a minority of the system's actual multi-surface surface area: ~204 REST endpoints, 4 non-RPC WebSocket channels (console/pty/pub/events), a 5th ad hoc newline-JSON wire format for the PTY-side event mirror, and a full native Electron IPC bridge duplicating git/filesystem/terminal functionality all exist *specifically because* the shared RPC protocol was kept narrow. The dashboard's Chat tab literally can't get pixel-perfect TUI rendering through the JSON-RPC channel, so it runs a second parallel transport (raw PTY bytes) alongside it — a direct instance of "a surface wanting something the protocol couldn't express" resulting in a side-channel rather than a protocol extension. Git tooling exists three times over with silently different capability envelopes (remote-backend support differs) rather than as one RPC surface every client calls — an actual LCD failure, just resolved by duplication instead of protocol compromise.

**The real architecture lesson**, borne out here: *shared session/turn/approval core + per-surface presentation and side channels is fine; the mistake would have been trying to cram presentation-specific needs (native dialogs, pixel-perfect terminal rendering, browser auth) into the same protocol.* Hermes doesn't prove "one protocol for everything is easy" — it proves something narrower and more useful: keep the shared protocol to the state machine, and accept duplication (three git backends, five wire formats) as the price of surface-native capability, rather than distorting the shared core to avoid that duplication. Whether that price is worth it is a separate judgment call — the three-deep git-probe divergence in particular (§4) reads as accidental complexity rather than a deliberate tradeoff, since a single git RPC callable by all three surfaces was clearly available in principle (the gateway's own `git_probe.py` already supports both local and remote backends).

**Contrast with OpenClaw (conceptual — this OpenClaw clone wasn't re-examined in this dive; based on the prompt's characterization).** If OpenClaw's gateway WS protocol does role/scope handshake + feature discovery *within* the shared channel, that's a materially different bet than Hermes's: negotiate capabilities inside one channel vs. Hermes's approach of keeping the one channel deliberately small and pushing everything else to separate channels/processes/IPC. Hermes has no capability-discovery handshake at all (§2) — it has a single scalar server-version gate, scoped to exactly one surface (Electron) that can legitimately run against a different-vintage backend, and it's checked one-directionally (old-server detection only, no old-client detection). If a capability matrix is the more scalable answer as surfaces multiply (more clients now check per-feature rather than requiring a full protocol/UI split), Hermes's four-and-growing side channels for a single Chat tab (WS-RPC + raw PTY + pub/sub relay + newline-JSON event mirror) is a plausible early warning sign that the "small protocol + many side channels" strategy has a scaling cost of its own, paid in wire-format proliferation rather than in protocol compromise.
