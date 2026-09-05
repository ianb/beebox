#!/usr/bin/env bash
#
# beebox container entrypoint.
#
# Contract (locked — see docs/plans/installation-story.md Track D):
#   * ANY arguments  → exec them verbatim. This is how a box is initialized
#     and how you authenticate:
#         docker compose run --rm box bbx init /data/box
#         docker compose run --rm box claude auth login
#   * NO arguments   → readiness check, then serve the box.
#
# The box lives at /data/box — the one root (shapeVersion 3): npm package
# and operational areas (_content/, _config/, …) in the same directory.
# Bind-mounted from the host and owned by the runtime user.
set -euo pipefail

BOX_ROOT=/data/box

# The native Claude CLI installs under the runtime user's ~/.local/bin; put it
# on PATH so `claude ...` (e.g. `claude auth login`) resolves in this exec
# context. $HOME expands at runtime — no home path is baked into the image.
export PATH="$HOME/.local/bin:$PATH"

# Git identity: baked defaults come from the image; BBX_GIT_NAME / BBX_GIT_EMAIL
# override them here so `bbx init`'s first commit and any later commits carry
# the operator's identity. Applied on every code path (init included).
if [[ -n "${BBX_GIT_NAME:-}" ]]; then
  git config --global user.name "$BBX_GIT_NAME"
fi
if [[ -n "${BBX_GIT_EMAIL:-}" ]]; then
  git config --global user.email "$BBX_GIT_EMAIL"
fi

# Any arguments → run them as-is (bbx init, claude auth login, a shell, …).
if [[ $# -gt 0 ]]; then
  exec "$@"
fi

# ── No arguments: readiness check, then serve ────────────────────────────
#
# A box is ready only when all three hold. Checking just the marker would
# accept a partial init (bbx init writes the marker early but commits at the
# end — a crash between the two leaves a box that looks initialized but has no
# HEAD commit).
ready=1
[[ -f "$BOX_ROOT/.beebox/box.json" ]] || ready=0
[[ -f "$BOX_ROOT/package.json" ]] || ready=0
git -C "$BOX_ROOT" rev-parse HEAD >/dev/null 2>&1 || ready=0

if [[ "$ready" -ne 1 ]]; then
  cat >&2 <<'EOF'
beebox: no initialized box found at /data/box.

Initialize one, then start the server:

  docker compose run --rm box bbx init /data/box
  docker compose up -d

If you already ran `bbx init` and it failed partway (no git identity, a
permission/ownership refusal), inspect and re-run it:

  docker compose run --rm box bbx init /data/box
EOF
  exit 1
fi

# A v2 box is a package: it needs its own `pnpm install` before serving so
# schemas/views resolve (mirrors scripts/smoke-external-box.ts). Only on first
# run — a populated node_modules means it is already installed.
if [[ ! -d "$BOX_ROOT/node_modules" ]]; then
  echo "beebox: first run — installing box dependencies (this is a one-time step)..." >&2
  # --allow-build approves the box's native/generated deps (better-sqlite3 et
  # al.) to run their install scripts. pnpm 10 blocks them by default, and
  # non-interactively a blocked build is a hard error — the box package.json's
  # `pnpm.onlyBuiltDependencies` is no longer read by pnpm 10.26, so the
  # approval has to come from the flags (same set as the engine install).
  ( cd "$BOX_ROOT" && pnpm install \
      --allow-build=better-sqlite3 \
      --allow-build=esbuild \
      --allow-build=@google/genai \
      --allow-build=protobufjs \
      --allow-build=@googleworkspace/cli )
fi

# ── Converge the box onto the engine that is about to serve it ───────────
#
# An update here is `git pull && docker compose build && up -d`: new engine
# code, the same box on disk. Without this step that box keeps its old card
# shape and its old generated guidance indefinitely, because nothing else in
# the container path runs migrations — `bbx serve` does not migrate on boot.
# The server deploy has always done this (deploy/deploy.sh's convergence pass);
# a container install needs it for the same reason and gets it at start.
#
# Two steps, in the order deploy.sh uses: `bbx migrate --sweep` (card data)
# then `bbx docs refresh` (agent docs, card rules, managed skills). Both are
# built for running unattended — the sweep skips a dirty box for next time and
# commits what it does apply — and both own their own policy; see
# src/core/migration-sweep.ts and src/core/docs-refresh.ts.
#
# Neither can stop the box from serving. A box that needs a human (dirty tree,
# an agent-driven migration, a hard failure) is a box to look at, not a reason
# to leave the operator with no server. On a freshly `bbx init`ed box both are
# no-ops: init seeds the manifest as fully applied.
#
# BBX_SKIP_CONVERGE=1 turns this off, for an operator who would rather run
# `docker compose run --rm box bbx migrate --sweep` themselves and watch it.
# Each step is bounded, for the same reason deploy.sh bounds its own: "cannot
# stop the box from serving" is only true if it cannot hang either, and a
# migrator that never returns would leave the operator staring at a container
# that starts and never listens. 600s matches the server deploy.
converge() {  # $1 = human name, rest = the bbx command
  local what="$1"; shift
  local code=0
  ( cd "$BOX_ROOT" && timeout 600 "$@" ) || code=$?
  if [[ "$code" -eq 124 ]]; then
    echo "beebox: $what timed out after 600s — serving anyway; run it yourself to see why." >&2
  elif [[ "$code" -ne 0 ]]; then
    echo "beebox: $what reported a problem (see above) — serving anyway." >&2
  fi
}

if [[ "${BBX_SKIP_CONVERGE:-}" != "1" ]]; then
  echo "beebox: converging the box onto this engine..." >&2
  converge "the migration sweep" bbx migrate --sweep
  converge "the docs refresh" bbx docs refresh
fi

# Serve the box on all interfaces inside the container; the host-side port
# mapping (compose) decides who can reach it.
exec bbx serve "$BOX_ROOT" --host 0.0.0.0 --port 3210
