# Deep dive: installation & distribution — OpenClaw, Hermes, and the wider field

*2026-07-12. Method: web research over docs.openclaw.ai (install, installer
internals, VPS, gateway security), hermes-agent.nousresearch.com docs, and a
survey of comparable self-hosted projects (n8n, Supabase, Umami, LibreChat,
Open WebUI, Home Assistant, Coolify), plus an inventory of callback-box's own
current install surface. Written to inform the installation story for the
open-source release; coordinates with
[`source-available-release.md`](../../callback-box/docs/plans/source-available-release.md)
(Tracks C/E/F) rather than duplicating it.*

## 1. What the two competitors actually do

### OpenClaw

The lead path is `curl -fsSL https://openclaw.ai/install.sh | bash`, with npm/
pnpm/bun globals, a prefix-isolated variant (`install-cli.sh`, everything under
`~/.openclaw` including a SHA-256-verified pinned Node tarball), Docker, Nix,
and Ansible as alternatives. The installer provisions Node itself (Homebrew /
NodeSource / winget / portable download) if missing. After install,
`openclaw onboard --install-daemon` runs an interactive wizard: pick provider →
enter API key → configure the Gateway → install the OS daemon. Verification is
first-class: `openclaw doctor`, `openclaw gateway status`, `openclaw dashboard`.

State: everything under `~/.openclaw/` (config, credentials, per-agent auth
profiles, transcripts), overridable by env vars; docs tell you to `chmod 600`
and assume anything in there holds secrets.

Server story: first-party per-provider guides (Hetzner, DigitalOcean, Fly.io,
GCP, Azure, Oracle, Railway, Hostinger, Raspberry Pi, …). The model is
"Gateway on the VPS owns state; you connect from laptop/phone via the Control
UI or a tunnel." Security posture is loudly documented: loopback-only bind by
default, fail-closed token/password auth, DM pairing with expiring codes,
high-risk tool categories off by default, an incident-response runbook.

Reception lesson: the ~10-minute one-command setup is genuinely praised, but
OpenClaw's dominant public narrative is the *security* one ("400K lines of
vibe-coded monster", pen-test findings, "you are not supposed to install this
on your personal computer"). The explicit threat-model doc and
loopback-by-default posture are what let them survive that scrutiny. The
install UX was never the complaint; the blast radius of what got installed was.

### Hermes

Same lead shape: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh |
bash`, plus a native Windows PowerShell installer and a desktop app. The
installer bundles *everything* (Python 3.11, Node, ripgrep, ffmpeg, MinGit on
Windows) — zero assumed prerequisites. Onboarding optimizes for
"first message in seconds"; `hermes setup` is the full wizard, `hermes doctor`
the checker. State under `~/.hermes/` with a `.env` the wizard writes.
Contributor dev setup (uv venv, editable install, test script) is documented
separately from the user install — a clean two-audience split.

Server story: Docker is the recommended deployment (`nousresearch/hermes-agent`
image, compose example with `restart: unless-stopped` and `~/.hermes` volume-
mounted); provider-specific VPS guides are all third-party. One documented
sore point (their issue #36970): the desktop client can't onboard against a
remote server instance — remote mode exists but setup never mentions it, so it
"feels unsupported."

Also notable: `hermes claw migrate` imports settings/memories/skills/keys from
an OpenClaw install — install UX as a competitive weapon.

## 2. What the wider field converged on (2025–2026)

- **docker-compose is the default distribution for anything with state or
  services** (n8n, Supabase, Umami, LibreChat, Open WebUI). The stated reason
  is native-module/Node-version hell: the image ships prebuilt binaries, so
  the #1 support burden disappears. Source installs are documented as the
  fallback for people who refuse Docker.
- **curl|bash is for whole-platform provisioning on a fresh box** (Coolify),
  and both OpenClaw and Hermes qualify because their installers provision the
  runtime itself. It's a *mature-project* pattern: pinned versions, SHA-256
  verification, `--dry-run`/`--no-prompt` flags. Nobody starts here.
- **Config split: `.env` for secrets/infra, web first-run for identity.**
  First registered user becomes admin (LibreChat, Open WebUI); wizards write
  the `.env` (Hermes). CLI-only setup is treated as hostile to VPS deployers.
- **VPS guides converged on Caddy** (automatic TLS, one Caddyfile) over
  nginx+certbot, docker `restart: unless-stopped` over bare systemd for the
  app, and **Tailscale-only exposure as a documented first-class alternative**
  to public DNS (bind loopback, zero open ports).
- **Updates:** `docker compose pull` + migrations-on-boot is the norm;
  auto-updaters are an appliance-tier feature (Home Assistant OS).
- **Claude auth on a server is a known, documented problem.** Anthropic's
  position: products/services calling Claude (including via the Agent SDK)
  should use `ANTHROPIC_API_KEY`; consumer subscription OAuth is licensed for
  Claude Code/claude.ai use, and the sanctioned headless mechanism for a
  *personal, single-operator* deployment is `claude setup-token` on a machine
  with a browser → long-lived `sk-ant-oat01-…` token → `CLAUDE_CODE_OAUTH_TOKEN`
  on the server.

## 3. Where callback-box stands today

Condensed from a fresh inventory (2026-07-12); details in
[`source-available-release.md`](../../callback-box/docs/plans/source-available-release.md)
and `callback-box/deploy/README.md`.

- **Two-part install by design.** Engine (monorepo, pnpm workspace, must be
  installed from the root) + box (a separate git repo, `cb init`, lives
  outside the source tree). Neither competitor has this split — their state
  dir is an appendage of the install; our box is the *point*. Any install
  story has to install the engine and then *create a box*, and the second
  step is the one a stranger has never seen before.
- **Real prerequisites beyond Node/pnpm:** `pandoc`, `imagemagick`,
  `poppler-utils` expected on PATH by the agent guide (`chat.ts:13`);
  `git-lfs` (soft-required — hooks degrade *silently* without it); native
  builds (`better-sqlite3`, `esbuild`) gated on pnpm `onlyBuiltDependencies`.
  Version drift already exists: `.nvmrc` pins Node 24, `deploy/setup-server.sh`
  installs Node 22.
- **Claude auth is subscription-OAuth-only** (`ANTHROPIC_API_KEY`
  force-stripped in `bootstrap.ts` / `script-env.ts`); a missing login
  surfaces as an opaque SDK failure, and the health probe that would catch it
  is skipped on macOS. Track F piece 1 (preflight + actionable error +
  explicit-config API key) is decided but unbuilt.
- **`deploy/` is one person's deployment** (Hetzner + Cloudflare + hardcoded
  zone/repo), self-describes as such, is partially stale vs. the live hub
  setup, and Track C genericization is deliberately deferred.
- **No `.env.example`**, no enumerated config reference outside
  `deploy/README.md` prose (which wrongly lists `ANTHROPIC_API_KEY` as
  required).
- Existing strengths worth naming: the hub's fail-closed auth
  (owner-only-by-default `allowedEmails`, HMAC'd identity forwarding), the
  Telegram validate-then-persist secret pattern (`admin.ts:60-78`) ready to
  generalize, and the admin page's working Claude OAuth section.

## 4. Analysis: which competitor patterns transfer

**The doctor command is the highest-leverage single piece.** Both competitors
ship one (`openclaw doctor`, `hermes doctor`), and it's what makes every other
path debuggable: the curl|bash installer, the VPS guide, and the from-source
quickstart all end with "run doctor, it tells you what's missing." For
callback-box the checklist writes itself from the inventory above: Node
version matches `.nvmrc`, workspace installed from root, `pandoc`/`magick`/
`pdftotext` on PATH, git-lfs installed *and filters active*, `~/.claude`
credentials present and unexpired (including on macOS — this subsumes the
Track F health-probe fix), box passes `cb validate`. This is Track F piece 1
grown into a named command instead of a buried run-path check.

**The curl|bash + runtime-provisioning installer does not transfer yet.**
Both competitors are published packages with dedicated installer
infrastructure (SHA-pinned Node tarballs, per-OS fallbacks, `--dry-run`).
callback-box isn't on npm, and the release plan explicitly defers publishing.
Building installer machinery before the package exists inverts the order every
comparable followed: source → package → installer → wizard.

**Docker transfers, and solves our specific problem.** The field's argument
for Docker-first is native-module hell; ours is stronger — the image also
bakes in `pandoc`/`imagemagick`/`poppler`/`git-lfs`, which no comparable
project even needs. A Dockerfile + compose example (cb hub + Caddy, boxes
directory and `~/.claude` volume-mounted, `restart: unless-stopped`) is the
*generic* server story, and writing it is cheaper than parametrizing
`deploy/` — it sidesteps the Track C transition-state problem entirely
(the personal Hetzner scripts stay as-is, honestly personal; the public VPS
doc never mentions them).

**The security-narrative lesson transfers.** OpenClaw's install UX was
praised while its reputation burned on blast-radius. callback-box's posture is
actually strong (fail-closed hub auth, per-box allowlists, webhook-only
unauthenticated surface) but it's documented for the operator, not stated as
a threat model a skeptical stranger can read. A short SECURITY.md-shaped
statement ("what runs with what privileges, what's exposed by default, what
the agent can touch") costs a page and preempts the default critique of this
category. Loopback-by-default matters here too: `cb serve`/`cb hub` should
bind 127.0.0.1 unless configured otherwise, and the docs should lead with the
Tailscale-only option for VPS deployments.

**Hermes's two warnings:** (1) document contributor setup separately from
user install — our monorepo README currently serves agents/contributors and
would confuse a user who just wants a box; Track E already owns this. (2)
Their remote-server + local-client onboarding gap is exactly the shape of our
future "box on a VPS, phone/laptop as clients" story — when the VPS guide is
written, the client-connection story (URL, Google OAuth setup, PWA install)
has to be *in* it, not implied.

**The auth-model fork in the road** (boxholder decision, flagged not made):
Anthropic's documented position is API-key auth for products calling the
Agent SDK; subscription OAuth is for Claude Code itself. A single-operator
personal box using the operator's own subscription is the same gray zone
OpenClaw lives in, and `claude setup-token` is the sanctioned-adjacent
headless mechanism. The honest open-source posture is to document both paths
with their trade-offs — subscription (cheaper for heavy use, ToS-gray for
embedded use, needs `setup-token` on servers) vs. explicit API key (Track F's
decided-but-unbuilt path, ToS-clean, pay-per-token) — and let the operator
choose. What we can't ship is today's state: subscription-only, undocumented,
failing opaquely.

## 5. Recommendations

Ordered as a sequence; each traced to existing plan tracks or filed as an
issue per `research/CLAUDE.md`.

| # | Recommendation | Disposition | Trace |
|---|----------------|-------------|-------|
| 1 | **`cb doctor`** — one command checking Node/.nvmrc match, root-workspace install, external binaries (pandoc, magick, pdftotext), git-lfs presence *and* active filters, Claude credentials (incl. macOS), box validity. Every install doc ends by running it. | **adopt** | Grows Track F piece 1 (preflight + macOS probe fix) into a named command; issue filed: [`cb-doctor-preflight`](../../issues/features/2026-07-12-cb-doctor-preflight.md) |
| 2 | **From-source quickstart as the only install path in the source-available cut** — clone → `pnpm install` → `cb init ~/boxes/mybox` → `cb serve`, ending in `cb doctor`. No installer script this cut. | **adopt** | Track E, already planned; this endorses its scope |
| 3 | **`.env.example` + config reference; fix the stale `ANTHROPIC_API_KEY` claim in `deploy/README.md`; reconcile Node 24 vs 22.** | **adopt** | Track F piece 2 + doc fixes; cheap, this cut |
| 4 | **Document both Claude auth paths** (subscription via `claude auth login` / `claude setup-token` for headless; explicit-config API key once Track F lands) with the ToS trade-off stated plainly. | **adopt** (docs) / boxholder call on emphasis | Track F piece 1 doc half; §4 above |
| 5 | **Dockerfile + docker-compose + generic VPS guide** (Caddy for TLS, Tailscale-only variant, volume-mounted boxes + `~/.claude`, `restart: unless-stopped`, update = pull + restart). This *replaces* Track C deploy genericization as the public server story; personal `deploy/` stays personal. | **plan** (fast-follow after source cut) | Supersedes the deferred `deploy-genericization.subplan.md` rationale; issue filed: [`docker-vps-install-path`](../../issues/features/2026-07-12-docker-vps-install-path.md) |
| 6 | **Threat-model/SECURITY page + loopback-by-default audit** — verify `cb serve`/`cb hub` bind 127.0.0.1 unless configured, and write the one-page "what this can touch" statement. | **adopt** (page) / **investigate** (bind audit) | OpenClaw reception lesson, §4; fold into Track E's stranger-facing docs |
| 7 | **npm publish** — the gate to a real five-minute start (`pnpm dlx`), and the prerequisite for any installer script. Native deps mean documenting `pnpm approve-builds` or shipping prebuilds. | **later** (existing deferral stands) | `source-available-release.md` NOT-in-scope; `boxes-as-packages-v2.md` roadmap |
| 8 | **curl\|bash installer + `cb onboard` wizard** — only after npm publish, and only if adoption warrants installer infrastructure. | **later** — trigger: published package + evidence strangers stall on the quickstart | §4 "does not transfer yet" |
| 9 | **First-run web onboarding** (first visit configures owner email / providers in the admin UI, Telegram-pattern validate-then-persist). | **later** — trigger: VPS guide exists and real second-party installs happen | Track F admin-section lean + field pattern §2 |

The through-line: the field's install ladder is source → package → installer →
wizard, with Docker as the server rung and a doctor command as the rail
alongside every step. callback-box is at rung one; the release plan already
points there. What this study adds is the doctor command's priority, Docker as
the *replacement* for deploy genericization rather than its successor, the
security-narrative page, and the auth-model documentation fork.
