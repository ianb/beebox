---
generated-by: .claude/skills/security-report/SKILL.md
generated-at-rev: 17afd862b86f29330e6126d19eafa6c711d60b2c
date: 2026-08-23
model: codex
reviewed-by: Ian Bicking
---

# Security report — structured version

The exhaustive accounting behind [security-overview.md](security-overview.md). An agent
is the primary consumer; updates are adjudicated against
`generated-at-rev` per the rubric in
[`.claude/skills/security-report/SKILL.md`](https://github.com/ianb/callback-box/blob/main/.claude/skills/security-report/SKILL.md)
(repo root). Item vocabulary:

- **State**: `ok` (as intended) / `mitigated` (real risk, named control) /
  `accepted` (known weakness, deliberate decision, rationale linked) /
  `gap` (known weakness, tracking issue linked, no acceptance decision).
- **Severity**: `low` / `medium` / `high` — what an attacker gains.
- **Reachability**: `public` (anyone reaching the port) / `authed` (needs
  a logged-in identity) / `owner` / `local` (needs the host machine) /
  `unreachable` (requires conditions absent on the blessed deploy path).

## 1. Endpoints, auth, abilities

### Auth architecture

One global wall: `addBoxAuthHook` (`src/webapp/server-box-scope.ts:66-144`),
a Fastify `preHandler` installed on every box's `/<slug>` scope
(`registerBoxRoutes`, `server-box-scope.ts:161-163`). It is active in every
real deployment — the only way to construct an unauthenticated server is
the in-process, test-only `openAccess` option, which no CLI flag, env var,
or config field exposes. The wall also gates the tRPC **WebSocket
upgrade**: `useWSS` registers the WS endpoint as an ordinary Fastify route
(`{websocket: true}`), so the upgrade request runs the same preHandler as
any HTTP request; `createContext` then re-derives identity independently
(defense in depth, never trusting the hook's verdict).

A request passes the wall by exactly one of: CORS preflight; a static
asset extension on a non-API URL; the diagnostic bearer bypass
(`CB_DIAG_API_KEY`, GET-only, whitelisted to `health.check` +
`debugLog.get`, exact-match against the full tRPC batch —
`auth.ts:68-119`); the mobile pairing-redeem carve-out; the per-box agent
loopback token; the machine-wide `CB_BROWSE_API_KEY`; mobile device
auth (bearer or `cb_mobile` cookie); or session identity + `canAccessBox`
(`box-access.ts:21-35` — **fail-closed**: an empty/missing `allowedEmails`
list means owner-only). A corrupt credential store answers **503**, never
"no session" (`server-box-scope.ts:112-114`) — a store outage cannot fail
open for gen-revoked sessions.

So "unauthenticated" below never means "reachable by anyone on the
internet" unless explicitly listed under *intentionally public*. In hub
mode a box process never verifies cookies at all — identity arrives only
via `CB_HUB_SECRET`-gated headers the hub injects after stripping any
client-supplied `x-cb-*` headers (`auth.ts:373-449`,
`hub-server.ts:249-294`).

tRPC procedure tiers (`src/webapp/trpc/trpc.ts`): `ownerProcedure`
narrows to the owner; `authedProcedure` checks `ctx.authed`;
`publicProcedure` is plain `t.procedure` with **no auth middleware of
its own** — it is safe only because the transport wall already ran, a
transport-level guarantee, not a procedure-tier one. In practice the
two non-owner tiers admit the same population (member or machine
credential); the distinction only matters on multi-member boxes — see
the member-tier gap below.

### Intentionally public (no credential of any kind)

| Route | Justification | State | Sev | Reach |
|---|---|---|---|---|
| `POST /api/csp-report` (`api-csp-report.ts:147`) | Browsers POST CSP reports uncredentialed by spec; body carries no secrets; amplification-bounded (16KB body / 2048-char field / 20 reports) | ok | low | public |
| `GET /api/build-info` (`server-root.ts:209`) | Pre-auth "what's running here" probe; build hash + open-mode flag only | ok | low | public |
| Hub static bundle (`/assets/*`, `/icons/*`, `/earcons/*`, `manifest.webmanifest`, `sw.js`) | The SPA must load before the user can log in; no box data | ok | low | public |
| pub-worker `GET /__version` | Content hash of code that is itself versioned in the repo | ok | low | public |

### Own-credential routes (outside the session wall)

| Route | Auth | State | Sev | Reach | Notes |
|---|---|---|---|---|---|
| `/auth/login`, `/auth/methods`, `/auth/me`, `/auth/logout` (`src/webapp/routes/auth.ts:144-228`) | Login is the credential; throttled scrypt verify (per-IP + per-account backoff, global scrypt cap) | ok | — | public | Necessarily pre-auth |
| `/auth/setup` (`setup-token.ts`) | One-time in-memory token, 15-min TTL, printed to server console only | accepted | high | public | The setup-token window: a zero-user box with an exposed port is claimable until the owner account exists. Accepted with the TTL + self-disabling route as mitigation; provision promptly (`cb auth create-user`). |
| `/auth/invite` (`auth-invite.ts:224,247`) | 32-byte single-use invite capability, 15-min TTL, hash-at-rest, throttled | ok | — | public | See invite items in §2 and the open-invite accepted risk in §8 |
| `/auth/reset-password` (`auth-password-reset.ts`) | 32-byte single-use password-reset capability (same store as invites), 15-min TTL, hash-at-rest, its own throttle isolated from login/invite throttles, re-checks the member is still eligible (role + `allowedEmails`) at both inspect and consume time | ok | — | public | Operator-minted per member from Allowed Users (`admin.createPasswordReset`, ownerProcedure); success bumps `gen`, revoking the member's other sessions. See §6b account lifecycle and §2 credentials |
| `/auth/password` (`auth-password-change.ts`) | Session + current-password re-verify; bumps `gen` | ok | — | authed | |
| `/auth/google`, `/auth/callback` (`auth-google.ts:46,62`) | Google-issued code/state; `email_verified` required; registered only when `GOOGLE_OAUTH_CLIENT_ID` set | ok | — | public | |
| `/auth/google-services/callback` (`routes/admin.ts:27`) | Single-use OAuth `state` nonce + owner binding (403 on mismatch) | mitigated | med | public | Nonce closes the historical token-fixation hole (`google-oauth-state.ts`) |
| `POST /webhook/<slug>/telegram` (`routes/telegram.ts:38`) | `x-telegram-bot-api-secret-token` must equal the box's webhook secret; 404 unconfigured; Zod body | ok | — | public | |
| `POST /api/scan/check`, `PUT /api/scan/files/:sha256` (`scan-upload.ts:292-294`, `scan-auth.ts`) | Scan-token bearer or full owner identity; per-key rate limit; 503 if box not annex-converted | ok | — | public | Uploads land in quarantine: hash-verified, format/malware-validated before promotion |
| `POST /api/pairing/redeem` (`routes/pairing.ts:20`) | One-time pairing ticket (10-min TTL, in-memory) | ok | — | public | The carve-out that bootstraps mobile auth |
| Hub `GET /healthz`, `GET /healthz/canary` | `CB_DIAG_API_KEY` bearer (503 unconfigured / 401 wrong) | ok | — | public | Canary actively cold-starts the named box; was open pre-2026-07 (leaked slugs/PIDs/ports), now key-gated |

### In-wall surface (session/member level unless noted)

Everything under `/<slug>/api/...` and the tRPC tree rides the wall.
Notable abilities, and the items that are more than routine:

| Surface | Abilities | State | Sev | Reach | Notes |
|---|---|---|---|---|---|
| `api-files.ts`, `api-files-write.ts`, `api-browse.ts`, `api-image.ts`, `history.ts` | Read/write/delete/commit raw box files; read any historical git blob | ok | — | authed | Path containment via `ref-path.ts` + route guards |
| tRPC `share.destinations` / `share.saveTextual` | Write a new card (inbox or a landmark dir) from shared URL/text content; used by the iOS share extension | ok | — | authed | Card-schema-validated before write, `withCardLock`-serialized, `share-id`-deduped against replay; same auth tier as the file-write surface above |
| `POST /api/chat/*`, `transcribe-ws` | Drive chat, transcribe (consumes box's provider keys) | ok | — | authed | `mock: true` TTS is rejected unless explicit development surfaces are enabled; it cannot silently fall through to a paid provider call |
| `POST /api/chat/screenshot/request` (`chat-screenshot-routes.ts:208`) | Pull on-screen state from a connected browser | mitigated | med | authed | Extra gate: requires the agent bearer specifically; a plain session 403s |
| `ANY /api/adapters/:adapter/*` (`api-adapters.ts:63`) | Proxy to Replicate/Mistral/Anthropic/OpenAI, injecting the box's stored key server-side | ok | — | authed | Key never reaches the client |
| `GET /api/task-output` | Reads task-output files, not box-scoped | gap | med | authed | A cross-box read gap on multi-box servers, **tracked privately** (location-precise defect; disclosure withheld until fixed per the rubric's disclosure rule) |
| `GET /api/proxy-image` | Server-side fetch of arbitrary public image URLs | gap | low | authed | SSRF-guarded (see §4). A possible auth-scope mismatch is under verification and **tracked privately** until confirmed harmless or fixed |
| `GET /api/external` (`api-external.ts:47`) | Reads configured paths outside the box root | mitigated | high | unreachable | Registered only with explicit `devSurfaces`; production launchers omit it and absence fails closed. If enabled, an authed member can rewrite `config/box.json` through the raw file API and widen `externalRoots`, so this remains a high-impact local-development capability rather than a hardened member boundary |
| tRPC `admin.*`, `pairing.*`, `scanTokens.*` | Connector setup, device pairing, credential minting | ok | — | owner | Uniformly `ownerProcedure` |
| tRPC `scheduler.trigger`, `commands.executeSync`, `drive.updateConfig`, `calendar.updateConfig` | Run scheduled script cards / registered commands; rewrite sync config | gap | med | authed | Member-level code execution and config writes; moot single-operator (fail-closed owner-only), bites on multi-member boxes — [member-level-writing-procedures](../../issues/code-quality/2026-08-07-member-level-writing-procedures.md) |
| tRPC `transcription.deepgramTempKey` / `openaiRealtimeKey` | Mint short-TTL (≤20 min) scoped third-party keys for browser-direct streaming | mitigated | low | authed | Long-lived provider keys never leave the server |
| tRPC `clerk.*` (Chrome extension) | Page capture/commentary, tab arrangement | ok | — | authed | Rides the session cookie + per-origin CORS reflection for `chrome-extension://`; no separate extension credential |
| Hub catch-all proxy + WS proxy (`hub-server.ts`) | Routes `/<slug>/...` to children with injected identity | ok | — | public→authed | WS reconnects never cold-start an idle box (anti-resurrection-storm) |
| WS-auth end-to-end test coverage | — | gap | low | — | The `gen`/identity resolver is unit-tested but no test drives a real socket-level subscription upgrade — [no-socket-level-ws-auth-test](../../issues/code-quality/2026-08-07-no-socket-level-ws-auth-test.md) |

pub-worker routes are in §6a.

## 2. Credentials

| Credential | Lives at | Gates (blast radius) | Scope | Lifetime / revocation | State |
|---|---|---|---|---|---|
| Local password store — `~/.cb-auth.json` (`local-users.ts:87`) | 0600 self-healing (`:124-127`), symlink-rejected, scrypt N=2^17, atomic writes | Account takeover for stored users | **Machine-global** (all local boxes) | Permanent; password change bumps `gen`, revoking live sessions | ok |
| Session secret — `~/.cb-session-secret` / `CB_SESSION_SECRET` (`auth.ts:30-59`) | 0600; env preferred | **Forge any user's session** (symmetric HMAC) | Machine/hub only — **not inherited via env** by box children or agent subprocesses; the 0600 file remains readable by any same-OS-user process (`script-env-allowlist.ts` concedes this) | Cookie TTL 30 days; revocation via `gen` bump only | ok — env-level control, see the allowlist note below |
| Invite & password-reset capabilities — `~/.cb-auth.json.invites.json` (`auth-capabilities.ts`, one shared store since `68c5e537`; the file keeps its legacy name, on-disk `version: 2`, auto-upgrades from `version: 1` on first write) | SHA-256 hash at rest, 0600, atomic + locked | Invite: create one member account on one box. Reset: replace one existing member's password on one box | Per-box | 15-min TTL, single-use, 100-live cap shared across both kinds | ok |
| Setup token (`setup-token.ts`) | Memory only; printed once to console | Claim a zero-user box | Per-process | 15-min TTL, self-disabling | accepted (§8) |
| `CB_HUB_SECRET` (`supervisor.ts:106,429`) | Env only, minted per hub boot | Impersonate any user to hub-fronted boxes | Hub + direct children; never allowlisted into box subprocesses (`script-env-allowlist.ts`) | Hub process lifetime | ok |
| `CB_DIAG_API_KEY` | Server `.env` (0600, `deploy/setup-server.sh:186`) | Read-only: fleet health + debug log (exact-match whitelist, `auth.ts:90-98`) | Fleet-wide | Operator-set, no rotation | ok |
| `CB_BROWSE_API_KEY` (`browse-key.ts`) | Env only; fail-closed when unset | **Full app access, machine-wide** (every box/worktree on the dev router, plus the router's read-only dev surfaces — `GET`/`HEAD` on `/<w>/dev/…` and `/workstreams/…`, the `dev-read` class in `bin/router-auth.ts`). NOT the control surfaces: `/`, `/__router/*`, and every mutating `/workstreams/*` verb stay owner-session-only | Machine | No expiry | mitigated — dev-only by design, absent on deploys; module warns against public use |
| Agent loopback token — `.callback-box/agent-token` (`agent/token.ts:26-48`) | 0600, gitignored; injected as `CB_AGENT_TOKEN` into box subprocesses | Call back into its **own** box only | Per-box | Permanent, no rotation | ok — trust boundary is explicit: the agents are the box |
| Mobile device tokens — `.callback-box/mobile-devices.secret.json` (`pairing.ts`, `token-store.ts`) | SHA-256 hash at rest, 0600, locked atomic RMW | Full member-level box access per device | Per-box, per-device | **No expiry**; explicit revoke propagates ≤1h via the `cb_mobile` cookie TTL | gap — [mobile-device-token-no-expiry](../../issues/code-quality/2026-07-19-mobile-device-token-no-expiry.md). On-device (iOS) storage moved from plaintext JSON to Keychain (`AfterFirstUnlockThisDeviceOnly`, shared app-group access group for the main app + the new share extension) in `571bb83f` — [ios-token-plaintext-not-keychain](../../issues/closed/bugs/2026-07-17-ios-token-plaintext-not-keychain.md), now closed |
| Mobile session secret — `.callback-box/mobile-session.secret` (`mobile-session.ts`) | 0600; 1-hour signed cookie | Rides WS upgrades without exposing the device token | Per-box | 1h TTL, renewed per response | ok |
| Scan-uploader tokens — `.callback-box/scan-tokens.secret.json` (`scan/tokens.ts`) | Same TokenStore guarantees; deliberately a separate store from mobile | Scan-ingestion only | Per-box | Permanent until named revoke | ok |
| Google OAuth client — `GOOGLE_OAUTH_CLIENT_ID/SECRET` (`google-auth.ts:48-52`) | Env; redacted; shared to children by design | OAuth app identity | Fleet | Operator-set | ok |
| Google tokens — `CB_GOOGLE_TOKENS_FILE` (`google-token-store.ts`) | 0600 atomic, double-locked, fail-closed read-for-update | **All authorized Google services (gmail/calendar/drive), fleet-wide** — one shared refresh token | **Fleet** (legacy per-box fallback exists) | Effectively permanent; dead-grant tracking | accepted (§8) — [google-auth-policy-proxy](../../issues/features/2026-07-28-google-auth-policy-proxy.md) |
| VAPID keys — `CB_VAPID_*` (`send-push.ts:46-60`) | Env only; redacted | Send push notifications as the box (no data access) | Server-wide | Operator-set | ok |
| Provider keys — Mistral / Deepgram / OpenAI (`mistral-key.ts`, `deepgram-key.ts`, `embeddings-key.ts`, `THINKING_OPENAI_API_KEY`, `GEMINI_KEY`) | Box `config/connectors/<name>.secret.json` first, env fallback; all in `SECRET_ENV_NAMES` + hub allowlist, and withheld from agent subprocesses (`script-env-allowlist.ts` — the tooling profile only) | Spend/abuse the provider account | Per-box (file) or server (env) | Operator-set | gap — hand-placed files have no mode enforcement: [connector-secret-file-modes](../../issues/closed/bugs/2026-08-07-connector-secret-file-modes.md) |
| Telegram — `config/connectors/telegram.secret.json` (`routers/admin.ts:96-101`) | Written **without** an explicit 0600 mode | Bot token = full bot control; webhook secret = forge inbound updates | Per-box | Permanent until re-setup | gap — same issue as above |
| Publish connector — `config/connectors/publish.secret.json` (`connector-secret.ts`) | 0600, strict-Zod, minted scoped | R2 **ingestion bucket only** — cannot touch published content or `allowedEmails` | Per-box, per-bucket | Permanent; revoke via Cloudflare dashboard | ok |
| `ANTHROPIC_API_KEY` | **Deliberately withheld** (absent from both the hub and script-env allowlists; also stripped in `cli/bootstrap.ts`) | — | — | — | ok — a leak-prevention control forcing subscription auth, not a stored credential |

**Positive control — the hub child-env allowlist**
(`src/hub/child-env.ts:42-119`): per-box children receive an exact-name
allowlist of env vars, never a spread. `CB_SESSION_SECRET` never reaches a
child (a box that could verify a cookie could forge one for a sibling);
`ANTHROPIC_API_KEY` is excluded; widening requires a named entry with a
reasoned comment. `src/core/script-env.ts` applies the same posture one
level down (Track 1 of `docs/plans/secret-custody.md`, 2026-08-17): a box
subprocess inherits only `script-env-allowlist.ts`'s named entries, so the
hub trust secrets, `CB_SESSION_SECRET`, `CB_BROWSE_API_KEY`,
`ANTHROPIC_API_KEY`, every connector credential, and any unlisted name never
reach an agent. Connector credentials reach only the `cb`-tooling spawn
profile (`buildToolingScriptEnv`, used for `cb wakeup`/`cb finalize` and
scheduled `runs:` commands, which run the connectors); Track 3 retires that
carve-out with the env-var credential path itself. State: mitigated (this is the named control for
cross-box credential isolation). Tested in `test/hub/supervisor.doctest.md`.
**Scope of the control**: env-level, not OS-level. Everything runs as
one OS user, so file-backed secrets (`~/.cb-session-secret`,
`~/.cb-auth.json`) stay readable by any process that goes looking; the
allowlist stops inheritance and accident, not a determined same-user
reader.

## 3. Data egress

Every place data leaves the machine. "Automatic" means it happens on the
wakeup cycle or routine use without a per-action confirmation.

| Destination | Trigger | Data sent | Credential | Scoping / opt-out | State |
|---|---|---|---|---|---|
| **Anthropic** (`agent/run.ts`, via Claude Code subprocess) | Automatic — every wakeup job, chat turn, scan batch | Full agent-turn context: prompts plus **whatever box files the agent reads during the turn** (any card, email, chat); user-uploaded images; scanned photos (`scan-vision-claude.ts`, hermetic `tools: []` call) | Claude subscription auth (`ANTHROPIC_API_KEY` stripped to force it) | None — this is the product | ok (stated plainly) |
| **Mistral** (`voxtral.ts`) | Automatic — the **default** transcription backend (batch + streaming) | Raw voice audio | Per-box key | `config/transcription.json`; switch service | ok |
| **OpenAI** (`openai-audio.ts`, `openai-embeddings.ts`) | When configured: Whisper is the default HQ re-transcription pass; embeddings run on the automatic index refresh | Raw audio + context prompt; **each card's searchable text** + literal search queries; TTS reply text | Separate keys (transcription ≠ embeddings, deliberate) | Switch transcription service; omit embeddings key → text-only search | ok |
| **Deepgram / OpenAI Realtime — browser-direct** (`deepgram-key.ts`, `openai-realtime-key.ts`) | Live dictation when selected | Raw microphone audio streamed **from the browser straight to the vendor** | Server-minted ephemeral key (≤20 min); long-lived key stays server-side | Per-box transcription config | ok — distinct risk shape, named in SECURITY.md |
| **Google Gemini** (`scan-vision.ts:79-106`) | Only when `CB_SCAN_VISION=gemini` (default is Claude) | Scanned photos | `GEMINI_KEY` | Env opt-in | ok |
| **Google Gmail** (`gmail.ts`, `gmail-drafts.ts`) | Automatic sync | IN: full messages/attachments. OUT: **drafts only — no `gmail.send` scope exists**; autonomous sending is architecturally impossible today | Shared fleet OAuth token | `googleServices.gmail` per-box flag (default off) | ok |
| **Google Calendar** (`google-calendar.ts`) | Automatic sync | Event create/edit/delete (title, description, attendees) | Same token | `googleServices.calendar` | ok |
| **Google Drive/Sheets/Docs** (`google-drive.ts`, handlers) | Automatic sync | Two-way edits to files the box already tracks; **full `drive` scope**, not `drive.file` (deliberate, to sync pre-existing docs by URL) | Same token | `googleServices.drive` | accepted (§8 — shared broad token) |
| **Telegram** (`connectors/telegram.ts`, `telegram-outbound.ts`) | Automatic once configured | Agent-authored reply text (no attachment path); registers the public webhook URL | Per-box bot token | Presence of the secret file | ok |
| **Web Push** (`send-push.ts`, `services/push.ts`) | Automatic on finalize | Full notification payload (agent-authored title/body/URL), VAPID-encrypted, through the browser's push service (FCM/Mozilla/Apple) | Server VAPID keypair | Browser subscription | ok |
| **Box git remote** (`lib/git.ts:416-460`, `wakeup.ts:149`) | Automatic at the end of every wakeup | **The entire incremental box history** — every card, email, chat | Host git credentials | Operator-chosen remote; no remote → skipped | ok (stated plainly; see [git-push-confirmation](../../issues/decisions/2026-07-20-git-push-confirmation.md)) |
| **Cloudflare (publish)** (`publish/setup.ts`, `go.ts`) | Human-gated CLI only. `cb pub setup` itself calls Cloudflare's API (buckets, subdomain, Access provisioning, worker deploy — `setup.ts:165-207`) with no confirm beyond running it; **content** uploads only on `cb pub go`'s interactive TTY confirm | Provisioning: static config, no content. Publish: the rendered bundle + a stripped edge manifest (no box identifiers) | Operator's wrangler OAuth (never stored on the box); box holds only the ingestion-scoped token | Never run `cb pub setup` → fully inert | ok |
| **Tailscale** (`tailscale-setup.ts`) | Manual CLI | Traffic to the tailnet via `tailscale serve` — **never `funnel`** (a discovered funnel grant is a hard failure); control-plane traffic belongs to the OS daemon | — | `cb tailscale stop` / don't install | ok |
| **Adapter proxy** (`api-adapters.ts:33-104`) | Box-local code calling `/api/adapters/:adapter/*` (never automatic) | The authed request body, forwarded to **Replicate**, Mistral, Anthropic, or OpenAI with the box's stored key injected server-side | Per-box stored keys | Only reachable behind the wall; inert without a stored key | ok |
| **Outbound URL fetches** (`proxy-image.ts`, `url-fetch.ts`) | Image proxy per render; link check on validate | The URL itself (query strings can carry data) | None forwarded | — | mitigated — SSRF guards, §4 |
| **iOS app** | — | All box traffic goes only to the paired box. Exception: legacy dictation fallback streams mic audio to **Apple** cloud speech, no app-level opt-out | — | On-device path preferred (iOS 26+) | gap — [ios-cloud-speech-fallback-no-optout](../../issues/bugs/2026-08-07-ios-cloud-speech-fallback-no-optout.md) |
| **Chrome extension** (`callback-clerk`) | User-initiated capture | Readability-extracted page markdown, URL, optional screenshot + frozen HTML; selected tab titles/URLs — only to the user's own enabled box (per-origin permission granted at enable time) | Browser session cookie | Per-box enablement | ok |
| **Telemetry / analytics / update checks** | — | **None in the running system — verified absent.** No analytics/crash/telemetry dependency in any `package.json`; no version/update check on any box or server code path. (Developer maintenance scripts in the monorepo's `bin/` query npm/PyPI; they are not shipped and never run on a box) | — | — | ok |

## 4. Internal security practices

| Practice | Where | State | Notes |
|---|---|---|---|
| Fail-closed credential store | `local-users-errors.ts`, `server-box-scope.ts:112-114` | ok | Corrupt/unreadable store → 503, never "no session" |
| Client error sanitization | `webapp/trpc/trpc.ts`, `webapp/server.ts:114-128` | ok | tRPC unconditionally removes response stacks and replaces internal-error messages; raw 5xx responses stay generic; full errors remain in server-side logs |
| Development-surface opt-in | `server-types.ts`, `lib/env.ts`, `routes/api.ts`, `routes/chat-audio-routes.ts` | mitigated | `CB_DEV_SURFACES=1` is a strict positive opt-in set only by development launchers; omission disables the external-file route and rejects mock TTS before provider lookup |
| Path traversal containment | `src/shared/ref-path.ts` | ok | All ref/path resolution goes through one pure module; `..` escaping the box root → `null` everywhere, never clamped (frontend clamping removed 2026-07-30); callers must degrade visibly |
| Login throttling | `login-throttle.ts` | ok | Per-(IP,email) exponential backoff + per-IP and per-email buckets (X-Forwarded-For rotation defeated) + global scrypt concurrency cap 2 (memory-DoS guard); all maps hard-capped at 4000 entries; throttle, never lockout |
| Session mechanics | `auth.ts` | ok | HMAC-SHA256 cookie, 30-day TTL, timing-safe verify with length pre-check; `gen`-based revocation on password change/user removal; hub mode never verifies cookies in the box process |
| Timing-safe comparisons | `auth.ts:68-76,171-184`, `browse-key.ts:57-72` | ok | All bearer/secret compares |
| CSP | `src/lib/csp.ts`, [content-security-policy.md](content-security-policy.md) | accepted | Single policy builder; Fastify always selects the built-frontend policy and Vite explicitly selects its HMR policy. **Currently Report-Only** — blocks nothing; promotion to enforcing is a deliberate gated step (`pnpm csp-digest`) |
| Cross-box browser isolation | — | accepted | Boxes share one origin; a script in one box can make same-origin requests to a sibling. Accepted single-operator; server-side forgery still blocked (session secret never reaches boxes). [boxes-share-one-origin](../../issues/closed/decisions/2026-07-19-boxes-share-one-origin.md) |
| SSRF guards | `proxy-image.ts:50-121`, `url-fetch.ts:122-190` | ok | http(s) only; DNS-resolved block of loopback/private/link-local (incl. cloud metadata)/CGNAT/multicast, v4+v6+mapped; every redirect hop re-validated (max 3); 25MB/10s caps; `image/*` only; no cookie/Referer forwarding |
| Locking | `lib/file-lock.ts` (proper-lockfile, atomic mkdir guard), `lib/card-lock.ts` | ok | Hand-rolled reclaim retired after failing adversarial review; lease-steal residual in §8 |
| Input validation | Zod at tRPC/route boundaries; `cb validate` for cards; strict manifest unions (`publish/manifest.ts`) | ok | |
| Atomic secret writes | `lib/atomic-write.ts` + per-store 0600 modes | ok | Exceptions tracked as the §2 connector-mode gap |
| **Agent blast radius** | `agent/run.ts:70-97` | accepted | `permissionMode: "bypassPermissions"`, unconditional; **no tool allowlist**; cwd = box root. `additionalDirectories` is unguarded caller input forwarded to the SDK (`run.ts:50-51,85-87`) — current call sites pass only the box root, but containment is call-site convention, not an enforced bound. Hooks (card validator, git-mv nudge) advise, don't block. The agent can run arbitrary shell as the box user. This is the product's design; containment direction: [agent-containment-allowed-directories](../../issues/features/2026-07-20-agent-containment-allowed-directories.md) |
| Schedules off by default | fresh boxes seed `enabled: false` (except map refresh/run cleanup) | mitigated | Nothing runs until the user turns it on — [schedules-off-by-default](../../issues/features/2026-07-20-schedules-off-by-default.md) |

## 5. Operational security

| Item | Detail | State | Sev | Reach |
|---|---|---|---|---|
| Process model | `cb hub` (systemd, dedicated non-root `callback` user) spawns one `cb serve` child per box, bundled `dist/cli.mjs` | ok | — | — |
| Bind defaults | `cb serve` → `localhost` (`serve.ts:99`); hub → `127.0.0.1` (`hub-config.ts:104`); no `0.0.0.0` anywhere in `src/` | mitigated | med | local | Control is default-loopback + nginx as the only public listener. Residual: operator-overridable — nothing in code *refuses* a non-loopback bind. (No recorded decision that this is fine, so it is not marked `accepted`.) |
| TLS — public path | Cloudflare-proxied, SSL mode "Flexible": **edge→origin is plain HTTP** (nginx :80 → 127.0.0.1) | gap | high | public (passive on-path) | [cloudflare-flexible-ssl-origin-plaintext](../../issues/bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md) |
| TLS — Tailscale path | Terminated by `tailscale serve` (LE certs), tailnet-only | ok | — | — |
| Tailscale exposure gate | `tailscale-target.ts`, `tailscale-setup.ts:100-160` | mitigated | — | — | Refuses to expose a target that can't prove an auth-enforcing posture (`/auth/me` probe, anonymous-401 check); funnel never invoked, detected funnel = hard failure |
| Cross-box env isolation | Hub child-env allowlist (§2) | mitigated | — | — | |
| Secrets on the server | `/home/callback/.env`, 0600 (`setup-server.sh:186`) | ok | — | — | |
| Deploy drift | `setup-server.sh` (nginx/systemd) is not re-run by `deploy.sh` | gap | low | — | Infra changes require manual application; documented in `deploy/README.md` but not decided-acceptable — [deploy-infra-drift-setup-server-not-rerun](../../issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md) |
| Backups | No first-class mechanism; box git remotes optional; annex `numcopies: 1`, no annex remote | gap | med | — | [server-backup-story](../../issues/decisions/2026-08-07-server-backup-story.md) |

## 6. Feature-specific

### 6a. Publishing

The flow: `cb pub draft` renders a single named doc to a static bundle
and **leak-scans it before anything enters git history**
(`draft.ts:250-255`); `cb pub go` re-scans, shows a full file-by-file
preview, and requires an interactive TTY confirmation that refuses on a
non-TTY (`go.ts:115-132`) — agents cannot flip a publication live through
the blessed path. The control is **procedural, not cryptographic**
(`go.ts:11-19`, stated in-code): an agent with box shell access could
script around the confirm; the real controls are the Cloudflare
credential living outside the box, the interactive confirm, and the git +
`cb pub ls` audit trail.

| Item | Detail | State | Sev | Reach |
|---|---|---|---|---|
| Leak scan (`leak-scan.ts`) | Scans text entries for home paths, non-owner emails, credential shapes, absolute URLs. **A backstop, not a gate**: stated blind spots are prose PII in the inlined card JSON and **binary/image assets (skipped entirely — a screenshot of a key ships clean)**; the human preview is the only real gate | accepted | med | — |
| Bundles are fully public regardless of tier | Tier gates *who can reach the page*, not what a viewer does after saving it; `public` and `secret` bundles are stored and scanned identically | accepted | — | — |
| `secret` tier = capability URL | `/s/<pub-id>` has **zero authentication** — the ≥128-bit CSPRNG pub-id is the credential (`manifest.ts:77-94`, `index.ts:141-143`) | accepted | med | public | The name invites misreading as access-controlled; SECURITY.md states it plainly |
| `accounts` / `any-account` tiers | Cloudflare Access JWT, RS256 pinned (no `alg` downgrade), fail-closed on every axis (unconfigured Access → 404, empty allowlist → nobody, JWKS failure → 401) | ok | — | — |
| Submissions (`submit.ts`) | Form-urlencoded only, 1MiB cap, manifest re-validated, no-public-submit twice-enforced; per-day cap best-effort; per-IP limit optional | ok | low | public |
| Bucket split | `PUB_STORE` (content — worker read-only, laptop-written) vs `PUB_INGEST` (submissions — worker-written, box-readable); a stolen box connector token cannot touch published content | mitigated | — | — |
| Edge manifest hygiene | Provenance/box identifiers stripped from everything edge-side (`manifest.ts:10-12`) | ok | — | — |
| Revoke (`lifecycle.ts:253-298`) | Tombstone written first, synchronously (R2 strongly consistent — next request 410s); bundle deletion best-effort after; `Cache-Control: no-store` throughout so revoked URLs can't serve from cache; partial cleanup risks orphaned bytes, never re-exposure | ok | — | — |
| Pre-auth oracle + log flood on `/a/` routes | Manifest status readable before Access verification; `any-account` access-log writes before asset validation | gap | low | public | [pub-worker-preauth-oracle-and-log-flood](../../issues/code-quality/2026-07-31-pub-worker-preauth-oracle-and-log-flood.md) |

### 6b. Account lifecycle

Onboarding and recovery have their own threat shape: who can claim an
identity, and what happens when someone is locked out. The rows below
also appear in §1/§2/§8 where they belong structurally; they are
gathered here so the lifecycle reads as one story.

| Item | Detail | State | Sev | Reach |
|---|---|---|---|---|
| First-run setup | `POST /auth/setup` claims the owner account on a zero-user box; in-memory token, 15-min TTL, printed to server console, self-disabling (`setup-token.ts`) | accepted | high | public | The setup-token window (§1, §8.1) — provision the owner promptly |
| Invite onboarding | 32-byte single-use capability, 15-min TTL, SHA-256 at rest, throttled; `/auth/invite` (`auth-invite.ts`, `auth-capabilities.ts`) | ok | — | public | The credential itself is a §2 row |
| Open-invite email ownership | An open invite lets the holder claim any unclaimed email; pinning to a known email is the mitigation | accepted | med | public | Bearer-link tradeoff (§8.3); pre-positions the claimed email for later grants |
| Password change | `/auth/password` requires the current password, bumps `gen`, revokes other sessions (`auth-password-change.ts`) | ok | — | authed | |
| Member password reset (operator-issued) | Owner mints a 15-min single-use reset link for one Allowed-User member (`admin.createPasswordReset`, `68c5e537`); member redeems it at `/auth/reset-password` without exposing the new password to the owner; consuming it bumps `gen`, revoking the member's other sessions; eligibility (member role + still on `allowedEmails`) is re-checked at redemption | ok | — | public route, owner-only mint | Reuses the invite-capability store/guarantees (§2). Implements option 2 of [web-password-reset-account-recovery](../../issues/closed/features/2026-08-07-web-password-reset-account-recovery.md) |
| Recovery / reset | Members now self-serve via an operator-issued reset link (row above). Owner recovery is still host-side only: `cb auth set-password`. Full email self-service reset was explicitly rejected (no outbound-mail identity); no MFA | accepted | med | local→owner | §8.2 — [web-password-reset-account-recovery](../../issues/closed/features/2026-08-07-web-password-reset-account-recovery.md) (resolution: implemented, option 2; option 3 rejected) |
| Member capability tier | A logged-in non-owner member reaches every non-`ownerProcedure` surface, including `scheduler.trigger` (member-level shell execution) and `drive`/`calendar.updateConfig` | gap | med | authed | Moot single-operator (fail-closed owner-only); a multi-member design decision — [member-level-writing-procedures](../../issues/code-quality/2026-08-07-member-level-writing-procedures.md) |

## 7. Cross-cutting threats

Sections 1–6 inventory what exists. This section names a threat that does
not reduce to any single row — it is the emergent risk of the
architecture. Prompt injection is the first and, today, the only entry;
add an entry when a second architecture-level threat earns one.

### 7a. Prompt injection via external content

**This is the most consequential security property of the system, and its
mitigations are thin. Stated plainly rather than reassured.**

callback-box is, by design, an agent that (a) reads your private data,
(b) ingests untrusted external content, and (c) acts with no tool
allowlist under `bypassPermissions`. That is the lethal trifecta: content
authored by someone else, reaching the agent's context, can attempt to
steer the agent's full capability (§4 agent blast radius is the "what it
can do" half of this; this is the "who can trigger it" half).

**Attack surface — every channel by which outside content becomes agent
context:**

| Channel | Source | file:line |
|---|---|---|
| Email bodies + attachments | Gmail connector | `src/connectors/gmail.ts` |
| Web clippings + frozen-page HTML | Chrome extension (`callback-clerk`) | `callback-clerk/src/platform/clerk-api.ts` |
| Telegram message text | Telegram connector | `src/connectors/telegram.ts` |
| Calendar event content | Calendar connector (attendee-supplied titles/descriptions) | `src/connectors/google-calendar.ts` |
| Image text (OCR/vision) | Scan-import + vision models — injection can hide *in a screenshot* | `src/services/scan-vision-claude.ts` |
| Voice transcripts | Transcription pipeline | `src/core/transcription/` |
| Card bodies generally | Any of the above lands as a card, and cards become agent context | `src/core/card-io.ts` |

**State: `gap` — high severity, largely unmitigated.** There is no tool
allowlist, no injection filter, no content-provenance boundary in agent
context. The controls that exist are indirect and deployment-shaped, not
containment:

- **Deployment model** — the audience is single-operator boxes; the
  blast radius is your own data, not other tenants'.
- **Schedules off by default** — nothing auto-processes untrusted input
  on a fresh box until the operator enables it ([schedules-off-by-default](../../issues/features/2026-07-20-schedules-off-by-default.md)).
- **Human-in-the-loop on the few gated actions** — the publish flip and
  credential-writing `cb auth` refuse to proceed unattended.

Honest read: a determined injection that reaches the agent has the
agent's full shell/file capability, and nothing structural stops it. The
containment direction is [agent-containment-allowed-directories](../../issues/features/2026-07-20-agent-containment-allowed-directories.md);
until that lands, this is a real and accepted-by-deployment-model risk,
not a solved one.

## 8. Accepted risks (roll-up)

Every `accepted` item, with its rationale:

1. **Setup-token window** — first-run setup is reachable unauthenticated
   until an owner exists; 15-min TTL + self-disabling route; provision
   promptly. (§1)
2. **No MFA; owner recovery is host-side** — members can now self-serve a
   forgotten password through an operator-issued reset link
   ([web-password-reset-account-recovery](../../issues/closed/features/2026-08-07-web-password-reset-account-recovery.md),
   implemented in `68c5e537`); the *owner's* own recovery is still
   `cb auth set-password` on the host, and full email self-service reset
   was explicitly rejected (no outbound-mail identity). MFA/passkeys
   deferred. (§1, §6b)
3. **Open invites don't verify email ownership** — an explicit
   bearer-link tradeoff; pin the invite when the email is known, transmit
   through a trusted channel. Claiming an email pre-positions that
   account for later grants; the admin-UI warning is advisory. (§2)
4. **Shared broad-scope Google token** — one refresh token, full
   `gmail`/`calendar`/`drive` scopes, fleet-wide; per-box `googleServices`
   policy is application-enforced, not a hard boundary. Single-owner
   assumption; hardening direction in
   [google-auth-policy-proxy](../../issues/features/2026-07-28-google-auth-policy-proxy.md). (§2, §3)
5. **Agent blast radius** — `bypassPermissions`, no tool allowlist,
   arbitrary shell as the box user; the product's design. Containment
   direction: [agent-containment-allowed-directories](../../issues/features/2026-07-20-agent-containment-allowed-directories.md). (§4)
6. **Boxes share one origin** — same-origin browser reach between
   sibling boxes; accepted single-operator; server-side forgery blocked.
   (§4)
7. **CSP is Report-Only** — enforcement is a staged, reviewed flip, not
   yet made. (§4)
8. **Cross-process lock lease-steal** — inherent to lease locks; needs a
   >5-min mid-critical-section suspension against a sub-millisecond
   synchronous RMW; effectively unreachable on the server deploy path.
   Accepted 2026-07-21 over fencing-token CAS. (§4)
9. **Leak-scan blind spots + bundles-are-public** — the human
   file-by-file preview is the real publish gate; binaries ship
   unscanned; tier gates viewers, not content. (§6a)
10. **`secret`-tier publications are capability URLs** — unguessability
    (≥128-bit) is the entire access control. (§6a)
11. **Prompt injection is unmitigated by containment** — accepted for now
    on the strength of the single-operator deployment model, not because
    the agent is contained; see §7a. This is the roll-up's most important
    entry.

Not in this roll-up because no acceptance decision has been made — these
are **gaps**, tracked, awaiting fix or a decision: bind host being
override-able (`mitigated`, §5), deploy infra drift (§5), the
member-capability tier (§6b), Cloudflare Flexible SSL edge→origin
plaintext (§5), the connector secret-file modes (§2), and two
location-precise defects tracked privately (§1).
