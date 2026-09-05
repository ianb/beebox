---
title: "What would it take to run this project on the Claude Code cloud environment?"
workstream: unknown
filed-by: agent
discovered-in: main session — boxholder asked what it would take; research kicked off with the filing
area: dev-infra
priority: backlog
---

Claude Code can run agents in a hosted cloud sandbox (claude.ai/code / the Agent
tool's `isolation: "remote"`): an ephemeral Linux container that clones the repo,
runs a setup/bootstrap step, then hands an agent a shell with (optionally
restricted) network egress. The question: **what would it take for a session in
that environment to be useful on this monorepo** — at minimum install + typecheck
+ lint + test green, ideally run the dev server and exercise the app.

The interesting part isn't "does pnpm install work" — it's that this project is
unusually coupled to a *specific local machine*: a shared dev router on a fixed
port serving sibling worktrees, boxes that live **outside** the repo at
`~/src/boxes/`, worktree creation that opens Terminal.app tabs, git-lfs, deploy
hooks that ship to a real Hetzner server, Chrome/agent-browser automation, and
macOS-specific behavior (sleep-aware timers, Terminal AppleScript). A cloud
container is Linux, ephemeral, single-checkout, has no `~/src/boxes`, no second
Terminal window, and possibly no egress. So the real work is enumerating those
couplings and deciding, for each, whether it's needed in the cloud, can be
stubbed/bootstrapped, or is simply out of scope there.

## Research (2026-07-15)

### First: which "cloud" — Claude Code on the web, not Managed Agents

There are two hosted-sandbox products and they are NOT the same:

- **Claude Code on the web** (code.claude.com/docs, claude.ai/code) — the developer
  feature: it clones *your* GitHub repo into an ephemeral sandbox, Claude Code
  makes changes, runs tests, and pushes a branch you turn into a PR. **This is
  what the question is about.**
- **Managed Agents cloud sandboxes** (platform.claude.com/managed-agents) — the API
  for building your *own* agents (vaults, `resources`, `packages` config). Not
  relevant here.

Everything below targets Claude Code on the web.

### The environment (what we'd be running in)

Sourced from code.claude.com/docs/en/claude-code-on-the-web.md and
.../sandbox-environments.md:

- **OS/arch:** Ubuntu 24.04, x86_64. **~16 GB RAM, 30 GB disk, 4 vCPU.**
- **Preinstalled:** Node 20/21/22 via nvm, plus npm/yarn/**pnpm**/bun; git, Docker,
  PostgreSQL 16, Redis 7; make/cmake/ninja/gcc/clang; python3. So our
  **Node-22 requirement is met** (nvm) and the **better-sqlite3 build toolchain
  exists** (see gap #2).
- **Filesystem:** ephemeral per session; fresh clone each time. Only the *setup
  script's output* is cached (~7 days). `$HOME` is not documented to persist.
- **Network:** default **"Trusted"** allowlist — npm/pnpm/PyPI/crates + GitHub +
  `raw.githubusercontent.com` are pre-approved; a security proxy enforces it.
  Options: None / Trusted / Full / Custom-allowlist. GitHub ops go through a
  separate scoped-credential proxy (the token never enters the sandbox).
- **GitHub:** required for the normal path — clones from the connected GitHub
  account, pushes a branch you PR. **This repo qualifies:** it has a GitHub
  origin (`github.com:ianb/beebox`). (Fallback: `claude --cloud` uploads a
  local bundle <100 MB, but can't push back without GitHub auth — and 1.1 GB of
  `node_modules` aside, the *source* tree is well under 100 MB.)
- **Secrets:** plain env vars in the environment config, described as
  *semi-public* (no real secrets store yet). Fine for a `BBX_*` test toggle,
  **wrong** for prod SSH keys or live API tokens.
- **No dev-server / preview / port-forwarding.** It's batch coding + PR. There is
  no mechanism to reach a long-running server on a port from your browser.
- **Setup timeout:** the setup script must finish in **~5 minutes** or the
  environment cache-build fails.

### Two ways to bootstrap, and which to use

1. **Setup script** — a bash script entered in the **environment UI** (NOT
   committed to the repo), runs as root once before Claude Code launches, output
   cached. This is where `pnpm install` goes. It's per-environment config the
   boxholder sets up once, not something we can fully ship in-repo.
2. **SessionStart hook** — repo-committed in `.claude/settings.json`
   (`hooks.SessionStart`), runs *every* session after launch, and can gate on
   `CLAUDE_CODE_REMOTE=true` to run only in the cloud. Good for steps that must
   also run locally, or to move slow work out of the 5-min setup window.

We already register a SessionStart hook (`.claude/settings.json:51` → the
main-checkout auto-sweep). Any cloud-install hook would be an added entry
there — and must **no-op cleanly outside the cloud** (guard on
`CLAUDE_CODE_REMOTE`), since that array runs on every local session too.

### Can a fresh clone actually reach green? Mostly yes.

The full `install → typecheck → lint → test` chain runs from the **repo alone**
— no external box, no network at test time (verified against the test setup):

- **Tests are self-contained.** `makeTmpBox()` (`beebox/test/helpers/doctest-helpers.ts:39`)
  builds throwaway boxes in the OS tmpdir; route doctests boot Fastify against
  tmp git repos; agents/services are faked (`test/helpers/fake-agent.ts`,
  `src/services/`). The scenario loader that defaults to `~/src/boxes/scenarios`
  is not exercised by any included test. **No `~/src/boxes/test1` needed.**
- **Build is offline.** `pretest` bundles the `dist/` package exports via esbuild;
  typecheck/lint are offline. Network is only needed at **install**.
- **Deploy won't fire.** The husky post-commit/post-merge deploy self-skips when
  `beebox/deploy/target.env` (gitignored) is absent — a fresh clone can
  commit on `main` with no risk of shipping. git-lfs isn't used anymore (hooks
  warn-and-continue); the commit-blocklist check no-ops without a
  `.commit-blocklist`.

### The real gaps / blockers

1. **`pnpm install` must run before anything — and `node_modules` is 1.1 GB
   across 15 workspace packages.** Two things hard-require it: the **PostToolUse
   `vibe-check` lint hook** (`.claude/settings.json:13`, fires after every
   Edit/Write) and the **pre-commit `typecheck`** — both error without a
   populated `node_modules`. And a cold `pnpm install` of this monorepo plausibly
   **exceeds the ~5-min setup-script timeout.** This is the #1 thing to measure.
   Mitigations: rely on setup-output caching (only the first build pays), and/or
   move install to a `CLAUDE_CODE_REMOTE`-gated SessionStart hook, and/or trim
   what installs.
2. **better-sqlite3 is the one native-compile risk.** It's in
   `onlyBuiltDependencies`, so its failure is *fatal* (unlike agent-browser's
   fail-soft binary download). On Linux it tries `prebuild-install` (fetches a
   Node-22 linux-x64 prebuild from GitHub releases — reachable under Trusted),
   falling back to `node-gyp` (needs python3+make+g++ — all present on Ubuntu
   24.04). Should be clean under Trusted networking; verify on first run.
3. **`engine-strict=true` + `node >=22.11 <23`.** If the environment's default
   Node isn't 22.x, install hard-fails. nvm has 22; the setup script must
   `nvm use 22` (or the env must default to it).
4. **GitHub-only round-trip.** Changes leave as a pushed branch → PR. The repo's
   whole *deploy* path (SSH to a private Hetzner box) is unreachable and
   out-of-scope; cloud work is "edit engine code, run checks, open a PR," and a
   human merges/deploys from a trusted machine as today.
5. **No app to look at.** Because there's no dev-server/preview, the browsable
   app (`pnpm dev`, the router, `/dev/`, `bin/browse`, tours) can't be exercised
   the way it is locally. Cloud sessions are viable for **engine/logic/test
   work**, not for UI/visual iteration.
6. **`path-leak-check` watch item.** It rejects tracked files containing real
   `/home/<name>` or `/Users/<name>` paths. A cloud container's home
   (`/root` or `/home/<user>`) leaking into a committed file would trip the
   pre-commit guard — use `~/…` or repo-relative paths (already house style).

### What's simply inert in the cloud (no action needed)

The entire local-machine layer degrades to no-ops on a single-checkout Linux
container: the `claude --worktree` flow and `launch-worktree-session`
(Terminal.app/osascript — macOS only), the four worktree lifecycle hooks
(WorktreeCreate/Remove, SessionEnd, main-only auto-sweep), box cloning,
`bin/browse` (agent-browser profile under `~/.cache`), and the router's
multi-worktree serving under `~/src/{beebox-worktrees,box-worktrees}` (only
`/main/` is meaningful with one checkout). None of it blocks single-checkout work
— it just does nothing. Router state/paths that *do* matter are already
env-overridable (`BBX_MAIN_ROOT`, `BBX_STATE_DIR`, `ROUTER_PORT`).

### The "no preview URL" problem — and how the ecosystem solves it

Gap #5 (no dev-server preview) is not a beebox problem; it's universal to
locked-down agent sandboxes, and the market has converged on an answer. Surveyed
GitHub Codespaces, Gitpod/Ona, Cursor cloud agents, Devin, OpenAI Codex cloud,
Google Jules, Replit Agent, and the preview-builders (v0/Bolt/Lovable).

**The convergence — split "does it work" from "does it look right," automate only
the first:**

- **The agent drives a browser *inside the sandbox* against `localhost` and
  surfaces screenshots back to the human.** This is the one technique every
  serious product implements: Codex "spins up its own browser, screenshots the
  result, attaches it to the PR"; Jules bundles Playwright and returns
  screenshots in the diff viewer; Devin/Cursor run computer-use loops; Replit
  drives a real browser click-through as replayable video. "Does it look right"
  routes to human eyes via those screenshots — not a live preview.
- **`curl`/HTTP against `localhost` is the auth-free smoke-check layer** — boot
  the server as a background process, then hit loopback. Works unchanged in an
  outbound-only sandbox (in Codespaces/Gitpod, loopback is explicitly the
  auth-free path; the *external* preview URL is what trips an auth wall).
- **Playwright screenshot / visual-regression assertions** committed as artifacts
  are the sandbox-native answer for "looks right" too — deterministic, agent-owned
  end-to-end, no human and no preview URL needed.

**Human-reachable preview URLs are the dividing line, and Claude Code is on the
have-not side** (with Codex and Jules): Codespaces/Gitpod/Replit forward a
detected port to a hostname (mature, but **default-private behind an auth wall**);
Devin exposes a genuine public `*.devinapps.com` tunnel (and is the cautionary
tale — auto-`expose_port` is a documented prompt-injection exfiltration vector);
the v0/Bolt/Lovable builders sidestep it by making a live preview *the product*.
For Claude Code on the web specifically (confirmed against the docs): **no
port-forwarding, no preview pane** — the request to surface `localhost` URLs back
to the human was declined as not-planned. But the sandbox ships a headless browser
(chromedriver; Playwright installable), so **in-session browser testing against
`localhost` is fully available** — you just can't hand a human a live link.
Background `pnpm dev &` stays alive across the agent's turns **but dies on session
end/resume** (pipe logs to a file). Tunnels (ngrok/cloudflared) are nobody's
blessed path — they fight the proxy/allowlist and are a security surface, not a
feature; would need Custom-firewall domains and still isn't recommended.

**beebox is unusually well-positioned for the convergent pattern** — it
already has the substrate the ecosystem settled on: an **agent-driven browser**
(`agent-browser` / `bin/browse`) and **tours** (`docs/tours.md` — scripted browser
walks for UI/a11y review). Those are built for exactly "agent drives the UI
headless and reports back." The cloud-specific work would be pointing them at an
in-session `localhost` server instead of the shared router URL, and surfacing
their screenshots into the session — not inventing a new mechanism. The honest
expectation stays: **the agent can verify "does it work" (boot + curl + headless
Playwright/tours + screenshots); the human does not get a live interactive
preview** and reviews via screenshots or by running locally.

Everyone who automates the fix-loop reports the same failure mode — the agent
loops (Replit "goes in circles eating credits"; Lovable "Try to fix" ~60% on
*simple* issues). A circuit-breaker / hand-back-to-human is standard; worth
keeping in mind if we ever wire an auto-verify loop.

### Bottom line

Making this repo *usable* on Claude Code on the web is a **small, config-shaped
task**, not a code change — but it buys a **restricted mode**: engine/library
code work + `typecheck`/`lint`/`test` + PR. The "no running box / no UI" limit is
**softer than it first looked**: the ecosystem-standard answer (boot server as a
background process → agent tests via `curl` + headless browser → screenshots back
to the human) is available in-sandbox, and beebox already owns the tooling
for it (`agent-browser`, tours). What's genuinely absent is a *live interactive
preview* for the human — that stays a local-only affordance.

Minimal viable setup (one-time, per-environment, in the UI):
1. Environment with **Trusted** networking, Node pinned to **22**.
2. **Setup script:** `nvm use 22 && corepack enable && pnpm install` (measure it
   against the 5-min budget; if it blows past, split the heavy install into a
   `CLAUDE_CODE_REMOTE`-gated SessionStart hook and let caching absorb it).
3. First-run verification: confirm better-sqlite3 builds and `cd beebox &&
   pnpm typecheck && pnpm lint && pnpm test` is green (there's no recursive root
   aggregate — checks run per-package).

Open questions / decisions before doing it:
- **Is it worth it?** The value is "kick off an engine-code task or review a PR's
  tests from a browser/phone." With the browser-testing path above, an agent could
  even boot a box + drive tours headless and report screenshots — so it's more than
  blind engine work, just short of a live human preview. Still: is that a workflow
  the boxholder wants vs. the local worktree flow that already exists?
- **Wire the existing browser tooling to in-session `localhost`?** `agent-browser`/
  `bin/browse` and tours currently target the shared router URL. Adopting the
  convergent pattern means a mode that points them at a locally-booted
  `pnpm dev` server in the sandbox and surfaces their screenshots into the
  session. That's the one piece of actual code work the cloud story might justify
  — but only if cloud sessions turn out to be a workflow worth investing in.
- **Setup-time budget.** Does a cold `pnpm install` of a 1.1 GB / 15-package
  monorepo fit in ~5 min on 4 vCPU? Needs an actual measurement — this decides
  whether the naive setup script works or we need the SessionStart-hook split.
- **Do we commit a `CLAUDE_CODE_REMOTE`-gated bootstrap to `.claude/settings.json`
  so the environment is reproducible from the repo,** rather than living only in
  one person's environment UI? (Leans yes — matches "new infrastructure isn't
  done until it's discoverable.")
- **Repo hygiene for cloud:** the `.claude/settings.json` PostToolUse/SessionStart
  hooks assume the local layout; confirm each is a clean no-op (not an error)
  when `CLAUDE_CODE_REMOTE=true` and no worktree layout exists.
