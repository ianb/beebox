---
title: "Self-hosted TURN relay for chat calls on the cloud server"
status: active
workstream: self-hosted-turn
issues: []
---
# Self-hosted TURN relay for chat calls on the cloud server

Chat calls need a TURN relay when two browsers cannot connect directly. Today the relay is Cloudflare's hosted TURN, used only when a box is granted the `cloudflare-turn` secret. This plan runs one coturn server on the production Hetzner host. The box server mints coturn credentials locally with an HMAC, so no outside account and no outside call are needed. The scope is cloud deploys with a public IP only (boxholder, 2026-11-13: "it's fine if this is only for cloud deploys, where there should be a public IP"). Local and Mac installs keep today's behavior.

**Decisions (boxholder, 2026-11-13):** "one TURN server for the machine is quite alright. We don't want it open, but it's not 'private' just 'don't let everyone use it'", then "Go ahead and implement". That accepts decision 4 (every granted box can read the shared secret). Decision 1 was not answered; the implementation takes the lean (coturn when granted, else Cloudflare, never both). Decisions 2 and 3 concern production and are open until rollout.

**Implementation notes (2026-11-13):**
- The smoke test runs in a Lima VM (`deploy/server-bin/bbx-turn-install.smoke.sh`), not Docker: coturn runs under systemd, and this machine has no Docker.
- coturn 4.6.1 reads `denied-peer-ip=::` as a range that denies every peer, IPv4 included; with it, every relay check failed with "peer IP … denied in the range: ::". The template omits it. coturn still refuses `::` as a peer (smoke test).
- The template is `deploy/coturn/turnserver.conf`, not `.template`: the helper appends the generated lines.
- `user-quota` counts allocations per username, and the username holds its expiry, so it limits one page's join, not one box. `total-quota` is the host-wide limit.
- deploy-status gets its own Relay section instead of a third line in `services`.
- Existing boxes get the grant by re-running `add-box.sh`, which already re-exports safely; no separate loop.

**Rollout (2026-11-13, boxholder: "yes, do the roll out. The cloud init should automatically do these things too"):**
- Production had no `cloudflare-turn` secret (decision 2), so before this rollout its calls had no relay.
- Set `turn-server` on the master store (secret generated on the server, piped through stdin); ran `bbx-turn-install`, which installed coturn 4.6.1-1build4 and passed its two-client relay check; deploy-status shows the relay active. No host firewall is active; the only other public UDP listener is the DHCP client.
- Granted and re-exported every box but one, with add-box.sh's guard, instead of re-running add-box.sh (which restarts the hub per box). One box was skipped: its own store holds entries the master lacks; the boxholder decides.
- End to end from outside the server: two relay-only peer connections in one browser page on the owner's box connected through the production relay (UDP, relay/relay pair) and passed a message.
- Not yet done: a call with a phone on cellular. Decision 3 (Ubuntu Pro) is still open.
- `hetzner/provision.sh` now writes `turn-server` on a new host from its public addresses.

**Issues addressed:** none. `bin/issues similar "self-hosted TURN coturn relay calls"` found no match. The closed `issues/closed/features/2026-11-11-voice-and-video-calls-in-a-shared-chat.md:30` named the option this plan picks up: *"run coturn on the box host (a new public port and service)"*.

## Design

No design section: the call UI does not change. A box with a relay reports `relay: true` as it does with Cloudflare today, and the failure text stays as it is (`src/frontend/src/components/app-bar-faces/CallBarFace.tsx:41`). A person on a call sees no difference, except that calls on blocked networks connect on boxes that had no Cloudflare key.

## Smallest fix and budget

**Smallest fix:** install coturn by hand on the server, add a `turn-server` secret, and make `mintTurn` produce HMAC credentials from it. About 60 source lines. It fails on the next fresh host (nothing records the install), on rotation (two copies of the secret drift by hand), and on the planned origin firewall, which would close the TURN ports silently.

**Chosen design, four chunks:**

| Chunk | Source | Tests | Docs |
|---|---|---|---|
| A. `turn-server` secret and local mint | ~90 | ~90 | ~15 |
| B. `bbx-turn-install` root helper, coturn config template, deploy step | ~170 | ~40 (smoke) | ~50 |
| C. Firewall rules, deploy-status, add-box grant | ~40 | ~20 | ~15 |
| D. Forced-relay switch and the verification run | ~10 | — | ~25 |

About 310 source and 150 test lines, plus about 105 doc lines. Not a BIG CHANGE. The fuller design buys a reproducible install (cloud-init and deploy hold it, per the rule in `docs/server/provisioning.md` that `deploy.sh` *"owns everything repo-shaped"*), one copy of the secret, and a visible health signal.

## Stated preferences this plan trades against

- **Operational simplicity beats per-call cost** (boxholder memory; applied to this exact choice in `docs/implemented-plans/chat-calls.md:167-169`: *"hosted TURN instead of running coturn"*). This plan reverses that choice for production. It must state the operational cost plainly; see *Operational cost of self-hosting* under Tracks. The boxholder confirms or declines it.
- **Bias toward strict / fail closed** (boxholder memory): no open relay, deny private and own-host peers, short credentials, deploy fails on a config that does not match the host.
- **Minimize invented concepts; prefer primitives** (boxholder memory): reuse the secret store, grants, `export-box`, the root-helper pattern of `bbx-browser-install`, and coturn's own TURN REST credential scheme. New nouns: one secret name and one helper.
- **`beebox/AGENTS.md` "no features beyond the task":** no TLS listener, no per-box coturn, no metrics.
- **Shipped precedent:** `deploy/server-bin/bbx-browser-install` (a root helper that deploy pipes over stdin, idempotent, quiet on success) and `deploy/add-box.sh:479-492` (grant `claude-oauth-token` when the master store holds it).

## What already exists

- **ICE server query** — `src/webapp/trpc/routers/chat-call.ts:82-89` returns `{ iceServers, relay, serverNowMs }`; line 89: *"return turn === null ? { iceServers: STUN_ONLY, relay: false, serverNowMs } : { iceServers: turn, relay: true, serverNowMs }"*. Reuse; add a second mint source.
- **Credential lifetime** — `chat-call.ts:24-25`: *"Long enough for a long call; a call that outlives it reconnects with fresh credentials."* `TURN_TTL_SECONDS = 3 * 60 * 60`. Reuse the constant. The second half of that comment is wrong; see Failure modes.
- **Secret reader pattern** — `src/core/cloudflare-turn-key.ts` resolves a JSON secret at `server` access with `resolveSecret` and `parseJsonSecret`. Copy its shape for `turn-server`.
- **Secret registries** — `src/core/secrets/format-registry.ts:74`, `guide-registry.ts:144`, `uses.ts:74` each have a `cloudflare-turn` row. Add `turn-server` rows beside them.
- **Mint log** — `recordSecretMint` (`chat-call.ts:57`). Reuse for the local mint so each credential issue stays logged.
- **Box secret distribution** — the master store is `/home/beebox/.config/beebox/secrets.json`; each box reads its own exported copy (`docs/server/boxes.md:120-123`: *"Grant on the master as `beebox`, then re-export that box"*). Reuse.
- **Root helper deploy step** — `deploy/deploy.sh:995-1002` pipes `bbx-browser-install` and `bbx-codex-sandbox-install` to the server and runs them as root after the restart. Reuse the pattern for `bbx-turn-install`.
- **Planned origin firewall** — `deploy/hetzner/origin-firewall.sh:41-43` allows 22 and ICMP from everyone and 443 from Cloudflare only. It is not in use (`deploy/README.md:22`). Add TURN rules so applying it later keeps calls working.
- **Deploy status** — `bin/deploy-status.ts:69`: *"systemctl is-active beebox-hub beebox-scheduler"*. Add `coturn`.
- **Call UI failure cause** — `src/frontend/src/lib/call-state.ts:91`: *"if (report === "failed") return { state: "failed", cause: relay ? "failed" : "no-relay" }"*. Unchanged.
- **Peer connection** — `src/frontend/src/lib/call/peer-link.ts:48`: *"new RTCPeerConnection({ iceServers: opts.iceServers })"*. Chunk D adds `iceTransportPolicy` here behind a debug switch.
- **Ports in use on the origin** — nginx listens on 80 only (`deploy/nginx/beebox.conf:7-8`); 443 is reserved by the parked `docs/unimplemented-plans/origin-tls.md`. The hub binds loopback (`src/hub/config.ts:111-112`: *"Default bind host … loopback only"*, `DEFAULT_HUB_HOST = "127.0.0.1"`).

## Prior art (external)

- coturn in Ubuntu 24.04 is 4.6.1-1build4, in **universe** — https://packages.ubuntu.com/noble/coturn, https://edge.launchpad.net/ubuntu/noble/+source/coturn. Evaluated. Consequence: Ubuntu's standard security updates cover main; universe fixes arrive by community upload or Ubuntu Pro (ESM Apps). Unverified for this host whether Pro is attached. `passt` is a universe precedent already on the host (`deploy/hetzner/cloud-init.yaml:48`).
- CVE-2020-26262: before 4.5.2 a peer address of `0.0.0.0` or `[::]` reached loopback — https://ubuntu.com/security/CVE-2020-26262, https://bugzilla.redhat.com/show_bug.cgi?id=1915045. 4.6.1 has the fix. Adopted anyway: deny `0.0.0.0/8`, `::/128`, `::1/128` explicitly.
- TURN REST API credentials (coturn `use-auth-secret` + `static-auth-secret`): username `<expiry-unix-seconds>:<id>`, password `base64(HMAC-SHA1(secret, username))`. Adopted. Source: coturn's `examples/etc/turnserver.conf` and the draft-uberti-behave-turn-rest-00 scheme. Unverified on 4.6.1 that the expiry is checked on Refresh as well as Allocate; chunk A's first commit checks it with `turnutils_uclient` before relying on the 3-hour comment.
- Hetzner traffic allowance: the production host is a cpx21 in Ashburn (`docs/server/provisioning.md:69`), and US locations include less traffic than EU ones (https://docs.hetzner.com/robot/general/traffic/). Unverified: the exact cpx21 Ashburn allowance. Audio relay is about 50 kbit/s per direction per pair; video is about 1–2 Mbit/s, so one hour of two-way relayed video is about 1–2 GB. Check the server's traffic graph after a week before calling traffic cost immaterial.
- coturn advisory GHSA-j8mm-mpf8-gvjg: IPv4-mapped IPv6 peers (`::ffff:a.b.c.d`) can bypass IPv4 `denied-peer-ip` rules — https://github.com/coturn/coturn/security/advisories/GHSA-j8mm-mpf8-gvjg. Adopted: deny `::ffff:0.0.0.0/96` and test mapped loopback and private peers on the packaged 4.6.1.
- TURN permissions are keyed by peer IP (RFC 8656, https://www.rfc-editor.org/rfc/rfc8656.html). Two members relayed through the same coturn send to each other's relay address, which is the host's own IP. So the host's own IP must be an allowed peer.
- No prior art needed for the call UI: it does not change.

## Ontology

- **TURN relay** (existing term, `chat-call.ts` comments): a server that forwards a call's media when peers cannot connect directly. Not the signaling channel.
- **`turn-server` secret** (new): store entry, JSON `{ "secret": "<64 hex chars>", "urls": ["turn:<ipv4>:3478?transport=udp", "turn:<ipv4>:3478?transport=tcp", "turn:[<ipv6>]:3478?transport=udp"] }`. Identified by the name `turn-server`. Shared by every box on the host by grant; one machine-wide value, never `turn-server/<slug>`. Not the Cloudflare key; the two never mix in one response.
- **coturn service** (new on the host): systemd unit `coturn` from the distro package, config `/etc/turnserver.conf`, one per host. Not per box.
- **`bbx-turn-install`** (new root helper): renders `/etc/turnserver.conf` from the master store's `turn-server` value and a template, installs coturn, restarts on change, verifies an allocation. Not run on local installs.
- **Relay source** (internal only, not a field): which secret produced the relay servers. Recorded in the mint log `purpose`, not returned to the client.
- `relay` (existing boolean, `chat-call.ts:82`): unchanged meaning, "a TURN relay is among the ICE servers".

## Tracks / scope

### Operational cost of self-hosting

What the boxholder takes on, compared with Cloudflare:

1. A new root-started daemon that accepts UDP and TCP from the whole internet on 3478 and a UDP relay range. coturn drops to the `turnserver` user.
2. Security updates for a universe package. Fixes are not guaranteed through standard Ubuntu updates. Mitigation: deploy-status shows the installed version; a known coturn CVE means a manual upgrade.
3. The origin's public IP goes to every call member in the TURN URLs and relay candidates. Members are signed-in box members. Today the web ports are not firewalled, so the IP is already reachable; once the origin firewall is applied, web traffic stays Cloudflare-only and only TURN ports are open to everyone.
4. Rotation touches the master store, every box's exported copy, and the coturn config. Calls through the relay fail between the deploy that re-renders coturn and the box re-export.
5. No TLS listener. Networks that allow only 443/TLS (some hotels and offices) get no relay. Cloudflare serves `turns:` on 443; this plan does not.
6. A host move changes the IP: the `urls` in the secret must change. The helper refuses to render a config whose URLs name an address the host does not hold, so the deploy fails with a message instead of calls failing silently.

What it removes: the Cloudflare account and key, per-GB relay charges above Cloudflare's free tier, and a 15-second outside call (`chat-call.ts:63-64`) on every call start.

### A. `turn-server` secret and local mint

- **What:** a reader `src/core/turn-server-key.ts` and a pure mint function; `mintTurn` prefers `turn-server` and falls back to `cloudflare-turn`.
- **Why:** the box server needs the shared secret and URLs to issue coturn credentials.
- **Direction:**
  - `getTurnServerKey(boxRoot, read): Promise<{ secret: string; urls: string[] } | null>`, resolving `{ name: "turn-server", purpose: "calls", access: "server" }`. Schema: `secret` matches `/^[0-9a-f]{64}$/`; `urls` is a non-empty array of strings matching `/^turn:[^?]+:3478\?transport=(udp|tcp)$/`, with at least one IPv4 host (the install check allocates over IPv4). Strict: anything else returns null with a warning naming the secret.
  - `restCredentials({ secret, nowMs, ttlSeconds, id }): { username: string; credential: string }` — `username = \`${Math.floor(nowMs / 1000) + ttlSeconds}:${id}\``, `credential = createHmac("sha1", secret).update(username).digest("base64")`. `id` is the box slug, so coturn's log names the box. Pure; unit tested against a fixed vector.
  - `mintTurn` (lean; waits for decision 1): if `turn-server` resolves, return `[{ urls: STUN on the same host + the key's urls, username, credential }]` and `recordSecretMint({ … secret: "turn-server", purpose: "call-relay" })`. Else the existing Cloudflare path. Else null. STUN comes from the same coturn, so a box with `turn-server` makes no outside call at all.
  - Registry rows in `format-registry.ts`, `guide-registry.ts`, `uses.ts`; a row in `docs/secrets.md`.
- **Vocabulary lock-ins:** secret name `turn-server`; JSON keys `secret`, `urls`; mint purpose `call-relay` (existing).
- **First chunk:** `turn-server-key.ts`, `restCredentials`, its test, registry rows. The `mintTurn` precedence waits for decision 1 (Open design questions); the precedence above is the lean.

### B. `bbx-turn-install` and the coturn config

- **What:** a root helper deploy runs every deploy, plus `deploy/coturn/turnserver.conf.template`.
- **Why:** the install must be reproducible and the secret must have one source.
- **Direction:**
  - `deploy/server-bin/bbx-turn-install <engine>`, piped over stdin after the Codex step (`deploy/deploy.sh:1000`), the same as `bbx-browser-install`.
  - Reads `turn-server` from the master store as root (the same file `add-box.sh:477-478` reads). If absent: `systemctl disable --now coturn` when installed, print one line, exit 0. A host without the secret runs no relay.
  - If present: `apt-get install -y coturn` when missing. Check every host in `urls` is an address on a local interface (`ip -j addr`); refuse otherwise (exit 1, deploy fails with the services already up).
  - Render to `/etc/turnserver.conf.new`, mode 0640 root:turnserver, then compare and replace; restart `coturn` only on change.
  - Verify: `turnutils_uclient` allocates through the first IPv4 address in `urls` (coturn does not listen on loopback) with a credential minted from the secret (`-W` REST secret flag; confirm the flag on 4.6.1 in the chunk). A failed allocation fails the deploy. This checks the daemon, not reachability from outside; chunk D covers that.
  - Template keys: `listening-port=3478`; `listening-ip` and `relay-ip` for each address in `urls` (no loopback listener); `min-port=49160`, `max-port=49999`; `use-auth-secret`; `static-auth-secret=<secret>`; `realm=beebox`; `fingerprint`; `no-tls`, `no-dtls`; `no-tcp-relay`; `no-multicast-peers`; `no-cli`; `no-rfc5780`; `no-stun-backward-compatibility`; `user-quota=20`; `total-quota=600`; `max-bps=3000000`; `stale-nonce=600`; `syslog`; `no-software-attribute`. `denied-peer-ip` for `0.0.0.0-0.255.255.255`, `10.0.0.0-10.255.255.255`, `100.64.0.0-100.127.255.255`, `127.0.0.0-127.255.255.255`, `169.254.0.0-169.254.255.255`, `172.16.0.0-172.31.255.255`, `192.0.0.0-192.0.0.255`, `192.168.0.0-192.168.255.255`, `198.18.0.0-198.19.255.255`, `240.0.0.0-255.255.255.255`, `::1`, `fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff`, `fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff`, `::ffff:0.0.0.0-::ffff:255.255.255.255`. The host's own public addresses stay **allowed**: two members relayed through this coturn reach each other at the host's IP, and denying it breaks the main case. `no-tcp-relay` keeps relays from opening TCP to nginx or sshd. A relay can still send UDP to any UDP port the host serves on its public address. Accepted risk: today no other public UDP service is expected (unverified on production; chunk B's first run records `ss -lun` in this plan). A future public UDP service on this host must weigh this.
  - No `external-ip`: a Hetzner Cloud server holds its public addresses on its own interface (verify with `ip addr` during chunk B's first run).
- **Vocabulary lock-ins:** helper name; template path; relay range 49160–49999 (840 ports; a four-person mesh uses at most about 6 allocations per person).
- **First chunk:** template, helper, deploy step, a Lima smoke script (the role `bbx-host-apt.smoke.sh` plays with Docker) that renders the config from a fake store and runs `turnserver` plus an allocation. No open questions.

### C. Firewall, status, grants

- **What:** keep TURN reachable when the origin firewall is applied; show coturn in deploy-status; grant new boxes automatically.
- **Direction:**
  - `origin-firewall.sh`: add `udp 3478`, `tcp 3478`, `udp 49160-49999` from everyone, behind no flag. Not applied by this plan.
  - `bin/deploy-status.ts:69`: add `coturn` to `systemctl is-active` and print `dpkg-query -W coturn` and whether the master store holds `turn-server`. `parseHealth` (`bin/deploy-status-lib.ts:132-134`) maps only the first two state lines to `beebox-hub` and `beebox-scheduler`, so a third line would be dropped silently; extend `unitNames`, the renderer, and the test. Inactive coturn with the secret present is degraded; no coturn and no secret is fine.
  - `add-box.sh`: grant `turn-server` when the master holds it, as for `claude-oauth-token` (`add-box.sh:479-492`).
  - Existing boxes: a documented one-time loop in `docs/server/boxes.md` (grant on the master, `export-box` per box).

### D. Forced relay and end-to-end check

- **What:** a debug switch so a real call uses only the relay.
- **Direction:** `peer-link.ts:48` passes `iceTransportPolicy: "relay"` when `localStorage["bbx.call.forceRelay"] === "1"` (read in try/catch). Verification: two browser profiles on one prod box with the switch on; the call connects; `chrome://webrtc-internals` shows the selected pair as `relay`/`relay`; coturn's syslog shows the two allocations with the box slug as id. Then repeat with one phone on cellular and the switch off.

## Could this be simpler?

- **Simplest:** hand-install coturn, put the secret in the store and in `/etc/turnserver.conf` by hand, add the HMAC mint. It fails on a new host (provisioning.md says nothing repo-shaped is hand-made) and on rotation (two hand copies), per *bias toward strict / fail closed* and the deploy rule.
- **Drop chunk D:** the verification needs a forced relay, and direct paths succeed on most test networks, so without it a broken relay passes the test. Ten lines.
- **Drop the own-host check in the helper:** a moved host would serve wrong URLs and every relayed call would fail with no deploy signal. Kept; about 15 lines.
- **Per-box coturn or per-box secrets:** rejected. One relay per host is enough; per-box secrets need coturn's database mode.
- **Use the bbx-host-apt path:** rejected. That path refuses packages with system units by design (`bbx-host-apt` header: *"ship no persistent root activation (system units …)"*).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `turn-server` value malformed in the store | Planned: reader test | Reader returns null with a warning; falls back to Cloudflare or STUN | Clear (warning, `no-relay` in UI) |
| coturn down while boxes hand out credentials | No (system) | deploy-status shows coturn inactive; UI shows "failed" | Clear in deploy-status; the person sees a generic failure |
| Secret rotated on master, box not re-exported | No | Runbook orders: re-export boxes, then deploy | Silent until a relayed call fails — accepted risk: rotation is a rare manual act with a written order |
| Host IP changed, `urls` stale | Planned: smoke test of the refusal | Helper refuses; deploy fails | Clear |
| Credential expires mid-call (3 h) | Planned: expiry check with `turnutils_uclient` on 4.6.1 | None. `chat-call.ts:24` says a long call *"reconnects with fresh credentials"*, but the engine fetches `iceServers` only at join (`src/frontend/src/lib/call/engine.ts:101-103`) and reconnects reuse the cached list (`engine.ts:157-182`). Pre-existing for Cloudflare too. | Clear only after a manual leave and rejoin; the comment is wrong. Out of scope; to be filed as an issue |
| Relay to a private, loopback, or IPv4-mapped address | Planned: smoke test tries `127.0.0.1`, `10.0.0.1` (IPv4 allocation) and `::ffff:127.0.0.1` (IPv6 allocation) peers, each denied with 403, and a peer on the host's own IP (allowed) | `denied-peer-ip` | Clear (403 from coturn) |
| Grant exported before coturn runs | No | Rollout order: deploy and verify coturn first, then grant and export | Silent (calls report a generic failure) — prevented by order, see Implementation order |
| Origin firewall applied without TURN rules | Planned: chunk C rule in the script | Rules added in the script itself | Clear |
| coturn CVE in universe with no update | No | deploy-status prints the version | Silent until noticed — accepted risk; boxholder decision 3 |
| Box user reads the HMAC secret from its own store file and mints relay credentials of any lifetime, outside `mintTurn` and its log | No | None. `export-box` copies values into each box user's store (`src/core/secrets/export-box.ts:30-45`); `server` access is a convention inside the engine, not a file barrier. The Cloudflare token has the same exposure today and also spends money. | Silent — boxholder decision 4 |

No unresolved critical gap: each silent row is an accepted risk with its reason.

## Agent-flow / user-flow edge cases

- Wrong secret picked — ADDRESSED: one fixed precedence in `mintTurn`; never both sources in one response.
- Stale ref — ADDRESSED: host-address check in the helper.
- Two agents on one card — no card is involved.
- Hand-edit drift — ADDRESSED: the store value is the only copy; `/etc/turnserver.conf` is rendered each deploy and overwritten.
- Fabricated value — no free-form agent value.
- Validation error UX — ADDRESSED: reader warning names `turn-server` and the bad field; helper refusal names the address that is not on the host.
- Transition state — ADDRESSED: boxes without the grant keep Cloudflare or STUN; the helper with no secret disables coturn. Order matters: a box granted before coturn runs hands out a dead relay. Rollout is master secret, deploy, verify, then grant and export (Implementation order step 5). Rotation has the same window.
- Local and Mac installs — ADDRESSED: they never get the grant or the helper; behavior is unchanged.

## NOT in scope

- TLS (`turns:`) on 5349 or 443: needs a public certificate on a hostname that resolves to the origin, a DNS change, and renewal; 443 is reserved by origin-tls. Revisit if relayed calls fail on 443-only networks.
- Applying the origin firewall: owned by the parked origin-tls plan.
- DNS names for TURN: IP literals in `urls` avoid a DNS change.
- Docker-install self-hosters with public IPs (`docs/install/docker.md`): boxholder scoped this to the cloud deploy.
- Fallback from coturn to Cloudflare at call time: would require offering both; see Open design questions.
- Metrics, Prometheus, per-box usage accounting.
- Removing `cloudflare-turn` code: local installs and decision 1 still use it.

## Open design questions

1. **Keep Cloudflare as a fallback?** (a) Replace: production boxes get `turn-server` only; the Cloudflare grant is revoked; the code stays for local installs. (b) Offer both: browsers choose among relays by ICE priority, so Cloudflare would carry some calls and charge for them even when coturn works, and it adds 443/TLS coverage. Lean (a).
2. **Is a Cloudflare key in use in production now?** Not checked: this plan did not touch production. If none is granted, today's production calls are STUN-only and this plan adds the first relay.
3. **Accept coturn from universe?** Alternative: Ubuntu Pro (free for up to 5 machines) for ESM Apps security updates. Lean: accept universe, attach Pro if not attached.
4. **Accept that every granted box can read the shared HMAC secret?** A box user can mint relay credentials without the log and spend the shared quotas. Alternatives: a host-side mint the box asks over a socket, or per-box coturn users. Both add a subsystem. Lean: accept, as with today's Cloudflare token; family boxes on one host trust each other at this level.

## Knowledge audits

Skip: purely infrastructural. No box agent concept changes.

## What will hold this after it ships

- Unit test for `restCredentials` with a fixed vector, and for `mintTurn` precedence (stubbed secret reads). Existing test tier.
- Docker smoke test for `bbx-turn-install` (render, refuse on wrong IP, allocate, deny `127.0.0.1` and `10.0.0.1` peers, deny `::ffff:127.0.0.1` from an IPv6 allocation, allow a peer on the host's own IP). Same tier as `bbx-host-apt.smoke.sh`; run when the helper or template changes.
- deploy-status test case for coturn inactive versus absent (`bin/deploy-status.test.ts`).
- Every deploy's allocation check in the helper.
- The forced-relay end-to-end call is a one-time manual verification, recorded in this plan when done.

## Implementation order

1. A: reader, `restCredentials`, registries, tests, secrets doc row. Then the `mintTurn` branch, in the shape decision 1 picks.
2. B: template, helper, smoke test, deploy step, provisioning doc (cloud-init adds no package: the helper installs it).
3. C: firewall rules, deploy-status, add-box grant, boxes doc loop.
4. D: forced-relay switch; chat-calls doc update.
5. With the boxholder's yes: set `turn-server` on the master; deploy (the helper installs and verifies coturn); confirm deploy-status shows coturn active; then grant and export each box; run the D verification.

## Rollout shape

Done when: the `restCredentials` and `mintTurn` tests pass; the helper smoke test passes; deploy-status shows `coturn active` on production; a forced-relay call between two profiles connects with a relay/relay pair; a call with a phone on cellular connects. No data migration. No knowledge audits. Rollout step 5 touches production and needs its own yes.
