# Developer install (from source)

Setting up callback-box from a fresh clone, for hacking on the codebase
itself. This is the from-source path — no personal infrastructure, no
prior box. To *run* callback-box without hacking on it (locally or on a
server), the Docker path is simpler: see
[docker-install.md](docker-install.md).

## Prerequisites

- **Node 24.** Enforced by `engine-strict` (root `.npmrc`) plus the
  `engines` field in the root `package.json` — an install under any other
  major version fails outright. If you use a version manager (nvm, fnm,
  volta, asdf), it will pick up the root `.nvmrc` automatically once you
  `cd` into the repo. On a machine without a version manager (e.g. a bare
  Linux server), install it from NodeSource — the same mechanism
  `deploy/setup-server.sh` uses:

  ```bash
  # Debian/Ubuntu
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
  sudo apt-get install -y nodejs
  ```
- **pnpm**, via [corepack](https://nodejs.org/api/corepack.html):
  `corepack enable` (the root `package.json` pins the exact pnpm version).
- **System binaries** the agent uses for document/image/spreadsheet handling —
  `pandoc`, `imagemagick`, `poppler-utils`, `git-lfs`, plus an Excel reader
  (`openpyxl` + the `xlsx2csv` CLI, for `.xlsx`):

  ```bash
  # macOS — openpyxl/xlsx2csv have no brew formula, install them via pip
  brew install pandoc imagemagick poppler git-lfs
  python3 -m pip install --break-system-packages openpyxl xlsx2csv

  # Debian/Ubuntu
  sudo apt-get install pandoc imagemagick poppler-utils git-lfs python3-openpyxl xlsx2csv
  ```

  On Debian/Ubuntu the `imagemagick` package is ImageMagick 6, which ships
  `convert` but not the `magick` command the agent contract and `pnpm run
  doctor` look for. Alias it (the same shim `deploy/setup-server.sh` applies):

  ```bash
  # Debian/Ubuntu only — Homebrew's imagemagick already provides `magick`
  command -v magick >/dev/null || sudo ln -sf "$(command -v convert)" /usr/local/bin/magick
  ```

  Then register the LFS filters for your user (once per machine):

  ```bash
  git lfs install
  ```

- **Claude Code CLI**, and a subscription login. Install it with the native
  installer (the same one `deploy/setup-server.sh` uses), then log in:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  claude auth login
  ```

  Authentication is **subscription login only** — `ANTHROPIC_API_KEY` is
  deliberately ignored even if it's set in your environment (stripped in
  `src/cli/bootstrap.ts` and `src/core/script-env.ts`, so an API key
  lingering in your shell can't silently take over billing). Loading a
  page works without being logged in; running an agent (chat, reactor)
  needs `claude auth login` completed first.

## Quickstart

```bash
git clone <repo-url> && cd <repo>
pnpm install
pnpm run doctor
pnpm --dir callback-box build:frontend
cd callback-box
pnpm cb init ~/boxes/dev1
(cd ~/boxes/dev1 && pnpm install)      # v2 boxes are packages
pnpm cb serve ~/boxes/dev1
pnpm run doctor
```

Then open the URL `cb serve` prints (default `http://localhost:3210/`).

Notes:
- `pnpm doctor` is shadowed by pnpm's own built-in `doctor` subcommand —
  use `pnpm run doctor` (with `run`), not `pnpm doctor`.
- `cb init` scaffolds a *package* at `~/boxes/dev1` (the operational box
  lives at `~/boxes/dev1/content/`); it needs its own `pnpm install` to
  replace the scaffold-time symlink before it will run.
- `cb init` defaults the new box's `callback-box` dependency to a `link:`
  reference back to this checkout, so edits here are picked up by the box
  without republishing anything.
- From the repo root, `pnpm cb <args>` also works as a shortcut for
  `pnpm --dir callback-box cb <args>` — optional sugar; every command
  below also works with `cd callback-box &&` first, which is the form
  that works from anywhere (including inside `callback-box/`).

## Working on the frontend

`cb serve --dev` only watches the backend — it does not run Vite, so
frontend edits won't hot-reload under plain `cb serve --dev`. For a full
edit-and-see loop, run two terminals:

```bash
# terminal 1 — backend, watch mode
cd callback-box
pnpm cb serve --dev --port 3211 ~/boxes/dev1

# terminal 2 — frontend, Vite + HMR, proxies /api and /auth to the backend
cd callback-box/src/frontend
FRONTEND_PORT=3210 BACKEND_PORT=3211 pnpm dev
```

Open `http://localhost:3210/`. If you're also running this monorepo's
personal dev router (port 3210/3211), pick different ports for one of
the two to avoid a collision.

### First-run account (auth is on, even in dev)

A dev box is authenticated — the first time you open it you'll hit a login
wall. Create your account once with `cb auth create-user` (or open the
`First-run setup: …/auth/setup?token=…` URL the server prints to its console on
first boot). The credential store is home-level (`~/.cb-auth.json`), so one
account works across every worktree's dev server — you set it up once.

After the owner account exists, its Admin page can issue 15-minute, single-use
member invites; local users can change their own password from Settings. The
Allowed Users list can also issue a 15-minute reset link for an existing member
who forgot their password; the member chooses the replacement password and is
then returned to ordinary login.

Authentication is always on: there is no operator opt-out to run a box
unauthenticated. (An in-process `openAccess` construction option exists purely
as a test seam — no CLI flag, env var, or config field turns it on.)

## Troubleshooting

Anything misbehaves — installs, missing binaries, auth, a stale
frontend build — run:

```bash
pnpm run doctor
```

It checks Node/pnpm versions, the workspace install, the external
binaries above, git-lfs filter registration, Claude Code auth, and
whether the frontend has been built, with a one-line remedy for each
failing check.
