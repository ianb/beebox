# Tailscale for an installable box (2026-09-29)

Builds on the planning research in
`beebox/docs/implemented-plans/tailscale-expose-and-protect.md` (prior art,
OpenClaw's fail-open incidents, the no-Funnel invariant) and the
[first-live-run issue](../../issues/features/2026-07-22-bbx-tailscale-dev-router-operational-polish.md).
Items marked *(unverified)* could not be confirmed from primary sources.

## What exists

- `bbx tailscale status|setup|stop` drives the user's installed `tailscale`
  CLI: `tailscale serve --https=443` in front of a loopback port, with a
  status state machine that refuses Funnel
  (`beebox/src/services/tailscale-status/core.ts`).
- `beebox/docker/compose.tailscale.yaml`: an official `tailscale/tailscale`
  sidecar with its own node identity, `TS_AUTHKEY` from a sidecar-only env
  file, and a serve config proxying to `http://box:3210`. Validated with
  `docker compose config`; never run against a real tailnet.
- The admin UI Tailscale section reports status.

## Two ways to own the tailnet presence

**The user's Tailscale app (today's `bbx tailscale`).** The box shares the
Mac's node and name. Renaming the Mac orphans the serve mapping. The three
macOS variants differ: App Store (Network Extension), Standalone (System
Extension, the recommended one), and the open-source `tailscaled`. Serve of
a port works on the GUI variants; Funnel on them is documented both ways,
so treat it as unsupported
(<https://tailscale.com/docs/concepts/macos-variants.md>). Tailscale warns
against installing both GUI variants.

**A node owned by the box.** tsnet (Go, v1.102.5 on 2026-09-24,
<https://pkg.go.dev/tailscale.com/tsnet>) makes each server its own tailnet
device with its own `Hostname`, MagicDNS name, and `ListenTLS` certificate.
State lives in `Dir/tailscaled.state`. Login takes an auth key, an OAuth
client secret, or an interactive login URL (`Status().AuthURL`, also printed
to the log). The `tailscale/tailscale` container is the same idea packaged
for compose.

- No official Node binding. libtailscale (C) has Python, Ruby, and Swift
  bindings but a narrower API: no `ListenTLS`, no login-URL callback
  (<https://github.com/tailscale/libtailscale/blob/main/tailscale.h>). The
  supported route for a Node app is a small per-arch Go helper that
  reverse-proxies to the loopback port.
- Helper size: not measured (Go not installed, Docker daemon down). Estimate
  15–30 MB per architecture from
  <https://tailscale.com/kb/1207/small-tailscale/> *(unverified)*.
- A user-signed node key expires after 180 days by default; tagged nodes do
  not (<https://tailscale.com/docs/features/access-control/key-expiry.md>).
  An interactive-login box needs a "sign in again" prompt in the admin UI, or
  the user disables expiry for that machine.
- Renaming the host no longer matters; the box keeps its own name.

## Onboarding a user with no Tailscale account

Sign-up is social login or passkey only
(<https://tailscale.com/docs/integrations/identity.md>). The Personal plan is
free for 6 users with unlimited user devices (<https://tailscale.com/pricing>).
The lowest-friction path found:

1. Create a Tailscale account.
2. The box shows its login URL in the admin UI; the user signs in.
3. Enable HTTPS certificates through a consent link (Serve raises it with
   `enableFeatureInteractive`; tsnet has no equivalent helper, see
   <https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/serve_v2.go>).
4. Install Tailscale on the phone; sign in to the same account.
5. Pair the beebox iOS app with the `ts.net` URL from the pairing QR.

Family members each need their own Tailscale account and the app; the box
can be shared to them by invite link, and a shared machine is reachable only
by its full `ts.net` name (<https://tailscale.com/kb/1084/sharing>).

## Certificates

HTTPS is an admin-console switch and is not on by default
(<https://tailscale.com/docs/how-to/set-up-https-certificates.md>). Enabling
it publishes machine names in certificate-transparency logs; Tailscale warns
against sensitive machine names. Re-issuing certificates too often can hit
Let's Encrypt limits for about 34 hours, so setup retries must not request a
new certificate each time. Pre-provisioning with `tailscale cert` (polish
item #2) fits this.

## Funnel

Ports 443/8443/10000; all plans; requires HTTPS and a `funnel` node
attribute that `tailscale funnel` adds through a browser approval
(<https://tailscale.com/docs/features/tailscale-funnel.md>). tsnet's
`ListenFunnel` fails without that approval and cannot raise it. Funnel
removes the client install but puts the box's login page on the public
internet, discoverable through CT logs. The password wall and device-token
checks would then face internet-wide attack. Keep the existing refusal;
revisit only with rate limiting and lockout verified.

## iOS and web clients

- A tailnet-only box is unreachable from a phone without the Tailscale app,
  unless the beebox app embeds TailscaleKit (libtailscale's Swift binding,
  <https://github.com/tailscale/libtailscale/tree/main/swift>). Embedding
  makes the phone its own tailnet device with its own sign-in, covers only
  the native app's requests, and the chat web view loads from the box, so
  it would need routing through the embedded client too. Not recommended now.
- The pairing link already carries `baseURL`
  (`beebox/docs/mobile-contract.md` §1.1). A box-owned node gives that URL a
  stable host, which is the main gain for iOS.
- iOS runs one VPN at a time; a user with a work VPN cannot run Tailscale at
  the same time (<https://tailscale.com/docs/reference/faq/other-vpns>).
- Push notifications from a box to a store-distributed app need a relay
  regardless of Tailscale
  ([apns-push-relay](../../issues/features/2026-09-26-apns-push-relay-for-a-shared-app.md)).

## Security posture

Tailnet-only: the network restricts who can reach the login page; the
box's own password and device tokens still decide who gets in. Tailscale
identity headers stay unconsumed (rejected as login in the soft-launch
posture). A box-owned node with interactive login belongs to the user who
signed in, so every device on that user's tailnet can reach the login page;
ACLs can narrow that, but default onboarding should not ask the user to
edit them.

## Alternatives, briefly

- Cloudflare Tunnel needs a domain in Cloudflare DNS; Quick Tunnels have no
  SSE, which rules them out for chat streaming
  (<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>).
- ngrok's free tier puts a warning page in front of the site.
- headscale replaces the coordination server; tsnet supports its
  `ControlURL`, but someone runs the server and phones still need a client.
- An own relay (Nabu Casa's model) means running public infrastructure.
