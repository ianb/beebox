# Tailscale expose-and-protect

**Status:** implemented 2026-07 — Tracks A, B, C, and E (the `cb tailscale`
command family, the persisted-exposure listen-time guard, the router loopback
fix, and the OpenClaw research dispositions) are all landed and fully
unit-tested against injected fakes (4598/4598 green). Track D (rollout —
actually running `cb tailscale setup` against a real `tailscaled` on the
Mac/phone, the VPS, and prod) has not executed: nothing in this plan has been
exercised against real Tailscale infrastructure, so the exact `tailscale serve`
command spellings (`--bg`, `--set-path=… off`) are modeled in fakes and
unverified live. That live-proof gap is tracked in
[`issues/features/2026-07-19-installation-remaining-work.md`](../../../issues/features/2026-07-19-installation-remaining-work.md)
item 2, which stays open.

Make Tailscale a working, tool-driven way to expose callback-box deployments
(dev boxes behind the shared router; a deployed multi-user instance) while
keeping them off the public internet — via a `cb tailscale` command family that
inspects real state and says the next concrete step, not another prose path.
Tailscale augments the app's always-on auth; it never substitutes for it.

Driven by `issues/features/2026-07-20-tailscale-expose-and-protect.md`, whose
bar is explicit: "tooling, not documentation" — the existing documented variant
has never been exercised, and another untested guide would be the failure mode.
The boxholder's UX bar, stated directly: the installation process should always
present the single next step — "never just a bunch of stuff to read with
conditionals"; success should not require understanding Tailscale. That makes
`cb tailscale setup` a guided loop (below), not a printer of instructions.

A concrete driving scenario: reach a box running on the laptop — which roams
across arbitrary wifi networks — from a phone somewhere else entirely,
replacing the Cloudflare tunnel currently used for that. This is native
tailnet behavior: both devices are tailnet members, NAT traversal is
Tailscale's job, and the `https://<host>.<tailnet>.ts.net` name stays stable
across every network the laptop joins. The phone runs the Tailscale app
(iOS: a VPN profile — network-layer, so the callback iOS app needs no
changes); nothing is publicly exposed at all, which is strictly better than
the tunnel it replaces for a single-user device pair.

**What gets exposed is always a dedicated, auth-gated `cb serve`/`cb hub`
instance — never the dev router.** The router carries unauthenticated control
routes (`bin/router.ts:695` `/__router/status`, `:740` `/__router/retry/*`,
`:762` `/__router/stop/*`) that no downstream box auth protects; fronting it
with Serve would hand every tailnet member a worktree control plane. (Codex
cross-review finding 1; this constraint shapes Tracks A–C.)

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — especially fail-closed /
  resilient-not-silent (exposure must be explicit, never an accident of a
  default bind), validate-at-boundaries (all `tailscale` CLI JSON parsed
  through schemas at the subprocess boundary), and exhaustiveness (the status
  state machine enumerates every `BackendState`, with no permissive
  fallthrough — the exact bug class in OpenClaw's CVE, see Prior art).
- `callback-box/CLAUDE.md` — "don't add features beyond what the task
  requires" (bounds Track D and the NOT-in-scope list) and the validation
  contract.
- `callback-box/code-style.md` — no default parameters, injected-deps
  testability (the `DoctorDeps` shape).
- **Precedent: `cb pub setup` / `cb pub status`**
  (`callback-box/src/cli/commands/pub-setup.ts:49,110`) — an idempotent
  provisioning command paired with a drift-reporting status command for an
  external-service integration. This plan reuses the setup/status *pairing*;
  the guided wait-and-recheck loop is new (pub setup is one-shot).
- **Anti-precedent: the pub Access dashboard walkthrough**
  (`issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md`) —
  transcribed vendor-console steps rot; where a human step is unavoidable,
  detect state, say what's next, and link the vendor's own doc.
- **Open decision joined, not extended:**
  `issues/decisions/2026-03-15-per-box-secret-management.md` — no fourth
  secret-storage pattern (this plan needs none; see Track B).

## What already exists

- **The documented-but-untested path.** `callback-box/docs/docker-install.md:119`
  ("### Tailscale-only (no open ports)") tells the user to rebind compose from
  loopback to the tailnet IP and skip Caddy, with TLS as a one-line aside
  (`docker-install.md:131`: "Add TLS via Tailscale Serve if you want
  `https://`"). **Rebuilt** — the rebind-to-`100.x.y.z` shape is the worst
  variant (plaintext HTTP, bind moved off loopback); Track C replaces it with
  keep-loopback + `tailscale serve`. `issues/features/2026-07-19-installation-remaining-work.md`
  item 2 and `callback-box/docker/smoke-vps-install.sh:28` both record that no
  automation has ever exercised it.
- **The always-on auth layer this defers to.** `callback-box/src/webapp/auth.ts:117`
  (`authRequired()`, true by default), `auth.ts:103` (`openMode()` — the
  `CB_ALLOW_UNAUTHENTICATED` opt-out), `auth.ts:135`
  (`enforceOpenModeAtListen` — open mode `"1"` is permitted only on a loopback
  bind). Per-user identity lives in `~/.cb-auth.json` (owner/member roles);
  per-box access is `canAccessBox` (`callback-box/src/webapp/box-access.ts:19`),
  fail-closed to owner-only. **Reused untouched, with its limits named**:
  these guarantees hold only when auth is on — an open-mode server skips the
  box ACL entirely (`callback-box/src/webapp/server-box-scope.ts:107`:
  `case "open": return;`) — and they cover `cb serve`/`cb hub`, not the dev
  router. Both limits drive design choices below (the auth-posture guard;
  never exposing the router).
- **The injected-deps doctor pattern.** `bin/doctor.ts:47` ("every check is
  `(deps: DoctorDeps) => Promise<CheckResult>`"), `bin/doctor.ts:100,360`.
  **Pattern reused, surface not**: Track B's checks take an injected
  `TailscaleDeps` so `cb tailscale status` is fully testable without a
  tailnet, but the checks live under `cb`, not in the monorepo preflight —
  Tailscale is irrelevant to most contributors, and `bin/doctor.ts`'s own
  header records the deliberate choice not to build a shared check framework.
- **The bind-host landscape.** Backend children and prod hub bind loopback:
  `bin/router.ts:187` (children get `host: "127.0.0.1"`),
  `callback-box/src/cli/commands/hub.ts:54` (`config.host ?? "127.0.0.1"`),
  standalone `cb serve` defaults `localhost`
  (`callback-box/src/webapp/server.ts:187`). **The dev router does not**:
  `bin/router.ts:1052` calls `server.listen(ROUTER_PORT, ...)` with no host —
  all interfaces. Track A fixes this.
- **Prod exposure stack.** Cloudflare (Flexible SSL) → nginx :80 → loopback
  `cb hub` on the live server (hand-migrated; `deploy/README.md:85` records
  that `setup-server.sh` still generates the stale pre-hub unit, so the
  script is *not* evidence of the live shape). No Tailscale anywhere. Track D
  adds a tailnet path *alongside* it; nothing in the existing stack is
  rebuilt.
- **OpenClaw research corpus.** `research/openclaw-hermes/compare-security.md:101`
  names OpenClaw's `tailscale` auth mode but documents no mechanics, and its
  README disposition table has no entry for it — `compare-security.md:108`
  explicitly flags gateway auth as under-covered. Track E records the missing
  disposition using the external findings below.

## Prior art (external)

Searched during planning (2026-07-20):

- **OpenClaw's `tailscale` mode, mechanics.** Docs:
  <https://docs.openclaw.ai/gateway/tailscale>. `tailscale.mode:
  off|serve|funnel`; funnel *requires* password auth at startup. Identity is
  header + whois cross-check: Serve injects `Tailscale-User-Login`; OpenClaw
  independently resolves the request's `x-forwarded-for` via the local
  `tailscale whois` and accepts only on match, and only for loopback-arriving
  requests carrying all forwarded headers.
- **OpenClaw's two fail-open incidents — the cautionary core.**
  <https://github.com/openclaw/openclaw/security/advisories/GHSA-hff7-ccv5-52f8>
  (tokenless Tailscale header auth, scoped for one WebSocket, silently applied
  to all HTTP routes; fixed with a default-false flag) and
  <https://github.com/openclaw/openclaw/issues/50630> (CVSS 9.3: `serve` +
  `auth.mode: none` had no startup guard and an unconditional
  `{ ok: true }` branch, so tailnet membership silently became
  authentication). Also <https://github.com/openclaw/openclaw/issues/57241>
  (`serve` mode silently clobbered a previously-set funnel config on restart).
  These three drive this plan's fail-closed guards and drift checks.
- **Tailscale Serve identity headers.**
  <https://tailscale.com/docs/features/tailscale-serve>: Serve terminates TLS
  with an auto-provisioned cert and injects `Tailscale-User-Login` /
  `Tailscale-User-Name` / `Tailscale-User-Profile-Pic`; it strips those header
  names from incoming requests, so they're trustworthy only if the backend is
  reachable solely through Serve (bind loopback). Headers are absent for
  tagged-device and all Funnel traffic.
- **whois behind Serve.** LocalAPI `GET /localapi/v0/whois?addr=ip:port` over
  the tailscaled socket. Behind Serve the backend's TCP peer genuinely *is*
  localhost (tailscaled re-dials loopback), so an app cannot whois its own
  socket — the headers (or whois against `x-forwarded-for`) are the only
  identity channel. Tailscale's own reference proxy,
  <https://github.com/tailscale/tailscale/blob/main/cmd/proxy-to-grafana/proxy-to-grafana.go>,
  calls `LocalClient.WhoIs` on the real peer and requires Grafana's
  `whitelist = 127.0.0.1` as load-bearing config.
- **Funnel.** <https://tailscale.com/docs/features/tailscale-funnel>: public
  internet, no tailnet identity for visitors, ports restricted to
  443/8443/10000. Out of scope here (we have a public path already: prod's
  Cloudflare front).
- **Automation surface.** Auth keys
  (<https://tailscale.com/docs/features/access-control/auth-keys>): one-off vs
  reusable, ephemeral, pre-approved, tag-carrying; consumed by
  `tailscale up --auth-key`. OAuth clients can mint keys via API but require
  tags and a stored credential — rejected below. `tailscale status --json`
  exposes `BackendState` (`NoState|NeedsLogin|NeedsMachineAuth|Stopped|Starting|Running`),
  `Self.DNSName`, `Self.TailscaleIPs`, `CertDomains` (empty ⇒ the tailnet-wide
  HTTPS toggle is off); `tailscale serve status --json` reports the active
  serve config — the drift probe that would have caught OpenClaw #57241.
- **No Node tsnet.** tsnet (<https://tailscale.com/docs/features/tsnet>) is
  Go-only; the one community wrapper found is Bun-only. The supported Node
  pattern is system tailscaled + `tailscale serve` in front of a loopback
  bind — which is what this plan does.
- **Family access.** <https://tailscale.com/kb/1388/inviting-vs-sharing>:
  invite users to the tailnet (full members, subject to grants) vs share a
  single device cross-tailnet. Tailscale's own family guidance recommends
  invites for this shape.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — router binds loopback by default

**What.** `bin/router.ts` listens on all interfaces
(`bin/router.ts:1052`); change to `127.0.0.1`, unconditionally.

**Why this needs to change.** Every worktree box is reachable from the LAN
today and would be reachable from an entire tailnet the moment the Mac joins
one. Worse, it defeats the open-mode loopback gate: a child permits
`CB_ALLOW_UNAUTHENTICATED=1` because *its* bind is loopback
(`auth.ts:135`), while the router forwards non-loopback traffic to it. This
is the issue's named failure — "a machine that isn't on the tailnet should be
unreachable, not quietly public" — happening on the dev machine without
Tailscale even installed.

**Direction.** Bind `127.0.0.1` **unconditionally** — no `ROUTER_HOST`
escape hatch. The Codex cross-review is right that an env-var opt-out
"protected" by a startup log is a fail-open switch, not handling: the router
has no auth gate of any kind (its `/__router/*` control routes are
unauthenticated), so there is no legitimate non-loopback use case to serve.
Dev tailnet exposure never fronts the router; the phone scenario is served
by a dedicated auth-gated `cb serve`/`cb hub` bound to loopback (Track B),
which Serve fronts instead.

**Vocabulary lock-ins.** None (deliberately — no new knob).

**First implementation chunk.** The bind change + a router test asserting the
listen host. No open questions.

### Track B — `cb tailscale status` and `cb tailscale setup`

**What.** A `cb tailscale` command family in the `pub` shape: `status`
inspects real state and prints the next concrete step from wherever you are;
`setup` idempotently configures `tailscale serve` to front the loopback box
or hub and verifies the result. This is the issue's "`cb doctor tailscale`"
sketch under the existing command pattern — a new `doctor` namespace for one
integration would be the third diagnostic surface the issue warns about,
while `cb health` (scheduled-task health) and `bin/doctor.ts` (contributor
preflight) are both the wrong home.

**Why this needs to change.** There is no tooling at all; the only artifact is
untested prose. Every past state-drift incident here (pub Access dashboard
rot; OpenClaw #57241) argues for state inspection over instructions.

**Direction.** A `TailscaleDeps` interface (subprocess runner + probe fn),
mirroring `DoctorDeps` (`bin/doctor.ts:100`), so everything is unit-testable
without a tailnet. All `tailscale ... --json` output parsed with zod at the
boundary; unknown/missing fields are distinct failure states, never
undefined-propagation.

**The target is always explicit.** `cb tailscale status|setup --target
<port>` (port-only — the symbolic `hub|serve` forms and candidate discovery
were considered and deferred; refusing without a target is the shipped
behavior): the machine may be running a dev router, a standalone `cb serve`
(arbitrary host/port, `callback-box/src/cli/commands/serve.ts:95`), a hub
(`callback-box/src/hub/hub-config.ts:57`), or a Docker mapping, and guessing
across those is how the wrong thing gets exposed. The router is never a
valid target (Track A) — enforced structurally, not by port number: the
target is probed for the router's `/__router/status` signature and refused
on match, the `/auth/me` posture check accepts only callback-box's exact
response shapes (a generic 401 or arbitrary JSON is ambiguous ⇒ refuse),
and a target that also answers on any non-loopback interface is refused
(diff-review findings 4–5).

`cb tailscale status` is a state machine, exhaustive over the states below,
each emitting a next step (linking Tailscale's docs, never transcribing
their UI):

1. `tailscale` binary absent → platform install pointer.
2. `BackendState` ∈ `NoState|NeedsLogin` → interactive: "run `tailscale up`";
   headless: "run `tailscale up --auth-key=…`" + admin-console keys link.
3. `NeedsMachineAuth|Stopped|Starting|InUseOtherUser` → each its own explicit
   branch (`InUseOtherUser` — another user owns the daemon — is the
   seventh `ipn.State`; a "six states" schema would misreport a real,
   actionable condition as unrecognized output). Unknown future values get
   an explicit fail-closed branch (the anti-#50630 guard).
4. `Running` but `CertDomains` empty → "enable HTTPS certificates for your
   tailnet" + doc link (a real one-time human step with no API).
5. `Running`, serve unconfigured / pointing at the wrong target / **Funnel
   enabled for the hostname-port** → drift report or "run `cb tailscale
   setup`". Serve and Funnel share ports and `ServeConfig` carries
   `AllowFunnel`; "nothing publicly exposed" is an *invariant this tool
   checks*, not an assumption — any Funnel allowance on the target is a
   failing state. Config is read back via `tailscale serve status --json`
   / `serve get-config`, never inferred from what setup last wrote.
6. Serve correct → probe a semantic endpoint (`/auth/me`) on
   `https://<Self.DNSName>/…` — not `/`, which can 200 as a login SPA —
   verify the auth posture (below), and report the working URL. This local
   probe proves the serve path and auth posture only; it does *not* prove a
   second device's ACL/MagicDNS outcome — live acceptance comes from the
   phone (Rollout).

`cb tailscale setup` is a **guided loop**, not a one-shot: it runs the state
machine, and at each state either performs the step itself (the automatable
ones: serve config, verification) or prints exactly one human action —
"install Tailscale: <link>", "run `tailscale up`", "enable HTTPS certs:
<link>" — then waits and re-checks (prompt in a TTY; `--no-wait` exits with
the instruction for non-interactive use). The operator never reads a
conditional document; they do one thing, the tool re-inspects, and the loop
advances until it prints the working URL. Idempotent and re-runnable at any
state; `status` is the same state machine run once, read-only.

Serve mechanics locked down now (they bite otherwise): configuration uses
persistent mode (`tailscale serve --bg` / set-config — plain `tailscale
serve` is foreground and dies with the command); existing unrelated serve
path mappings are read first and preserved, never clobbered (OpenClaw
#57241's bug class); after any write, the full config is re-read and
re-verified rather than trusted.

**Auth-posture guard (the OpenClaw-#50630 analog in our codebase).** Serve
proxies to the box over loopback, so a server running
`CB_ALLOW_UNAUTHENTICATED=1` — legal because its bind is loopback
(`auth.ts:135`) — would be silently exposed, unauthenticated, to the whole
tailnet, and an open-mode server skips the box ACL entirely
(`server-box-scope.ts:107`). The guard must be **authoritative about the
running server, and durable across restarts** — two properties a naive
check lacks:

- *Probe, don't read env.* Calling `openMode()` from the CLI process reads
  the CLI's environment, not the running server's (which may live under
  systemd with its own env file). The guard instead probes the running
  target over HTTP. Settled during implementation: the existing `/auth/me`
  already reports posture (`routes/auth.ts` returns `{open:true}` in open
  mode) — no webapp route change needed. `{open:true}` ⇒ refuse; 401 or an
  authenticated user ⇒ proceed; unreachable/unparseable ⇒ refuse (fail
  closed).
- *Persist exposure intent.* Serve config is persistent; a later app restart
  into open mode would otherwise reopen the hole with only a stale-status
  warning standing guard. Settled during implementation: intent lives at
  `~/.config/cb/tailscale-exposure.json` (machine-level like the hub's
  config home — exposure is a machine fact, not a per-box one; env override
  for tests), written only after serve config is verified.
  `enforceOpenModeAtListen` (`auth.ts:135`) grows the corresponding check:
  open mode refuses to start while the bound port has recorded exposure —
  the same loud-startup-error shape it already has for non-loopback binds —
  and a corrupt intent file under open mode also refuses (fail closed).
  Both existing call sites (`server.ts:193`, `hub.ts:60`) inherit it.
- *Teardown is part of the lifecycle.* `cb tailscale stop` (added during
  implementation — the guard is only honest if it can be legitimately
  released) removes the target's serve mapping (preserving unrelated
  mappings), clears the intent entry, and re-verifies. Without it, the
  startup refusal would push operators toward deleting the intent file by
  hand, which is the fail-open workaround the guard exists to prevent.
- *The transaction runs guard-first (diff-review findings 1–2).* Intent is
  recorded — under `src/lib/file-lock.ts`, per repo policy — *before* any
  serve mutation, so every crash window leaves the guard over-armed rather
  than absent; a failed setup leaves intent standing (status reports
  intent-without-mapping as drift; re-run or `stop` heals). `stop` clears
  intent only after a read-back proves no serve/funnel mapping for the
  target remains — CLI-absent or unparseable read-back keeps the guard and
  exits nonzero. The Funnel invariant checks foreground serve configs too
  (`ServeConfig.Foreground`), not just the top-level `AllowFunnel` map.

`setup` refuses to configure serve unless the probe confirms auth is
required (no override flag in this plan); `status` reports the same probe as
a failing check whenever serve is already active.

**Secrets: none stored.** An auth key is consumed by `tailscale up` at join;
node identity then lives in tailscaled's own state. `cb` never persists a
Tailscale credential, and docs recommend single-use keys — so the per-box
secret-management decision is joined by *not needing an entry*, the one
resolution that adds no pattern.

**Vocabulary lock-ins.** Command names `cb tailscale`, `cb tailscale status`,
`cb tailscale setup`; `--json` on status.

**First implementation chunk.** `TailscaleDeps` + zod schemas for
`tailscale status --json` / `tailscale serve status --json` + the status
state machine with full unit tests (fake deps per state), human + `--json`
output. Setup is the second chunk. No open questions inside either.

### Track C — correct and prove the documented path

**What.** Rewrite `docker-install.md:119-132` around the tooling: keep the
loopback mapping, install Tailscale on the host, run `cb tailscale status`
and follow it. Document the official tailscale sidecar container
(`TS_AUTHKEY`) as the containerized alternative. Then actually exercise the
path end-to-end and record it in
`issues/features/2026-07-19-installation-remaining-work.md` item 2.

**Why this needs to change.** The current text prescribes the tailnet-IP
rebind: plaintext HTTP, bind moved off loopback, no identity headers, and
never once run. It also contradicts the fail-closed framing in
`docs/plans/installation-story.md`'s failure-modes table, which treats the
Tailscale variant as loopback-preserving.

**Direction.** For the from-source/VPS-host case the doc shrinks to: install
link, `tailscale up`, `cb tailscale setup`, done — the tool carries the
state-specific instructions. **Docker is a different topology and gets one
specified answer, not a menu**: `cb` runs inside the container
(`docker/compose.yaml:3`), which has no Tailscale and where `127.0.0.1:3210`
isn't the host mapping — so `cb tailscale setup` cannot run there against a
host daemon. The Docker path is the official tailscale **sidecar container**
(`TS_AUTHKEY` + `TS_SERVE_CONFIG`, Tailscale's own compose example), with
the box service keeping its loopback host mapping; `cb tailscale status`
inside the container reports tailscaled unreachable (the doc, not the tool,
routes container users to the sidecar section). The sidecar path carries a
stated tradeoff the docs must not paper over: it has no cb-side guard —
`TS_SERVE_CONFIG` is applied by the sidecar without any setup-time posture
probe, and the open-mode startup guard cannot see across container
filesystems — so keeping the box service loopback-mapped with auth on is
the operator's responsibility there (diff-review finding 9). Proof runs: (a)
locally on the boxholder's Mac (serve fronting a dedicated loopback
`cb serve`/hub — never the router), (b) the already-flagged VPS afternoon
for the Docker sidecar variant, sequenced *after* the Mac/phone proof.

**First implementation chunk.** The doc rewrite (landable once Track B's
status exists); the proof runs are rollout, not chunks.

### Track D — prod: additive tailnet path

**What.** Join the deployed VPS to the tailnet
(`tailscale up --auth-key` once, human-in-the-loop) and run
`cb tailscale setup` against the hub's loopback port, yielding a private
`https://<host>.<tailnet>.ts.net` path alongside the existing
Cloudflare/nginx public path. App auth gates both paths, with one stated
asymmetry: **the private origin supports local-password login only.** Google
OAuth builds its single callback URI from the canonical `CB_PUBLIC_URL`
(`callback-box/src/webapp/routes/auth-google.ts:39`), so a login begun on
the `.ts.net` origin would redirect back to — and set its cookie on — the
public origin. Rather than redesign the OAuth callback for multiple origins,
the tailnet origin's login page shows the local-password form (already every
user's baseline since local-password-auth shipped). Hub-mode identity
injection (`CB_HUB_SECRET` headers) is origin-agnostic and unchanged.

**Why this needs to change.** The issue names the deployed multi-user
instance as one of the two target environments. Additive-first is the only
responsible shape: *closing* the public path is gated on every family
member's every device joining the tailnet — a household decision, deferred
(see NOT in scope).

**Direction.** No new code beyond Track B; this track is running the tooling
on the server plus a short runbook note in `docs/health-checks.md`'s style
for the systemd context. `cb tailscale status` on the server reports both
paths' states.

**First implementation chunk.** None (no net-new code); executes during
rollout after Tracks B–C.

### Track E — research disposition

**What.** Add the missing disposition entry to
`research/openclaw-hermes/README.md` per `research/CLAUDE.md`: **adapt** the
post-fix whois-cross-check pattern (recorded as the documented future option
for Tailscale-SSO, mapping tailnet identity onto existing `~/.cb-auth.json`
records + `allowedEmails` only); **reject** header-trust-as-primary-auth and
any tailnet-membership-implies-authenticated mode, citing GHSA-hff7-ccv5-52f8
and #50630.

**First implementation chunk.** The README entry plus a short paragraph in
`compare-security.md` filling the mechanics gap it flags at line 108.

## Subplans

None. The one question big enough to deserve its own design step — Tailscale
identity as a login accelerator — is explicitly rejected for this plan (NOT
in scope) rather than subplanned; Track E records the shape it would take so
a future plan starts from the dispositions, not from scratch.

## Failure modes

**Critical gaps (each resolved in-plan):**

- Exposing an open-mode server to the tailnet —
  `CB_ALLOW_UNAUTHENTICATED=1` is loopback-legal (`auth.ts:135`), serve
  proxies over loopback, and open mode skips the box ACL
  (`server-box-scope.ts:107`) — OpenClaw #50630's exact shape. Handled by
  the probe-based guard at setup time *and* the persisted-exposure-intent
  check at server startup (a point-in-time CLI check alone would go stale on
  the first restart).
- Exposing the dev router's unauthenticated control plane
  (`bin/router.ts:695,740,762`). Handled structurally: the router is never a
  valid serve target and binds loopback unconditionally (Track A).
- A later `tailscale funnel` invocation making the "private" target public —
  Serve/Funnel share ports and `ServeConfig.AllowFunnel` is per-target.
  Handled: no-Funnel is a checked invariant in status state 5, failing loudly.

An honest limit that remains (not a gap to close, a property to state):
`status` is detection-on-demand, not continuous enforcement. The
startup-time exposure-intent check covers the restart-into-open-mode case;
a concurrent serve rewrite or port takeover between status runs is detected
at the next run, and the table below classifies those rows as detection,
not prevention.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `tailscale` binary absent / not executable | planned (fake deps) | status state 1 with install pointer | clear |
| `tailscale status --json` schema drift (field renamed/absent, e.g. deprecated top-level `MagicDNSSuffix`) | planned (zod reject fixtures) | parse failure is its own status state ("unrecognized tailscale output; version?") | clear |
| `BackendState` value outside the known seven (future Tailscale version) | planned | exhaustive switch with explicit unknown-state branch, fail-closed | clear |
| `CertDomains` empty (tailnet HTTPS toggle off) | planned | status state 4, admin-console link | clear |
| Serve config drifts (another process rewrote it, port stolen — OpenClaw #57241 analog) | planned | status diffs `serve get-config` vs expected target — detection at next run, not prevention | clear (detection) |
| Funnel enabled for the target hostname-port after setup | planned | no-Funnel invariant check in status state 5 — detection at next run | clear (detection) |
| Serve configured non-persistently (missing `--bg`) so exposure dies with the shell | planned (config read-back) | setup uses persistent mode and re-reads full config after write | clear |
| Setup clobbers an unrelated pre-existing serve path mapping | planned | read-first, preserve, re-verify | clear |
| Probe endpoint unreachable / ambiguous auth posture (incl. a non-callback-box process answering the port) | planned (probe fn injected) | refuse (fail closed); only callback-box's exact response shapes classify | clear |
| Crash between serve write and intent write | planned | intent written first; crash leaves the guard over-armed, status reports intent-without-mapping drift | clear |
| `stop` cannot prove the mapping is gone (CLI absent, readback fails) | planned | intent kept, nonzero exit | clear |
| `setup` targets a server running in open mode | planned | probe-based refusal + startup-time exposure-intent check in `enforceOpenModeAtListen` | clear |
| Server restarted into open mode after exposure was configured | planned | exposure intent persisted; open mode refuses to start (startup error) | clear |
| Ambiguous target (multiple loopback `cb` servers / router present) | planned | refuse and list candidates; router never a candidate | clear |
| Auth key pasted into shell history / logs during `tailscale up` | n/a (human step) | docs say single-use keys; `cb` never reads or stores the key | clear (documented risk) |
| Tagged-device or Funnel traffic assumed to carry identity headers | n/a in phase 1 (headers unconsumed) | Track E records the fail-closed rule for any future consumer | clear |
| VPS joins tailnet but nginx/Cloudflare path breaks (unrelated regression blamed on Tailscale) | rollout check | Track D is purely additive; status reports both paths | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A: no card-facing vocabulary; this is
  infrastructure and CLI surface only.
- **Stale ref** — N/A: no card refs introduced.
- **Two agents touching the same card** — N/A for cards; the analogous risk
  (two processes rewriting serve config) is ADDRESSED by the drift check in
  Track B's status state 5.
- **Hand-edit drift** — ADDRESSED: an operator running raw `tailscale serve`
  commands outside `cb` is exactly what `status`'s diff-against-expected
  detects and reports.
- **Fabricated free-form value** — N/A: status output is derived from
  inspected state, never composed by an agent.
- **Validation error UX** — ADDRESSED: the status states *are* the error UX;
  each failure names the state and the next step (the issue's "context aware
  instructions"), and `--json` gives agents the same structure.
- **Partial migration / transition state** — ADDRESSED for the one transition
  that exists: after Track A lands, any workflow that relied on LAN access to
  `:3210` breaks loudly (connection refused), which is the fail-closed
  direction; the supported replacement is a served, auth-gated target via
  Track B.

## NOT in scope

- **Tailscale identity as app login (SSO accelerator).** Rejected for this
  plan: OpenClaw shipped two fail-open incidents building exactly this, and
  our always-on app auth already covers identity. Track E records the safe
  shape for a future plan. (Traces to resilient-not-silent: don't add an auth
  path whose failure mode is silent identity substitution.)
- **Closing prod's public path.** A household-logistics decision (every
  family device on the tailnet), not an engineering one; Track D keeps it
  additive and documents closure as a later option.
- **Funnel.** Public exposure without tailnet identity duplicates what
  Cloudflare already provides for prod, and the phone-to-laptop scenario
  doesn't need it (the phone is a tailnet member). It remains the documented
  fallback if a genuinely public URL to the laptop is ever needed again.
- **ACL/grant automation via the Tailscale API.** Requires provisioning and
  storing an API credential — reopening the secret-management sore for a
  personal-scale tailnet. ACL verification is honest about its limits: the
  server-side probe cannot prove another device's ACL/MagicDNS outcome —
  live acceptance from the phone (Rollout) is what proves it. Manual, with
  links.
- **OAuth-client auth-key minting.** Fleet-provisioning machinery; two
  machines don't justify a stored credential.
- **A general `cb doctor`.** One integration doesn't justify a new diagnostic
  namespace; if one ever exists, Track B's checks feed it.
- **tsnet-style embedding.** Go-only; the sidecar/daemon pattern is the
  supported Node shape.
- **compose profile for the tailscale sidecar.** Documented as the
  alternative in Track C, not automated — the host-daemon path is primary and
  the sidecar is a straight copy of Tailscale's own compose example.

## Open design questions

- Should `cb status` surface a one-line Tailscale summary when serve is
  active? Lean: yes, later — after Track B ships and the output shape is
  proven; not part of this plan.
- ~~Where exposure intent is persisted~~ — settled (see the auth-posture
  guard section): `~/.config/cb/tailscale-exposure.json`, machine-level,
  consulted by `enforceOpenModeAtListen` only when open mode is requested.

## Knowledge audits

Skip, with rationale: this plan introduces no box-agent-facing concepts — no
tags, card shapes, or conventions a box agent must recall. The agent-facing
surface is `docs/agent-install.md`'s existing "widening exposure is a real
decision" guidance (`agent-install.md:59`), which Track C updates to point at
`cb tailscale status`; installing agents read that doc in-context rather than
recalling it, so no `knows_directly` entry applies.

## Implementation order

1. **Track A** — router unconditional loopback bind + test. Small,
   independent, and the fail-closed precondition for ever putting the dev
   machine on a tailnet.
2. **Track B chunk 1** — `TailscaleDeps`, zod schemas, the `status` state
   machine + tests, human/`--json` output.
3. **Track B chunk 2** — `setup` (serve config write, auth-posture guard,
   re-verify) + tests.
4. **Track C** — docker-install.md rewrite + agent-install.md pointer +
   installation-story failure-modes table correction.
5. **Track E** — research dispositions (independent; may land any time after
   the design is settled).
6. **Track D** — prod additive path (rollout execution, no code).

## Rollout shape

- **Test posture.** Tests first, as the design tool for the state machine:
  each status state is a named test with fake `TailscaleDeps` fixtures
  (including real captured `tailscale status --json` output once the
  boxholder's Mac has Tailscale, checked in as fixtures); zod-reject
  fixtures for schema drift; router bind test for Track A; setup tests cover
  idempotency (run twice ⇒ same state) and the auth-posture refusal. The
  plan's done-when, as tests: every row of the Failure-modes table with
  "planned" resolves to a passing test.
- **Verification requiring a human.** (a) Tailscale on the boxholder's Mac +
  phone, `tailscale up` on both: proves states 2→6 live, the dev-router serve
  path, and the driving scenario — phone on cellular reaching the laptop's
  served URL while the laptop sits on ordinary wifi. Once that holds, the
  Cloudflare tunnel it replaces can be retired (boxholder's call, outside
  this repo); (b)
  the "$5 VPS afternoon" already flagged in
  `2026-07-19-installation-remaining-work.md` proves the Docker variant;
  (c) prod join is Track D. Each run's outcome gets recorded in the
  remaining-work issue, converting "documented, never exercised" to
  "exercised on <date>".
- **Knowledge audits:** none (see section above).
- **Migration:** none — no data shape changes; the only behavior change is
  Track A's bind default, which is a fail-closed break with a loud log, not
  a migration.
