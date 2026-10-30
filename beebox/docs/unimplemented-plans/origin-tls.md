---
title: "Encrypt the Cloudflare-to-origin leg on the production server"
status: parked
workstream: origin-tls
issues:
  - ../../../issues/bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md
---
# Encrypt the Cloudflare-to-origin leg on the production server

Production traffic is HTTPS from the browser to Cloudflare and plain HTTP from Cloudflare to the origin. This plan adds a TLS listener with a Cloudflare Origin CA certificate, makes Cloudflare validate it, and blocks origin traffic that does not come from Cloudflare.

**Issues addressed:** [cloudflare-flexible-ssl-origin-plaintext](../../../issues/bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md). Search of the queue with `bin/issues similar` found no duplicate. The nearest item, the closed `deploy-infra-drift-setup-server-not-rerun`, removed the drift that the issue body describes.

## Activation

The boxholder paused this work on 2026-10-30 before any cutover step. What landed is inert: `hetzner/origin-firewall.sh`, `check-origin-tls-ref.sh`, the runbook, and the removal of the zone-wide Flexible PATCH from `create-server.sh`. Production is unchanged, and the plaintext leg remains.

The active changes are in commits `5c219bb6c` and `e7affaab3` in git history; a later commit reverted them. Make them again after the certificate is on the server:

1. In `deploy/nginx/beebox.conf`, add to the server block:
   ```nginx
   listen 443 ssl default_server;
   listen [::]:443 ssl default_server;
   ssl_certificate /etc/nginx/beebox-tls/origin.pem;
   ssl_certificate_key /etc/nginx/beebox-tls/origin.key;
   ssl_protocols TLSv1.2 TLSv1.3;
   ```
2. In `deploy/deploy.sh`, after the latest-requested selection, add `"$SCRIPT_DIR/check-origin-tls-ref.sh" "$MONO_DIR" "$SHA"`.
3. Update the two nginx deploy tests for the new listeners and certificate paths, and restore the rollback notes in `deploy/AGENTS.md` and `docs/server/deploying.md`.

Then follow the cutover order below.

## Design

No design section: this is server transport. A person using the box sees the same pages. One effect is visible in browser tools only: the password-login session cookie gains `Secure`.

## Smallest fix and budget

The smallest fix is a 443 listener and a Cloudflare setting. That fix encrypts the leg. It leaves the origin answering anyone who connects to its IP.

The chosen change has four tracks: the nginx listener, the rollback guard, the origin firewall script, and the provisioner and docs. Estimate: 120 changed source lines and 150 changed test lines. Docs: about 80 lines. No generated output.

The firewall is separable from the encryption fix: the script ships here, and running it is the boxholder's choice. I recommend it because the log shows real direct traffic. In the last 20,000 lines of the production access log, about 1,500 requests came from outside Cloudflare's ranges, and 155 of them received a 200.

## Stated preferences this plan trades against

- **Operational simplicity** (boxholder preference, recorded in memory): the plan adds no renewal job and no daemon. An Origin CA certificate lasts up to 15 years. The cost is one manual certificate install.
- **Bias toward strict:** nginx refuses to start without the certificate, so a deploy fails before it stops anything. The plan has no "TLS if the file exists" branch. The cost is that a new server needs its certificate before its first deploy.
- `beebox/deploy/AGENTS.md`, "Rollback": *"Any commit in history redeploys with one command"*. The rollback guard narrows this claim. A rollback to a commit with no TLS listener now needs an explicit override, because it would take the site offline.

## What already exists

- `deploy/nginx/beebox.conf:3`: *"deploy.sh installs this file on every deploy and reloads nginx only when it changed"*. Reuse. The listener ships through this path.
- `deploy/server-bin/bbx-nginx-site:13`: *"`nginx -t` runs on every install, changed or not"*, and `:61-70` restores the previous sites on failure. Reuse. This is the safety net for a missing or mismatched certificate.
- `deploy/nginx/beebox.conf:35`: `proxy_set_header X-Forwarded-Proto $scheme;`. Under Flexible this header says `http`. After cutover it says `https`, with no edit.
- `src/webapp/routes/auth/password-post.ts:162`: `secure: request.protocol === "https"`. Password-login cookies are not `Secure` today and become `Secure` after cutover. This is a fix.
- `src/webapp/routes/browser/proxy/person-gate.ts:81`: `origin === \`${request.protocol}://${request.host}\` || publicOrigin === origin`. The second clause passes today. After cutover both clauses pass.
- `src/webapp/routes/admin.ts:89`: uses `request.protocol` only when no public URL resolves. After cutover the fallback is correct.
- `src/webapp/routes/auth/google.ts:125`: `secure: publicUrl.startsWith("https")`. Not affected.
- `deploy/prod-curl:38`: `"http://127.0.0.1:${HUB_PORT}${REQ_PATH}"`. It talks to the hub and skips nginx, so it cannot verify the 443 listener. The runbook uses `prod-ssh` and `curl --resolve` instead.
- `deploy/deploy.sh:1106`: `http://localhost:3210/healthz`. The health check also skips nginx, so a deploy cannot detect a broken edge-to-origin path. The runbook checks the public URL.
- `deploy/hetzner/create-server.sh:129-133`: PATCHes the zone's SSL setting to `flexible`. Remove. A re-run would downgrade the whole zone.
- `test/deploy/nginx-site.test.ts` and `nginx-deploy-page.test.ts`: run a real nginx on the repository file. Extend.

Production state, read 2026-10-30 (read-only): nginx 1.24.0 listens on 80 only. `ufw` is inactive and iptables INPUT is ACCEPT. `hcloud firewall list` is empty. Public TCP listeners are 22 and 80. The UDP listeners on ephemeral ports belong to `pasta` (rootless Podman outbound networking), and `tailscaled` is inactive. The Hetzner firewall drops none of the traffic that needs to stay. The firewall is stateful for outbound-started flows, so these outbound uses keep working.

The production zone holds other proxied hostnames: the apex and `www` also resolve to Cloudflare addresses. A zone-wide SSL change affects them too. The Cloudflare API was not read, because no token is available here. The current mode is inferred from the port-80-only origin.

## Prior art (external)

- [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/): adopted. The dashboard shows the private key once. Visitors would not trust the certificate directly, which is acceptable because only Cloudflare connects.
- [Configuration Rules settings](https://developers.cloudflare.com/rules/configuration-rules/settings/): adopted. The SSL setting accepts `strict` per rule, and [Free plans get 10 rules](https://developers.cloudflare.com/rules/configuration-rules/).
- [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/): evaluated only. Global AOP *"only guarantees that a request is coming from the Cloudflare network"*. Own-certificate AOP proves the account, at the cost of one more certificate.

No `ACKNOWLEDGEMENTS.md` entry: these are vendor product docs, not project ideas.

## Ontology

- **Origin certificate:** the Origin CA certificate and key. It lives at `/etc/nginx/beebox-tls/origin.pem` and `origin.key` on the server, owned by root, key mode 0600. It is never in git. `deploy.sh` does not write this directory, and `bbx-nginx-site` copies only `sites-available` and `sites-enabled` (`bbx-nginx-site:35`).
- **Origin firewall:** a Hetzner Cloud Firewall named `beebox-origin`, attached to the server. It is outside the host.
- **Host SSL rule:** a Cloudflare Configuration Rule that sets Full (strict) for the production hostname only. It is not the zone's SSL mode.

## Tracks / scope

### Track 1: 443 listener

- **What:** the existing server block listens on 443 too.
- **Why this needs to change:** nothing can accept TLS at the origin today.
- **Direction:** add `listen 443 ssl default_server;`, its IPv6 twin, `ssl_certificate`, `ssl_certificate_key`, and `ssl_protocols TLSv1.2 TLSv1.3;`. The server-level `ssl_protocols` overrides the TLSv1 and TLSv1.1 that production's `nginx.conf:33` allows. No `http2` directive: the syntax differs across nginx versions, and [Cloudflare falls back to HTTP/1.1](https://developers.cloudflare.com/speed/optimization/protocol/http2-to-origin/) when the origin does not advertise HTTP/2. Port 80 stays open in nginx, so returning to Flexible stays one setting away. The firewall closes it from outside.
- **Vocabulary lock-ins:** the paths `/etc/nginx/beebox-tls/origin.pem` and `origin.key`.
- **First implementation chunk:** the config change and test updates. No open questions.

### Track 2: Rollback guard

- **What:** `deploy.sh` refuses a ref whose `beebox.conf` has no 443 listener.
- **Why this needs to change:** after cutover, a rollback to an older commit installs a port-80-only site. Cloudflare then gets connection refused on 443, and every request fails. The deploy's own health check stays green because it uses `localhost:3210`.
- **Direction:** after the lock and the latest-requested selection (`deploy.sh:312-316`), so a queued old ref is also checked, read `git show "$SHA:beebox/deploy/nginx/beebox.conf"`. If it lacks `listen 443 ssl`, exit with a message. `BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS=1` overrides. The guard runs in the invoking checkout's `deploy.sh`, which is current, so an old ref cannot skip it.
- **First implementation chunk:** the guard and a test of it.

### Track 3: Origin firewall script

- **What:** `deploy/hetzner/origin-firewall.sh` creates or updates the firewall from Cloudflare's published ranges.
- **Why this needs to change:** the origin serves anyone who finds the IP, and a 443 listener would also publish the production hostname to IP scanners through the certificate.
- **Direction:** fetch `https://www.cloudflare.com/ips-v4` and `ips-v6` with `curl -fsS`. Fail unless every line parses as a CIDR and the lists are not empty. Write rules: TCP 22 from anywhere, ICMP from anywhere, TCP 443 from Cloudflare, and with `--allow-http` TCP 80 from Cloudflare. Create the firewall if absent, run `replace-rules`, then attach it to the server. SSH stays open as it is today. Re-running is safe and is how range changes are applied.
- **First implementation chunk:** the script and a fake-`hcloud` test.

### Track 4: Provisioner and docs

- **What:** remove the zone-wide `flexible` PATCH from `create-server.sh` and print the certificate step. Update `provisioning.md`, `deploying.md`, `deploy/AGENTS.md`, and the stale cloud-init sentence at `beebox.conf:4`. Add the cutover runbook to `provisioning.md`. Update the security report row after cutover.
- **Why this needs to change:** the docs state Flexible, and the script would restore it.
- **First implementation chunk:** the edits. No open questions.

### Cutover order

Every step marked **yes** changes production or Cloudflare and needs the boxholder's own yes, including its reversal. The merge causes one ordinary deploy window: `deploy.sh:628-643` stops the services, and visitors see the deploy page. The cutover adds no outage beyond that window. Other steps do not interrupt service.

1. **Read first, no change.** The boxholder records the zone's SSL mode, any Configuration Rule or Page Rule matching the hostname, and any redirect rule. Later rules can override earlier ones ([execution order](https://developers.cloudflare.com/rules/configuration-rules/#execution-order)), so the new rule goes last. The recorded values are the reversal target.
2. **yes:** Create the Origin CA certificate for the production hostname and install it on the server. nginx does not read it yet.
3. **yes, optional:** Run `origin-firewall.sh <server> --allow-http`. This runs before 443 opens, so scanners never see the certificate. Confirm the public site loads and a direct-IP request times out. The encryption fix does not depend on this step.
4. **yes:** Merge. The deploy installs the site and `nginx -t` checks the certificate and key. If the check fails, the site stays up and the deploy stops.
5. Verify 443 at the origin: through `prod-ssh`, `curl --resolve <host>:443:127.0.0.1 --cacert origin_ca_root.pem https://<host>/auth/login` returns 200. `/healthz` needs the diagnostic key (`hub/server/health-routes.ts:43-50`), so it is not the probe.
6. **yes:** Add a diagnostic host SSL rule: Full (strict), for this hostname and the path `/__origin_tls_probe` only. Request that path through the public URL. The hub's own 404 proves that Cloudflare reached the origin on 443 through the firewall. A 521, 522, 525, or 526 proves the opposite, and only that path is affected.
7. **yes:** Widen the rule to the whole hostname. Verify: the public URL returns its login redirect, the app loads, chat's WebSocket connects, a fresh login sets a `Secure` cookie, and `ss -tn sport = :443` shows connections.
8. Confirm the edge redirect: `curl -I http://<host>/` returns 301 to HTTPS. Full (strict) follows the visitor's scheme ([Cloudflare](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/): *"If your visitor uses `http`, then Cloudflare connects to the origin using plaintext HTTP"*), so this redirect is what keeps HTTP visitors off the plaintext leg. Production returned this 301 on 2026-10-30.
9. **yes, optional:** When `ss -tn sport = :80` shows no established connections, run `origin-firewall.sh <server>` without `--allow-http`. Firewall changes affect new connections only ([Hetzner](https://docs.hetzner.com/cloud/firewalls/faq/#do-firewall-rules-apply-to-existing-connections)), and a long-lived WebSocket can stay on port 80 until the next deploy restarts the hub. The next deploy ends those connections, so plaintext traffic is finished only after one deploy following step 7.

**To reverse steps 6 and 7:** delete the rule, and Cloudflare returns to the value recorded in step 1. If step 9 ran, first run `origin-firewall.sh <server> --allow-http`.

## Could this be simpler?

The simplest version is the listener and a zone-wide flip. It fails on the other proxied hostnames in the zone, whose origins are not known to have valid certificates. The Configuration Rule costs one dashboard entry.

The firewall could be a dashboard entry with no script. That version fails when Cloudflare's ranges change, because someone must retype about 22 CIDRs. The script is about 50 lines.

The rollback guard could be a doc line. A doc line fails in the case that matters: an operator in an incident runs the documented "one command" rollback, and the site goes offline while the health check passes.

Removed from an earlier shape: a certificate-install script. Three runbook lines and `nginx -t` do the same checks.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Deploy runs before the certificate is installed | Add to `nginx-site.test.ts` | `bbx-nginx-site:61-70` restores and fails | Clear: deploy fails, site stays up |
| Certificate and key do not match | Same mechanism; `nginx -t` rejects | Same | Clear |
| Rollback to a commit with no 443 listener | Add a guard test | Track 2 | Clear: refused |
| Rule set to strict before 443 works | No | Runbook: step 6 tests one path first | Clear: Cloudflare 521/526 on that path only |
| Edge redirect absent, so HTTP visitors use port 80 in plaintext | No | Runbook step 8 checks it | Clear in that check, silent otherwise |
| Firewall omits SSH | Fake-`hcloud` test asserts the rule | Script always writes it; Hetzner console remains | Clear |
| Cloudflare adds a range and the firewall is stale | No | Re-run script; provisioning docs say so | Partly silent: visitors on that range get 522 |
| Ranges fetch returns HTML or an empty body | Fake-`curl` test | Script validates CIDRs and fails before writing | Clear |
| New server built: no certificate | No | `create-server.sh` next-steps text; `nginx -t` | Clear |
| Certificate expires (15 years) | No | Accepted: chosen validity is the maximum | Clear: Cloudflare 526 |

> **Accepted risk:** a stale firewall list is partly silent. Cloudflare rarely changes these ranges and announces changes. Re-running the script applies a change. No schedule is added, so someone must act on Cloudflare's announcement.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field, stale ref, two agents on one card, fabricated value: not applicable. This work has no cards and no agent-written values.
- Hand-edit drift: ADDRESSED. `beebox.conf:5` already says a hand edit is overwritten. The firewall script's `replace-rules` overwrites dashboard edits, so the header says to edit the script.
- Validation error UX: ADDRESSED. `nginx -t` output is printed by `bbx-nginx-site:62`, and the guard names its override.
- Partial migration: ADDRESSED by the cutover order. Before step 7 traffic uses 80; after it, new connections use 443. Open WebSockets on old connections end when the edge reconnects, and the app reconnects them as it does for any deploy.
- Logged-in sessions: ADDRESSED. The cookie keeps its name. The browser accepts the `Secure` replacement at next login, and old cookies remain valid until they expire.

## NOT in scope

- Authenticated Origin Pulls. The firewall already limits sources to Cloudflare. AOP adds protection only against another Cloudflare account pointing its zone at this IP, and that path meets the app's own login. Revisit with own-certificate AOP if this threat matters.
- Removing `listen 80` from nginx. The firewall closes it, and keeping it makes reversal one setting.
- Narrowing SSH to known addresses. It risks a lockout and is separate work.
- `trustProxy: true` and spoofable `X-Forwarded-For` (`hub/server/core.ts:291`). The firewall shrinks the exposure, but Cloudflare appends to a client-supplied header, so the leftmost value stays client-controlled. `login-throttle.ts:9` already designs for this.
- The container install path. It has its own TLS story (`docs/install/docker.md`).
- Changing the zone's SSL mode for other hostnames.

## Open design questions

None block the work. The boxholder may prefer a zone-wide flip if no other hostname depends on Flexible. The lean stays with the host rule, because it needs no audit of the other hostnames.

## Knowledge audits

Skipped: purely infrastructural. No box-agent concept changes.

## What will hold this after it ships

- `nginx-deploy-page.test.ts` runs the repository file under real nginx with a generated certificate. It proves that a request over TLS reaches the upstream with `X-Forwarded-Proto: https`, and that the deploy page is served on TLS.
- `nginx-site.test.ts` proves that a missing certificate fails the install and restores the previous site.
- A new `origin-firewall.test.ts` runs the script with fake `hcloud` and `curl` on `PATH`. It proves the SSH rule is always present, that port 80 appears only with the flag, and that a bad range list writes nothing.
- A guard test runs the check against a commit with no listener.

## Implementation order

1. Track 1 with tests.
2. Track 2 with its test.
3. Track 3 with its test.
4. Track 4.

Commits are checkpoints. The plan ships in one piece, when the boxholder says so.

## Rollout shape

Done when the tests above pass and cross-model review is complete. Then the cutover order runs, with the boxholder's yes at each marked step. No data migration. The security report row and the issue close after step 7, because the report describes the deployed posture and the merge alone does not change it. The firewall steps are not required for that close.
