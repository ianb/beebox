# Packaging options (2026-09-29)

Items marked *(unverified)* came from secondary sources or could not be
confirmed.

## Native macOS menu-bar app with a bundled runtime

The shape: a Swift menu-bar app that supervises a bundled Node 24 and the
tools in [runtime-inventory.md](runtime-inventory.md) under launchd.
Precedents: OpenClaw's macOS app (private Node runtime, launchd, Sparkle —
<https://docs.openclaw.ai/platforms/macos>), Ollama.app (server binary at
`Contents/Resources/ollama` — <https://docs.ollama.com/macos>),
Postgres.app (server binaries under `Contents/Versions` —
<https://github.com/postgresapp/postgresapp>).

- **Signing.** Apple Developer Program, $99/year
  (<https://developer.apple.com/programs/enroll/>). Every Mach-O in the
  bundle gets Developer ID, hardened runtime, and a timestamp, or
  notarization fails. Node needs `allow-jit` and
  `allow-unsigned-executable-memory`; Node's own entitlement list is at
  <https://raw.githubusercontent.com/nodejs/node/main/tools/osx-entitlements.plist>.
- **Code built at run time.** Child processes carry their own signature's
  rules; the parent's entitlements do not pass down
  (<https://developer.apple.com/forums/thread/120647>). The bundled Node
  loading an addon that a box-local `pnpm install` just compiled needs
  `disable-library-validation`. Files fetched by curl, npm, or git get no
  quarantine flag, so Gatekeeper does not block agent downloads
  (<https://attack.mitre.org/techniques/T1553/001>).
- **Claude CLI.** It installs under `~/.local/share/claude/versions/`,
  self-updates, and is notarized by Anthropic
  (<https://code.claude.com/docs/en/setup>). It lives outside the app bundle,
  which keeps it out of the app's signature.
- **App translocation.** A quarantined app run from Downloads runs from a
  random read-only path. The app must detect this and ask to move to
  /Applications (<https://eclecticlight.co/2023/05/09/what-causes-app-translocation>).
- **Mac App Store: not possible.** Guideline 2.4.5 forbids downloading code;
  the App Sandbox is inherited by child processes, which would confine every
  agent shell
  (<https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html>).

## Electron or Tauri

- **Electron** ships a Node, but it is the wrong Node for this purpose.
  Agents run `node`, `pnpm`, and node-gyp against a real Node 24 inside
  boxes, and better-sqlite3 needs Electron's ABI under Electron
  (<https://github.com/WiseLibs/better-sqlite3/issues/1062>). The result is
  two runtimes and ~150 MB of Chromium for a supervisor that opens a browser
  tab.
- **Tauri** documents a Node sidecar pattern (`bundle.externalBin`,
  <https://v2.tauri.app/develop/sidecar/>) and has a signed updater
  (<https://v2.tauri.app/plugin/updater/>). It is the choice if Windows and
  Linux tray apps become goals. Nested-binary signing is still manual.
- For a Mac-only supervisor, Swift + Sparkle is smaller and more native.

## Auto-update and migrations

Sparkle 2 verifies EdDSA-signed updates from an appcast and supports deltas
(<https://sparkle-project.org/documentation/>). It replaces the bundle only.
Data migration stays the server's job: stop the server before install
(`SPUUpdaterDelegate` hooks), refuse to start on data newer than the code,
snapshot before migrating. Beebox already has the server half: the
container entrypoint runs `bbx engine migrate --apply --repair` inside a
maintenance window and stops serving when recovery is needed
(`beebox/docker/entrypoint.sh`). An app updater is a release channel, so it
depends on the
[release and update decision](../../issues/decisions/2026-07-20-release-discipline-and-update-story.md).

## App over a Linux VM running the existing image

One runtime everywhere: the same image on Mac, VPS, and NAS.

- **Apple Containerization / `container`**: open-source Swift, one light VM
  per container, macOS 26 and Apple silicon only; the Swift package can be
  embedded by a third-party app. The CLI removed subcommands and flags
  across 1.x releases *(release dates unverified)*; no compose support
  (<https://github.com/apple/container>).
- **Lima / Colima** (open source *(license unverified)*), virtiofs with the
  `vz` VM type (<https://lima-vm.io/docs/config/mount/>).
- **Costs:** a VM disk of a few GB *(unverified)*, a memory reservation
  (partly returned by a balloon device), and shared-folder latency, which
  hurts git and git-annex with many small files. Keeping boxes on the VM
  disk is fast but hides them from Finder and makes Time Machine back up an
  opaque image.
- **Credentials:** the same in-container login flows as compose.

## Driving Docker Desktop or OrbStack

Docker Desktop needs a paid subscription for companies over 250 people or
$10M revenue (<https://docker.io/pricing/faq/>). OrbStack is free only for
personal use (<https://docs.orbstack.dev/licensing>). A desktop app that
runs `docker compose` adds an install step and a license question and gives
little over the compose docs. Immich and Nextcloud AIO both document reduced
support on non-Linux Docker (<https://docs.immich.app/install/requirements>).

## Homebrew formula + launchd

The lightest native path: depend on `node@24`, `git-annex`, `pandoc`,
`imagemagick`, `poppler`; `brew services` installs a LaunchAgent; no custom
signing. Developer audience only. A Homebrew Node major bump breaks native
addons (see the `NODE_MODULE_VERSION` failure the dev checkout already hits);
pin `node@24`. This is close to the existing from-source path and adds
little.

## NAS and home-server targets

The existing image fits these with small manifests once it is published:

| Target | Work |
|---|---|
| Umbrel | `docker-compose.yml` + `umbrel-app.yml`; a community store is a git repo (<https://github.com/zapomatic/umbrel-apps>); the official store needs review |
| TrueNAS 24.10+ | "Install via YAML" takes a compose file (<https://www.truenas.com/docs/scale/24.10/scaleuireference/apps/installcustomappscreens/>) |
| Synology | Container Manager "Project" runs compose (<https://www.synology.com/en-us/dsm/feature/container-manager>) |
| CasaOS / ZimaOS | compose-based store; CasaOS core stalled at v0.4.15 *(per vendor page)* |
| StartOS | `.s9pk` with its own SDK; high effort (<https://docs.start9.com/packaging/0.4.0.x/publishing.html>) |
| Home Assistant add-on | fits poorly: HA ingress owns auth |

Umbrel already ships Tailscale as a store app, so a box on Umbrel reaches the
tailnet through the host (<https://umbrel.com/support/basics/remote-access>).

## Where box data lives on macOS

Put boxes in a visible, configurable `~/Beebox`, not `~/Documents` or
`~/Desktop`, which iCloud "Desktop & Documents" may sync. Cloud sync damages
git repos (iCloud renaming `.git` — <https://developer.apple.com/forums/thread/123145>).
Runtime state and logs go in `~/Library/Application Support`. Warn when a box
path is under `~/Library/Mobile Documents`, `~/Library/CloudStorage`, or
`~/Dropbox`. Exclude box `node_modules` from Time Machine.
