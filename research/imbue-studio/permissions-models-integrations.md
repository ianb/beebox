# Permissions, provider switching, integrations, and the sandbox (read 2026-10-08)

What the code shows against the launch claims. Read from clones of the public repos; see [sources.md](sources.md). Paths are relative to each repo root. Written by a reading agent and edited by the research session.


Sources read 2026-10-08. Repos: `default-workspace-template` (DWT, HEAD 45a1730, 2026-10-08),
`mngr` (apps/minds is the desktop host, HEAD afff004, 2026-10-08), `detent` (HEAD 6bd4191,
2026-09-16), `agent-host` (HEAD dda3bcd, 2026-06-15), `bottled-minds` (HEAD 4a9e576,
2026-09-11), five `*-mind-template` starters, plus `latchkey` via `gh api`. Paths below are
relative to each repo root. Quotes are verbatim.

## 1. "Zero access by default; you control exactly what AI can access"

### The mechanism is latchkey + detent, enforced outside the container

Third-party API calls are not made with credentials in the workspace. Every call goes through
`latchkey curl`, a transparent curl wrapper that forwards to a gateway process the desktop app
runs on the user's computer (or, for cloud workspaces, on the VPS). The agent's environment
carries only `LATCHKEY_GATEWAY`, a shared password header, and a signed JWT naming its
permissions file (DWT `.mngr/settings.toml`: `pass_env__extend = ["REMOTE_SERVICE_CONNECTOR_URL",
"LATCHKEY_GATEWAY"]`; mngr `apps/minds/docs/latchkey-permissions.md` "End-to-end flow" step 1).

DWT `.agents/skills/connect-external-service/references/latchkey.md`: "Credentials are managed
on the outside by the Imbue Studio app ... No credential ever enters this workspace; the gateway
attaches it to the request."

Permission rules are detent JSON. latchkey's `src/permissions.ts` calls
`@imbue-ai/detent`'s `check(request, configPath, ...)`; when no config file exists the check
"is skipped (returns true)". Imbue Studio always materializes one: mngr
`apps/minds/docs/latchkey-permissions.md` "Per-agent isolation": "When an agent is created,
Imbue Studio allocates an opaque `~/.minds/latchkey/permissions/<uuid>.json` handle and
materializes it with the deny-by-default baseline", later symlinked to
`~/.minds/agents/<agent_id>/latchkey_permissions.json`. Rules are keyed `<scope>:<account>`
(mngr `apps/minds/imbue/minds/desktop_client/latchkey/handlers/predefined.py`: "Grants are
*per account* ... a second account of the same service gets no access until it is granted in
its own right").

Rule format (detent `README.md`): `{"rules": [{"google-gmail-api": ["google-gmail-read-all"]},
...]}`; "The first rule whose scope matches the request determines the outcome ... By default,
requests that don't match any rule get rejected." Schemas are JSON Schema over a decomposed
request (`domain`, `method`, `path`, `parsedBody`, `customMetadata`); rules may also run
executable `hooks`.

### How the agent asks, and how the user grants or revokes

The agent POSTs to a reserved host, `http://latchkey-self.invalid/permission-requests`, with
`{"agent_id", "type": "predefined", "payload": {"scope", "permissions", "account"?},
"rationale"}`, then ends its turn (DWT `references/latchkey.md`). A PreToolUse hook
(`system/scripts/agent_latchkey_request_standalone.sh` -> `agent_latchkey_request_check.py`)
hard-blocks any tool call where the request is chained, piped, redirected, or backgrounded,
because the chat builds the approval card from the echoed JSON (`.claude/settings.json`
PreToolUse list; `.codex/hooks.json` and `.pi/extensions/policy_guards.ts` mirror it).

The desktop app consumes the queue (`desktop_client/latchkey/permission_requests_consumer.py`),
shows a centered dialog with "Approving will let the agent" plus an "Adjust" editor exposing
"a switch per Detent permission schema available for that scope" from the bundled catalog
`libs/mngr_latchkey/imbue/mngr_latchkey/extensions/services.json`; the `any` catch-all is
offered last and never preselected (`docs/latchkey-permissions.md` step 4). Approve runs
`latchkey auth browser <service>` if nothing is signed in, then rewrites the per-host
permissions file through the gateway's `permissions` extension (step 6).

Revocation and later editing: the workspace options panel's "Permissions" tab renders "every
grantable permission ... as a toggle" and "turning the last permission off deletes the rule"
(`desktop_client/latchkey/permission_toggles.py`); an app-level Connectors view lists grants
across workspaces and revokes them (`permission_overview.py`, "deliberately read/revoke
only"). There is no chat command for revocation; the chat side only files requests.

### What the agent sees

- `latchkey curl http://latchkey-self.invalid/permissions/self | jq .rules` returns its own
  rules; `/permissions/available/<service>` lists the catalog (`references/latchkey.md`).
- Gateway errors are text: `No service matches URL`, `No credentials found for <service>.`,
  `Request not permitted by the user.` (same file, table).
- `GET /devices` on the gateway is "part of the baseline" (mngr doc "Desktops").

### Secrets the gateway cannot hold: `data/.secrets/`

For keys latchkey cannot inject (query-string keys, SDK OAuth apps, local MCP servers) the
agent runs `request_secret.py`; the chat renders a password card; the chat app writes
`data/.secrets/<name>.env` with mode 0600. DWT `data/.secrets/README.md`: "The agent never
sees the value; it names the file and the variables, and the user types the value into the
card." Reading is only via `python3 system/scripts/with_secrets.py data/.secrets/<name>.env --
<command>`. A PreToolUse hook (`system/scripts/agent_secrets_guard.sh` ->
`agent_secrets_guard_check.py`) refuses `cat`, `source`, `sed`, `python3 -c`, redirects, and
`Read`/`Edit`/`Grep` tool calls naming the directory (including `~/.mcpc`, the MCP client
store linked there by `system/scripts/env.d/1300-mcpc-home-link.sh`). The README is candid:
"The guard is a backstop against a slip, not a boundary: it judges the text of a tool call,
so it cannot see what a program run under the wrapper does with its environment."

`data/.imbue/` holds plans (`data/.imbue/plans/CLAUDE.md`) and, for explorer-plan cloud
accounts only, an analytics footprint: Imbue's service "connects over SSH (with the same pool
key that provisioned the workspace), writes the then-current collection script ... and runs
it" roughly hourly, with redaction in-workspace; revocable by removing the key from two
`authorized_keys` files (`docs/system/analytics-collection.md`).

Other channel closures: `ENABLE_CLAUDEAI_MCP_SERVERS=false` and codex `apps = false` because
they are "an OAuth side channel to third-party services that bypasses the latchkey gateway"
(`.mngr/settings.toml`). Codex `unified_exec_tty = false` "closes a TOTAL bypass of the
PreToolUse guards".

### Concrete path: the agent reads Gmail for a digest; is "label but not send" expressible?

`daily-digest-mind-template/system/apps/daily_digest/src/daily_digest/gmail.py`: "Every
Gmail call goes through `latchkey curl` so the user's stored Google credentials never enter
this process." It builds `latchkey [--account <addr>] curl -s https://gmail.googleapis.com/gmail/v1/users/me/...`.
Labeling is `POST /messages/{id}/modify` with `addLabelIds`/`removeLabelIds` (`mark_read`,
`move_to_label`, `archive`); trash is `POST /messages/{id}/trash`.

The template's manifest asks for both halves wholesale: `template.toml` lists
`google-gmail-read-all` and `google-gmail-write-all` under scope `google-gmail-api`.

Detent's builtin Gmail schemas (`detent/src/schemas/builtin/google-gmail.json`) are
method+path patterns: `google-gmail-read-all` (any GET), `google-gmail-write-all` (any
POST/PUT/PATCH/DELETE), `google-gmail-write-messages` (`^/(upload/)?gmail/v[0-9]+/users/[^/]+/messages(/.*)?$`,
non-GET), `google-gmail-send-messages` (`.../messages/send$`), `google-gmail-write-labels`
(`.../labels(/.*)?$`), `google-gmail-write-threads`, drafts, settings, history, profile. There
is no `modify`-only schema. Applying a label to a message is `POST .../messages/{id}/modify`,
which only `google-gmail-write-messages` (or `write-all`) matches, and that same schema also
matches `POST .../messages/send` and `DELETE .../messages/{id}`. `google-gmail-write-labels`
covers creating/renaming label definitions, not applying them.

So: with the shipped catalog, "label emails but not send or delete them" is **not**
expressible as a toggle set. The closest grant ("read-all" + "write-labels") lets the agent
manage label definitions but not relabel a message. Detent itself can express it (a custom
schema with path pattern `/messages/[^/]+/modify$` and a `parsedBody` constraint), and
latchkey reads whatever `permissions.json` says, but the desktop UI "exposes a switch per
Detent permission schema available for that scope" from the fixed catalog; custom schemas in
the product appear only for custom-domain services (`handlers/custom_service.py`) and for
Imbue's own `additional_services.json`. A user with shell access to `~/.minds/agents/<id>/latchkey_permissions.json`
could hand-write it. The same coarseness holds for Slack ("slack-read-all",
"slack-chat-write", ...) per `megabox-mind-template/template.toml`.

The Google OAuth scopes requested are also broad: latchkey `src/services/google/gmail.ts`
asks for `gmail.modify` and `gmail.settings.basic`. Narrowing is done by detent at the
gateway, not by the OAuth grant.

## 2. Provider sign-in and mid-conversation switching

### Accounts, lanes, harnesses

The chat app (DWT `system/apps/chat/`) keeps an account store: "An account IS a folder" under
`~/.minds/accounts/<id>/` plus an index (`imbue/chat/accounts.py`). Sign-in "lanes" are listed
in `imbue/chat/harnesses/lanes.py`: Anthropic (harness Claude Code), OpenAI (Codex), Google
(Antigravity CLI), Opencode Go and OpenRouter and bring-your-own-key (all on the `pi-coding`
harness), with ~30 key providers for pi (Anthropic, OpenAI, Gemini, Groq, DeepSeek, Mistral,
OpenRouter, xAI, ZAI, ...). `harness_type.py`: `CLAUDE`, `CODEX`, `PI_CODING`, `OPENCODE`,
`ANTIGRAVITY`, plus a `SEED` pseudo-harness for the onboarding turns.

A chat is bound to an account at create time by an env var naming the folder:
"`CLAUDE_CONFIG_DIR` for claude, `CODEX_HOME` for codex, `HOME` for antigravity,
`PI_CODING_AGENT_DIR` for pi. Nothing rebinds a chat afterwards."
(`.agents/skills/use-ai-integration/references/billing-and-credentialing.md`). The default
for unqualified `mngr create` is written to git-ignored `.mngr/settings.local.toml`
(`imbue/chat/create_defaults.py`). Claude Code is pinned to `2.1.293` with model `opus[1m]`
(`.mngr/settings.toml`). No Bifrost or `ANTHROPIC_BASE_URL` gateway is used in the desktop
product; `ANTHROPIC_BASE_URL` appears only for keyed integrations snapshotted into
`data/.secrets/anthropic.env` and for the "Sign in with Imbue" path, which mints a LiteLLM
virtual key with a `$100/day` budget (mngr `desktop_client/ai_keys.py`). Bifrost is the
Cloud-in-a-Bottle variant only (below).

"Zero-paste" sign-in: the provider CLI's loopback OAuth callback is relayed. mngr
`desktop_client/provider_relay.py`: "The relay listens on that same port here and hands the
callback to the workspace's chat app, which replays it against the CLI's listener"; DWT
`imbue/chat/harnesses/sign_in_relay.py` is the workspace half. Codex uses device-code login
via `codex app-server` (`auth_flows.py`). pi lanes are "plain file writes" into pi's
`auth.json`.

### Switching mid-conversation: two mechanisms

- **Rebind** (same harness, different account): `imbue/chat/chat_rebinds.py` -- "keeps the
  chat's agent and restarts it on the new account", verified for Claude, Codex, pi,
  Antigravity (`harnesses/binding.py` `REBIND_VERIFIED_HARNESSES`).
- **Handoff** (different harness, e.g. Claude -> Codex): `imbue/chat/chat_handoffs.py` --
  "converges the chat's active agent, archives it, and creates its successor with a summary."
  The retiring agent is invoked with `/handoff-summary <path>` (skill
  `.agents/skills/handoff-summary/SKILL.md`): "That agent starts with none of your context:
  the chat app puts the file you write here into its first message (a file over 64 KB is
  pointed at instead)". The transcript UI shows an `agent_switch` chip between segments.

So "keeping context" across providers means a markdown summary written by the outgoing
model, not a shared conversation state. The raw transcript is retained per segment. Memory
is a directory of files: `autoMemoryDirectory: "~/workspace/data/memories"`
(`.claude/settings.json`); `data/memories/README.md`: "Your agent's long-term memory notes,
written and organized by the agent itself (Claude's built-in memory system points here)." Codex
has `memories = false`; pi/codex are pointed at `tk` tickets and the same repo, so memory
across harnesses is whatever is on disk, not a shared memory API.

### Bundled CLIs

mngr `apps/minds/test_bundled_agent_types.py` asserts every `[agent_types.*]` in the
template has its plugin installed in both the packaged app and source installs. DWT
`.mngr/settings.toml` declares `claude`, `codex`, `pi-coding`, `opencode`, `antigravity`
(aliases `pi`, `agy`), plus `main`/`command`. The binaries are baked into the image by
`system/scripts/setup_system.sh` (`CODEX_VERSION`, `PI_VERSION`, `agy_install-1.1.22.sh`).

## 3. Integrations: "email, calendar, Slack, Notion, and thousands more via API"

Surfaces, in the order the agent is told to try them (`connect-external-service/SKILL.md`
routing table):

1. **Builtin latchkey service.** latchkey `src/services/`: AWS, Calendly, Coolify, Discord,
   Dropbox, Fastmail, Figma, GitHub, GitLab, Google (Analytics, Calendar, Directions, Docs,
   Drive, Gmail, People, Sheets, Slides), HuggingFace, Linear, Mailchimp, ngrok, Notion,
   notion-mcp, OpenRouter, Ramp, Sentry, Slack, Stripe, Tailscale, Telegram, Todoist, Umami,
   Yelp, Zoom. Imbue adds `additional_services.json` (includes a `claude.ai` cookie-capture
   service). GitHub git push/pull is proxied through the gateway with `github-git-read/write`
   scopes.
2. **Custom latchkey service with a key**: agent files `type: "custom-service"` with a
   domain; user pastes a bearer/header token in the approval window.
3. **Official MCP server** through `mcpc` (`@apify/mcpc@0.7.0`, `setup_system.sh`), one
   shared client whose state lives in `data/.secrets/mcpc/`; servers listed in
   `mcp-servers.json` (not present in the template by default). "Anyone else's server is
   never run" (`references/mcp.md`). OAuth sign-in for hosted MCP servers runs in a
   workspace browser the user takes over via `handoff`.
4. **Custom latchkey service with a sign-in**: `cookie-capture` or `token-capture` flows run
   in latchkey's own browser on the user's computer; "agents authenticate as the user"
   (latchkey README).
5. **Direct API** with a key via the secret card and `with_secrets.py`.
6. **Browser** via the `agentic-browser-fleet` skill (Playwright + "Fortress" stealth
   Chromium installed by `env.d/1000-playwright-fortress.sh`).

Account connection is browser login capture: `latchkey auth browser <service>` opens a
Playwright-driven Chromium and "extracts the necessary API credentials from the browser
session" (latchkey README); Google services use Imbue's own OAuth client. latchkey >= 3.16
can import the user's Chrome cookies once (`latchkey auth import-chrome`, mngr doc
"Skipping the login").

No Google/Slack SDKs are used in the starters; they shell out to `latchkey curl`.
`daily-digest` reads Gmail + GitHub REST, LLM via `method = "keyed"` (Anthropic API key).
`megabox` (unified Slack+Gmail inbox) asks for `slack-read-all`, `slack-chat-write`,
`slack-conversations-write`, `slack-reactions-write`, `slack-files-read`,
`google-gmail-read-all`, `google-gmail-send-messages`, `google-gmail-write-threads`.
`lego-todo-planner` asks `google-calendar-read-all`. `orchard` asks Gmail read + send plus a
"ContactOut API token" secret. `bullet-journal` ships no fetcher: its adaptation note says
"build a fetch-process-show pipeline (latchkey scopes google-api/gmail-read,
google-api/calendar-read, slack-api/slack-read-all)". `task-inbox` asks Slack read and Gmail read and takes an optional Granola API key as a
secret (see [starter-templates.md](starter-templates.md)).

Template requirements are declarative: `template.toml` `[[requirements.permission]]` rows
are "ACTIVATION. The adopting agent acts on these FIRST and BY ITSELF, initiating each
latchkey permission request before asking the user anything."

## 4. Sandbox, egress, sharing, encryption

**Container.** mngr's docker provider assembles `docker run -d --name ... -p <ssh> [--runtime
runsc] ... <start_args>` (`libs/mngr_docker/imbue/mngr_docker/instance.py`
`_build_docker_run_command`); the template adds `--security-opt=no-new-privileges`,
`--restart=unless-stopped` (`.mngr/settings.toml` `[create_templates.docker]`). gVisor
(`runsc`) is the default on Linux desktops; macOS uses runc inside a Lima VM where "the agent
now runs directly in the VM as root". Codex's own sandbox is off (`sandbox_mode =
"danger-full-access"`), Claude runs with `skipDangerousModePermissionPrompt = true`, pi with
`auto_allow_permissions = true`: the container is the boundary. No `--network` flag, no
in-container iptables/nftables (grep of `system/`), so the container has ordinary outbound
internet; the only egress controls are detent rules on gateway-routed requests, and, for
cloud workspaces, "an nftables policy on the VPS keeps [port 1989] reachable from the bridge
and the VPS's own loopback only, and the bridge from reaching anything else on the VPS"
(mngr doc). A plain `curl` to any site from the workspace is not mediated. "Proxy through my
desktop" routes a service's requests out via the user's computer when a service blocks
datacenter IPs (`libs/mngr_latchkey/.../desktop_egress.py`).

**Desktop exposure.** Local: the desktop client reverse-proxies `host-<hex>.localhost:<port>`
per workspace, authenticated by one-time login codes (`desktop_client/auth.py`,
`ui_login.py`). Global: publishing registers a share with Imbue's connector and injects
`data/.secrets/share.env`; the in-workspace `share_gateway` service runs caddy (TLS terminated
in the workspace; private key generated there, CSR to the connector for ACME DNS-01) behind
`frpc` tunnels to Imbue's relays (`system/services/share_gateway/README.md`).

**Visitor auth.** Visitors are redirected to Imbue's accounts broker and return with a
"60-second RS256 handoff token (JWKS, audience, nonce, single-use jti)"; the gateway sets a
30-day session cookie and re-reads `data/.secrets/share_grants.toml` on every request
("revocation is instant; a malformed file fails closed"). The owner "is admitted by the
broker's identity, never by a grant" (mngr `sharing_handler.py`). `owner-exec`
(`system/scripts/run_owner_exec.sh`, pinned Go binary from `imbue-ai/owner-exec`) is a
signed-exec daemon whose audience is the share domain, used by the hosted chrome; it is not
the visitor login path.

**Encryption.** No end-to-end encryption of workspace content exists in the code. What there
is: TLS terminated inside the workspace for shares ("the encrypted bytes" through frp);
restic backups to R2 ("encrypted restic repo", `system/services/host_backup/README.md`) with
the key in `data/.secrets/restic.env`; latchkey's credential store encrypted at rest; cloud
slices on LUKS2 with operator-held keys. mngr's own audit
(`apps/minds/docs/security-boundaries-audit.md`, 2026-08 addendum) states: "A running slice's
contents are therefore not private from the operator"; "Stopped-workspace artifacts are
operator-decryptable ... only the restic backups are encrypted under material the user alone
holds". The DWT data README says only "continuous encrypted backup".

## 5. agent-host and detent today

**detent** is live and load-bearing: latchkey's `src/permissions.ts` imports
`@imbue-ai/detent`; its `src/schemas/builtin/*.json` are the permission vocabulary the
Imbue Studio dialog exposes (`services.json` descriptions match detent's `$comment`s
one-for-one). Detent's last commit is 2026-09-16; the template references it only through
latchkey (`imbue/chat/models.py`: "Detent scope schema name, e.g. 'slack-api'").

**agent-host** (last commit 2026-06-15) is a separate, earlier design: a FastAPI "Multi-channel
agent orchestrator" with Matrix (E2EE via matrix-nio) and Telegram channels, a cron
scheduler, and per-room workspaces, running **opencode** turns (`agent_host/runtime.py`:
"runs opencode CLI and captures output", writes `opencode.json` with `"permission": "allow"`).
Secrets are rows in SQLite injected wholesale as environment variables
(`_get_agent_env`: `env[secret["name"]] = secret["value"]`) and written to files under
`data/secrets`. No latchkey, detent, or docker references. It is packaged for OpenHost
(`openhost.toml`) and shares nothing with the template except the OpenHost CLI directory.
Treat it as superseded; nothing in DWT, mngr, or bottled-minds imports or cites it.

**bottled-minds** packages the template for Cloud in a Bottle: no desktop app or VM; the
router "terminates TLS and auth"; LLM traffic goes to a Bifrost gateway via
`ANTHROPIC_BASE_URL` and third-party calls to a `bottled-latchkey` app with a consent flow
(`cloudinabottle.toml`, `README.md`). Its submodule is `imbue-openhost/openhost-minds-template`,
a separate fork of the workspace, not DWT itself.

## Claims the code does not substantiate (needs hands-on use)

1. "Let an agent label emails but not send or delete them": no catalog toggle isolates
   `messages/modify`; hands-on check whether the UI offers any finer control than the
   catalog.
2. Whether the Permissions dialog's "Adjust" editor is reachable and legible to a
   non-technical user, and whether the default preselection (agent's ask) is what gets
   approved in practice.
3. "Secure sandbox": gVisor only on Linux desktops; macOS runs runc-in-Lima as root. Actual
   isolation on each OS needs testing.
4. "Without access to your secrets": the secrets guard is text-based and self-described as
   "not a boundary"; whether an agent in practice leaks env values via wrapped programs.
5. Mid-conversation switching "keeping context and memory": the handoff is a summary file;
   quality and loss across Claude -> Codex -> pi needs a real session.
6. "Open model subscriptions": pi lanes exist (OpenRouter, Opencode Go, ZAI, ...); whether
   the full skill/hook stack behaves equivalently on pi/opencode is untested here.
7. "Thousands more via API": custom-service and MCP paths exist; success rate on arbitrary
   services (bot protection, cookie flows) is empirical.
8. End-to-end encryption: not present in code; marketing wording should be checked against
   the audit's "not private from the operator" statement.
9. Visitor sharing UX: broker login, grants file, instant revocation are coded; the
   real-world flow (account creation for visitors, iframe cookie behavior) needs a trial.
10. Explorer-plan analytics collection: documented as hourly SSH + in-workspace redaction;
    what actually leaves the workspace can only be verified by reading a live
    `data/.imbue/analytics/collect.py`.
