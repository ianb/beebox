#!/usr/bin/env bash
# Deploy target configuration — the opt-in layer.
#
# `deploy/target.env` (gitignored) is what makes a checkout a machine that
# deploys. It holds one operator's server, and its PRESENCE is the enable
# switch: with no target.env there is no deploy target, so the commit hooks
# skip silently and deploy.sh refuses. A clone that never had a server is not
# misconfigured — it just doesn't deploy. See target.env.example.
#
# This is deliberately NOT an abstraction over deployment styles. The supported
# install-and-update path for everyone else is the container flow in
# docs/docker-install.md; deploy.sh is one operator's rsync-to-VPS pipeline, and
# this file is how it learns which VPS.
#
# Sourced by deploy.sh, the prod-* diagnostics, and (via `bbx_deploy_target_file`)
# the root husky hooks. Bash, not TypeScript, so a commit hook never needs tsx.

deploy_file_has_value() {
  local config_file="$1"
  [[ -f "$config_file" ]] && LC_ALL=C grep -q '[^[:space:]]' "$config_file"
}

# Find a gitignored deploy config file: this checkout first, then the main
# checkout via Git's common directory. A worktree borrows the main checkout's
# target so diagnostics work from anywhere.
resolve_deploy_file() {
  local deploy_dir="$1"
  local filename="$2"
  local config_file="$deploy_dir/$filename"
  local git_common_dir
  local main_checkout

  if ! deploy_file_has_value "$config_file"; then
    git_common_dir=$(git -C "$deploy_dir" rev-parse \
      --path-format=absolute --git-common-dir 2>/dev/null || true)
    if [[ -n "$git_common_dir" ]]; then
      main_checkout=$(dirname "$git_common_dir")
      config_file="$main_checkout/beebox/deploy/$filename"
    fi
  fi

  deploy_file_has_value "$config_file" || return 1
  printf '%s\n' "$config_file"
}

# Print the path of the target.env in effect, or return 1 if there is none.
# The hooks call this (as a script, `deploy-target.sh path`) purely to decide
# whether this machine deploys at all.
#
# BBX_DEPLOY_NO_FALLBACK=1 restricts the lookup to the given checkout. Shipping
# is main-checkout-only ON PURPOSE — a worktree is a branch nobody has landed —
# and the fallback exists so DIAGNOSTICS work from anywhere. Without this,
# running deploy.sh from a worktree would borrow main's target and deploy an
# unlanded branch to production, which the old `[ -s "$SCRIPT_DIR/server-ip" ]`
# check made impossible.
bbx_deploy_target_file() {
  local deploy_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  if [ "${BBX_DEPLOY_NO_FALLBACK:-}" = "1" ]; then
    deploy_file_has_value "$deploy_dir/target.env" || return 1
    printf '%s\n' "$deploy_dir/target.env"
    return 0
  fi
  resolve_deploy_file "$deploy_dir" target.env
}

# Load the target into BBX_DEPLOY_* and apply defaults. Returns 1 (quietly)
# when unconfigured; the caller decides whether that is an error. Callers that
# only ever run on a configured machine should use `require_deploy_target`.
load_deploy_target() {
  local deploy_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  local target_file

  target_file=$(bbx_deploy_target_file "$deploy_dir") || return 1

  # Only the target's own identity is configurable. The server LAYOUT is not:
  # deploy.sh's remote steps, add-box.sh, the leak scan, and the CSP report all
  # name /opt/beebox, /home/beebox, the `beebox` account, and port 3210
  # literally — mostly inside single-quoted heredocs the server expands. A
  # settable BBX_DEPLOY_INSTALL_DIR would be honored by the rsync destination
  # and ignored by everything downstream, which is a half-deployed server
  # reporting success. Refuse the setting rather than half-honor it. Making
  # them real means threading four values through every remote block in four
  # codebases; until someone needs that, this fails closed.
  local fixed
  for fixed in BBX_DEPLOY_INSTALL_DIR BBX_DEPLOY_SERVICE_USER \
               BBX_DEPLOY_SERVICE_HOME BBX_DEPLOY_HUB_PORT; do
    if LC_ALL=C grep -qE "^[[:space:]]*(export[[:space:]]+)?$fixed=" "$target_file"; then
      echo "deploy: $target_file sets $fixed, which is not configurable." >&2
      echo "  The server layout is fixed at what deploy/hetzner/setup-server.sh" >&2
      echo "  builds — /opt/beebox, /home/beebox, the 'beebox' account, port 3210" >&2
      echo "  — because the deploy's remote steps name those literally. Setting it" >&2
      echo "  here would change where files are sent and nothing else. Remove the" >&2
      echo "  line. See beebox/deploy/target.env.example." >&2
      return 2
    fi
  done

  set -a
  # Operator-authored config at a path resolved above, so shellcheck cannot
  # follow it and has nothing to check.
  # shellcheck disable=SC1090
  . "$target_file"
  set +a

  # Read by sourcing callers (prod-browse names it in its error), not here.
  # shellcheck disable=SC2034
  BBX_DEPLOY_TARGET_FILE="$target_file"
  : "${BBX_DEPLOY_SSH_USER:=root}"
  # Not knobs — the one place every consumer reads the fixed layout from, so a
  # future change to it is one edit rather than a grep across four codebases.
  # Consumed by sourcing callers (prod-curl, prod-browse, add-box.sh) and by
  # the `get` subcommand, never within this file.
  # shellcheck disable=SC2034
  BBX_DEPLOY_INSTALL_DIR=/opt/beebox
  # shellcheck disable=SC2034
  BBX_DEPLOY_SERVICE_USER=beebox
  # shellcheck disable=SC2034
  BBX_DEPLOY_SERVICE_HOME=/home/beebox
  # shellcheck disable=SC2034
  BBX_DEPLOY_HUB_PORT=3210

  # The host is the one value with no sensible default. A target.env that
  # omits it is a broken config, not an absent one — say so rather than
  # producing `ssh root@`.
  if [[ -z "${BBX_DEPLOY_HOST:-}" ]]; then
    echo "deploy: $target_file sets no BBX_DEPLOY_HOST (the server's IP or hostname)." >&2
    echo "  See beebox/deploy/target.env.example." >&2
    return 2
  fi

  BBX_DEPLOY_SSH_TARGET="$BBX_DEPLOY_SSH_USER@$BBX_DEPLOY_HOST"
}

# Load, or exit non-zero with the setup instructions. For commands whose entire
# purpose is to talk to the deploy target.
require_deploy_target() {
  local deploy_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  local rc=0
  load_deploy_target "$deploy_dir" || rc=$?
  case "$rc" in
    0) return 0 ;;
    2) exit 1 ;;  # present but malformed; load_deploy_target already explained
  esac

  if [ "${BBX_DEPLOY_NO_FALLBACK:-}" = "1" ] &&
     resolve_deploy_file "$deploy_dir" target.env >/dev/null 2>&1; then
    echo "deploy: this checkout has no beebox/deploy/target.env of its own." >&2
    echo "  The main checkout has one, but deploying is deliberately" >&2
    echo "  main-checkout-only: a worktree is a branch nobody has landed, and" >&2
    echo "  shipping it would put unlanded code in production. Land the branch" >&2
    echo "  and deploy from the main checkout." >&2
    exit 1
  fi

  echo "deploy: no deploy target is configured on this machine." >&2
  echo "  beebox/deploy/target.env (gitignored) names the server to deploy to." >&2
  echo "  Copy beebox/deploy/target.env.example to beebox/deploy/target.env and" >&2
  echo "  fill in BBX_DEPLOY_HOST." >&2
  echo "  For the supported install-and-update path, see beebox/docs/docker-install.md." >&2
  exit 1
}

# Usable as a command, for callers that are not bash — the husky hooks and
# `bbx doctor`. All three subcommands exit 1 when unconfigured, so the exit
# status alone answers "does this machine deploy?".
#
#   deploy-target.sh path         the effective target.env
#   deploy-target.sh ssh-target   user@host, ready for ssh/rsync
#   deploy-target.sh get VAR      one loaded BBX_DEPLOY_* value (may be empty)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  bbx_deploy_target_self_dir="$(cd "$(dirname "$0")" && pwd)"
  case "${1:-}" in
    path)
      bbx_deploy_target_file "$bbx_deploy_target_self_dir"
      ;;
    ssh-target)
      load_deploy_target "$bbx_deploy_target_self_dir" || exit 1
      printf '%s\n' "$BBX_DEPLOY_SSH_TARGET"
      ;;
    get)
      [[ -n "${2:-}" ]] || { echo "usage: deploy-target.sh get VAR" >&2; exit 2; }
      load_deploy_target "$bbx_deploy_target_self_dir" || exit 1
      printf '%s\n' "${!2-}"
      ;;
    *)
      echo "usage: deploy-target.sh {path|ssh-target|get VAR}" >&2
      exit 2
      ;;
  esac
fi
