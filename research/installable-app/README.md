# An installable beebox with Tailscale reachability (2026-09-29)

Question from the boxholder: could beebox ship as an installable app that
runs everything, packaged, with Tailscale making the box reachable from
anywhere?

This is a dated research snapshot. It does not change the
[container-first direction](../../issues/features/2026-09-06-container-install-is-the-primary-path.md);
it asks what an app would add on top of it.

| Note | Covers | Disposition |
|---|---|---|
| [runtime-inventory.md](runtime-inventory.md) | What the box needs on its host, measured on a Mac; where the Docker image differs from the server | Image drift filed as a bug |
| [packaging-options.md](packaging-options.md) | Native macOS app, Electron/Tauri, app-over-a-VM, Homebrew, NAS/appliance targets; signing, update, data location | NAS targets: adopt after image publish. VM app: later. Native bundle, Docker wrapper, Electron: reject |
| [tailscale.md](tailscale.md) | Embedded tsnet helper vs the user's Tailscale; onboarding, Funnel, certificates, iOS, security | Box-owned node + interactive onboarding: adopt. Funnel, TailscaleKit in iOS: reject for now |
| [comparables.md](comparables.md) | How Home Assistant, Umbrel, Ollama, Open WebUI, Obsidian, OpenClaw, and others package and reach their servers | Per-row dispositions inside |
| [phase0-apple-container.md](phase0-apple-container.md) | Hands-on: the image under Apple's `container` 1.5.0 with a Finder-visible box folder | Feasible; memory sizing, prebuilt image, and the image gaps are the conditions |
| [phase1-spike-app.md](phase1-spike-app.md) | Hands-on: a menu-bar app embedding Containerization boots the image and serves a box | Works; memory, stable address, and image delivery are the open items |

## Findings

1. **"Reachable from anywhere" needs an always-on host.** A laptop that
   sleeps is not reachable. The app question and the hardware question are
   the same question: the box runs on a Mac mini, a NAS, a home server, or a
   VPS. A menu-bar app on a MacBook is good for trying beebox. It is poor
   for a phone that captures to the box all day.
2. **The runtime is large and Linux-shaped.** A native Mac bundle carries
   about 1–1.5 GB of binaries before Docling (Node 121 MB, git-annex 180 MB,
   pandoc 258 MB, Claude CLI 213 MB, Codex CLI 229 MB, the
   ImageMagick/poppler/ffmpeg dylib closures). Docling brings PyTorch.
   `bbx host install` is apt-only, so box-requested host packages have no Mac
   equivalent. See [runtime-inventory.md](runtime-inventory.md).
3. **The dependency list already drifts between two runtimes.** The Docker
   image lacks `qpdf` and `uv`/Docling, which the server installs. In the
   container, PDF scan uploads get a 503 and document mode cannot run. A
   native Mac bundle would be a third list. Filed:
   [docker-image-missing-qpdf-and-docling](../../issues/bugs/2026-09-29-docker-image-missing-qpdf-and-docling.md).
4. **A native app gives up containment.** In the container, agents see
   `/data/box` and their own home. As a native Mac process, agents run as
   the user with the user's SSH keys, browser profiles, and every other
   file. The open containment items
   ([allowed-directories](../../issues/features/2026-07-20-agent-containment-allowed-directories.md),
   [cross-box isolation](../../issues/features/2026-09-04-cross-box-filesystem-isolation.md))
   get harder. A native app also gets the user's global
   `~/.claude` configuration (CLAUDE.md, hooks, MCP servers) in every box
   agent unless it sets `CLAUDE_CONFIG_DIR`, which the allowlist already
   passes through (`beebox/src/core/script-env/allowlist.ts:80`).
5. **The Mac App Store is not possible.** Guideline 2.4.5 forbids
   downloading code, and the sandbox is inherited by every child process.
   Distribution is Developer ID + notarization ($99/year) and Sparkle.
6. **Tailscale's friction is on the client devices and the certificate
   switch.** Tailnet-only access requires the Tailscale app and a sign-in
   on every client device. HTTPS certificates need a consent click and put
   the machine name in certificate-transparency logs. Funnel removes the
   client install but puts the login page on the public internet; beebox
   treats Funnel as a violation today (`tailscale-status` state 5) and that
   stays right.
7. **A box-owned tailnet node fixes the rename problem.** A small Go helper
   built on tsnet (or the official `tailscale/tailscale` container, which is
   the same thing packaged) gives the box its own device, name, and
   certificate. Renaming the Mac no longer orphans the serve mapping
   ([operational-polish #1](../../issues/features/2026-07-22-bbx-tailscale-dev-router-operational-polish.md)).
   There is no Node binding; a per-arch Go binary is the supported route.
8. **Comparables split two ways.** Mature projects offer an appliance or
   native app for non-technical users and a container for technical ones.
   OpenClaw, the closest analogue, ships a macOS menu-bar app with a private
   Node runtime under launchd, updated by Sparkle, and drives the host's
   `tailscale serve`. Nobody surveyed embeds tsnet in a desktop app. Umbrel,
   TrueNAS, Synology, and CasaOS accept a compose file with little change.

## Options

| Option | Cost to build | Cost to keep | Reachability | Gives up |
|---|---|---|---|---|
| **A. Native Mac app, bundled runtime** (Swift menu bar + Node + tools) | High: sign every Mach-O, Mac variants of host deps, Sparkle + migration hooks | High: a third dependency list; Mac-only | Only while the Mac is awake | Containment; `bbx host install`; Linux parity |
| **B. Mac app over a Linux VM running our image** (Apple Containerization or Lima) | Medium–high: VM lifecycle, file sharing, login flows | Low for the runtime (same image); medium for the shell | Same as A | Fast host-side git on box files; macOS 26 + Apple silicon if Apple's framework |
| **C. Desktop app that drives Docker/OrbStack compose** | Low | Low | Same as A | Nothing technical; adds a Docker Desktop or OrbStack license question and install step |
| **D. NAS / home-server app packages** (Umbrel community store, TrueNAS YAML, Synology project, CasaOS) | Low once an image is published | Low | Always on | Only users who own such hardware |
| **E. Keep compose as the product; make Tailscale a first-class part of it** | Low | Low | Wherever compose runs | A double-click install |

All options except A need a published image first
([installation-remaining-work](../../issues/features/2026-07-19-installation-remaining-work.md)
item 6). All options need the
[release and update decision](../../issues/decisions/2026-07-20-release-discipline-and-update-story.md),
because an app with an updater is a release channel.

## Recommendations

- **Adopt E now.** The installable thing is the compose project plus a
  Tailscale overlay that onboards interactively. The box owns its tailnet
  node (sidecar container, or a tsnet helper later); the admin
  Tailscale section shows the login URL, the node's name, and certificate
  state. Default is tailnet-only; Funnel stays refused. This is the
  "cloud enable" half of the ask, and most of it is built and unverified.
- **Adopt D next, after the image is published.** An Umbrel community-store
  entry and a TrueNAS/Synology compose recipe are each small. They put the
  box on always-on hardware, which the phone needs.
- **Later: B, if a double-click Mac install becomes the goal.** It keeps
  one runtime and keeps containment. Choose between Apple Containerization
  and Lima when the time comes; Apple's framework needs macOS 26 on Apple
  silicon and has broken CLI compatibility across minor releases.
- **Reject A for now.** It triples the dependency surface, removes
  containment, and still leaves the box asleep with the laptop. Revisit
  only if B's file-sharing cost turns out to hurt real use.
- **Reject C as a product.** It is a thin wrapper that adds a dependency on
  Docker Desktop or OrbStack licensing and gives little over compose.
- **Agent credentials:** keep the container's model (`claude auth login`
  and `codex login --device-auth` inside the container, or the
  `CLAUDE_CODE_OAUTH_TOKEN` fallback). Any app front door should run those
  flows in a terminal pane or show the URL and code, not store tokens
  itself. OpenClaw does the same: it runs the host's `claude` and never
  holds the token.

## What this costs and what we give up

E + D cost a published image, a release ritual, an interactive Tailscale
onboarding in the admin UI, and a few store manifests. We give up a
double-click install on a laptop, and every remote client still installs
the Tailscale app. We keep one Linux runtime, container containment, and
the container-first direction as the boxholder set it.

## Smallest first step

Run the Tailscale-only overlay once on the boxholder's tailnet (ledger item
2 in
[installation-remaining-work](../../issues/features/2026-07-19-installation-remaining-work.md),
about five minutes), and pair the iOS app to the resulting `ts.net` URL
from off the home network. It tests the "reachable from anywhere" claim
end to end with code that exists, and it tells us whether the auth-key step
is acceptable or whether interactive login is needed first. Filed as the
follow-up
[tailscale-onboarding-without-auth-key](../../issues/features/2026-09-29-tailscale-onboarding-without-auth-key.md).

## Not measured

- The size of a tsnet helper binary. The build was attempted; Go is not
  installed on this Mac and the Docker daemon was not running. Estimate from
  Tailscale's docs: 15–30 MB per architecture.
- Whether the `tailscale/tailscale` container prints a login URL when
  `TS_AUTHKEY` is absent (containerboot behavior); the follow-up issue asks
  for this check.
- File-sharing cost of option B against a real box with git-annex.
