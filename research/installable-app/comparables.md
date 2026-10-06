# Comparables: packaging and remote access (2026-09-29)

Gathered from project docs. Cells left blank were not verified.

| Project | Packaging | Updates | Remote access | Disposition for beebox |
|---|---|---|---|---|
| Home Assistant | OS image (HAOS, recommended) or Container (no add-ons, manual updates) (<https://www.home-assistant.io/installation/>) | one-click on HAOS | Nabu Casa: paid, outbound SniTun relay, open code (<https://www.home-assistant.io/cloud/>) | **Adapt**: two tiers (appliance + container). **Reject** an own relay |
| Umbrel | umbrelOS image only; apps are compose projects from a store | Settings | Tailscale as a store app; tailnet-only (<https://umbrel.com/support/basics/remote-access>) | **Adopt** as a target: a community-store entry is small |
| Ollama | Menu-bar .app with the server binary inside (<https://docs.ollama.com/macos>) | background download, "Restart to update" | none; localhost unless `OLLAMA_HOST` | Shows the supervisor pattern; its runtime is one Go binary, ours is not |
| Open WebUI | Docker first; Electron desktop in early alpha (<https://docs.openwebui.com/getting-started/>) | Docker pull | none built in | Same shape as today's compose-first |
| Obsidian | Electron over a local vault | | Sync: paid, E2E encrypted (<https://obsidian.md/help/sync/security>) | Not comparable: no server |
| ComfyUI Desktop | Electron; bundles `uv`, builds the Python env on first run (<https://github.com/comfy-org/desktop>, archived 2026-06, superseded) | auto-updates app and uv | local | **Adapt** if Docling is ever bundled natively: ship uv, not a frozen Python |
| Immich | compose only; non-Linux "severely reduced" (<https://docs.immich.app/install/requirements>) | compose pull | | Confirms Docker-on-Mac friction |
| Nextcloud AIO | A mastercontainer driving `docker.sock` (<https://github.com/nextcloud/all-in-one>) | mastercontainer updates the rest | domain, or Tailscale / Cloudflare | Possible shape for a self-updating compose install |
| StartOS | OS image, `.s9pk` packages | | StartTunnel (WireGuard) | **Reject** as a target: high packaging effort |
| Sandstorm | app platform; company wound down 2017 (<https://sandstorm.io/news/2019-09-15-shutting-down-oasis>) | | | A business lesson, not a packaging one |
| OpenClaw | install script, npm, Docker, a macOS menu-bar app with a private Node runtime under launchd, Sparkle channels (<https://docs.openclaw.ai/platforms/macos>, <https://docs.openclaw.ai/install>) | Sparkle; app then gateway | gateway on loopback; `tailscale serve`/`funnel` on the host; auth modes none/token/password/trusted-proxy (<https://docs.openclaw.ai/gateway/tailscale>) | Closest analogue. **Adopt** its credential stance; **reject** its native-runtime route for now (see README) |

## OpenClaw detail

- iOS app on the App Store; finds gateways by Bonjour on the LAN and by
  unicast DNS-SD over Tailscale split DNS elsewhere; pairs with a setup code
  or QR (<https://docs.openclaw.ai/platforms/ios>). Beebox pairs by QR with an
  explicit `baseURL` and needs no discovery.
- Claude auth: an API key, reuse of the host's existing `claude` login
  (OpenClaw runs the CLI and never holds the token), or `claude setup-token`
  for remote hosts (<https://docs.openclaw.ai/providers/anthropic>).
- Its Tailscale history is the reason beebox's exposure code fails closed:
  see the incidents cited in
  `beebox/docs/implemented-plans/tailscale-expose-and-protect.md`.

## Cross-cutting

1. Two tiers are normal: an appliance or app for non-technical users, a
   container for technical ones.
2. Every surveyed Tailscale integration relies on a Tailscale client beside
   the app (host app, Umbrel store app, or container sidecar). None embeds
   tsnet in a desktop app.
3. Python-heavy desktop apps ship a package manager (uv) and build on first
   run, rather than freezing a Python.
4. No signing or notarization pain reports were found for any comparable.
   That is an absence of evidence.
