#!/usr/bin/env bash
set -euo pipefail

# Add a box to the server: clone its repo, register it with the hub (routing)
# and the scheduler (periodic tasks), seed access + connector secrets, restart
# the services, and verify the new box actually serves.
#
# This is the whole process — there is no by-hand `hub.json` step left. The
# hub edit goes through `cb hub add-box`, which validates the resulting config
# with the hub's own loader before writing it (`src/hub/hub-config-edit.ts`).
#
# Usage (run locally) — two forms:
#
#   Add a box that already has a repo:
#     ./deploy/add-box.sh <repo> [box-name] [options]
#
#   Create a brand-new box, repo and all:
#     ./deploy/add-box.sh --create <box-name> [--repo <owner/repo>] [options]
#
#   <repo>           GitHub URL, SSH URL, or owner/repo shorthand
#   [box-name]       directory name AND URL slug (default: repo basename).
#                    Must be lowercase letters, digits, and hyphens.
#   --create         scaffold a new box locally (`cb init`), push it to a
#                    PRIVATE GitHub repo, and then add it as normal. The box
#                    name is the positional argument in this form. Needs the
#                    `gh` CLI, authenticated. The repo may already exist as
#                    long as it is EMPTY (a repo you just created in the web
#                    UI is the common case); it is created if absent. A repo
#                    that already has commits is refused — that is the plain
#                    form above, without --create.
#   --repo OWNER/NAME  with --create, the repo to create (default:
#                    <your-gh-login>/<box-name>).
#   --allow EMAIL    grant an extra user access (repeatable). The owner
#                    always has access; this is only for ADDITIONAL users.
#                    Written to config/box.json, new boxes only — never
#                    clobbers an existing config.
#   --secrets-from BOX  copy config/connectors/*.secret.json from another
#                    box (e.g. the shared Mistral key). Avoids the
#                    "API key not configured" health warning.
#   --dry-run        run the preflight checks against the live server and
#                    print what would change. Nothing is cloned, written, or
#                    restarted. Read-only on the server.
#
#   ./deploy/add-box.sh ianb/box-birch birch --allow user@gmail.com --secrets-from personal
#
# Re-running on an existing box is idempotent: it pulls latest, re-inits, and
# leaves both manifests and the access config as they are. (Edit box.json by
# hand to change access.)
#
# Failure order matters. Everything checkable without touching the server's
# state is checked FIRST: every argument's shape, and a `--dry-run` of the
# hub-config edit against the live config. That covers the failures this script
# used to hit at the very end (a bad slug, a slug already taken, a config the
# hub would refuse). It is NOT a transaction — a failure in the clone, the
# `cb init`, the manifests, or the restart still leaves the earlier steps done.
# The script says which step failed, and re-running is safe.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CB_USER="callback"
CB_HOME="/home/$CB_USER"
BOXES_DIR="$CB_HOME/boxes"

# ── Parse arguments ─────────────────────────────────────────────────
REPO=""
BOX_NAME=""
ALLOW_EMAILS=()
SECRETS_FROM=""
DRY_RUN=""
CREATE=""
CREATE_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow)
      [[ $# -ge 2 ]] || { echo "Error: --allow needs an email"; exit 1; }
      ALLOW_EMAILS+=("$2"); shift 2 ;;
    --secrets-from)
      [[ $# -ge 2 ]] || { echo "Error: --secrets-from needs a box name"; exit 1; }
      SECRETS_FROM="$2"; shift 2 ;;
    --create)
      CREATE="1"; shift ;;
    --repo)
      [[ $# -ge 2 ]] || { echo "Error: --repo needs owner/name"; exit 1; }
      CREATE_REPO="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN="1"; shift ;;
    -*)
      echo "Error: unknown flag '$1'"; exit 1 ;;
    *)
      # With --create the sole positional is the box name; without it, the
      # first positional is the repo and the second an optional name.
      if [[ -n "$CREATE" && -z "$BOX_NAME" ]]; then BOX_NAME="$1"
      elif [[ -n "$CREATE" ]]; then echo "Error: unexpected argument '$1' (--create takes just the box name)"; exit 1
      elif [[ -z "$REPO" ]]; then REPO="$1"
      elif [[ -z "$BOX_NAME" ]]; then BOX_NAME="$1"
      else echo "Error: unexpected argument '$1'"; exit 1; fi
      shift ;;
  esac
done

if [[ -z "$CREATE" && -n "$CREATE_REPO" ]]; then
  echo "Error: --repo only applies with --create (otherwise pass the repo positionally)."
  exit 1
fi

if [[ -n "$CREATE" ]]; then
  if [[ -z "$BOX_NAME" ]]; then
    echo "Usage: $0 --create <box-name> [--repo OWNER/NAME] [--allow EMAIL]... [--secrets-from BOX] [--dry-run]"
    exit 1
  fi
  # Default the repo to <your gh login>/<box-name>. Resolved here rather than
  # left to `gh repo create`'s own default so the name is visible in the
  # dry-run output and in every error message below.
  if [[ -z "$CREATE_REPO" ]]; then
    GH_LOGIN=$(gh api user --jq .login 2>/dev/null || true)
    if [[ -z "$GH_LOGIN" ]]; then
      echo "Error: could not determine your GitHub login (is 'gh' installed and authenticated?)."
      echo "       Pass --repo OWNER/NAME explicitly."
      exit 1
    fi
    CREATE_REPO="$GH_LOGIN/$BOX_NAME"
  fi
  REPO="$CREATE_REPO"
elif [[ -z "$REPO" ]]; then
  echo "Usage: $0 <repo> [box-name] [--allow EMAIL]... [--secrets-from BOX] [--dry-run]"
  echo "       $0 --create <box-name> [--repo OWNER/NAME] [options]"
  exit 1
fi

# Normalize owner/repo shorthand to an SSH URL
if [[ "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
  REPO="git@github.com:${REPO}.git"
fi

[[ -n "$BOX_NAME" ]] || BOX_NAME=$(basename "$REPO" .git)
BOX_PATH="$BOXES_DIR/$BOX_NAME"

# The box name is also its URL slug, so it must satisfy the hub's slug rule
# (SLUG_PATTERN in src/hub/hub-config.ts). Checked locally so a repo whose
# basename isn't slug-shaped fails before we open an SSH connection; the
# server-side preflight below re-checks it (along with the reserved names)
# against the real config.
if ! [[ "$BOX_NAME" =~ ^[0-9a-z]([0-9a-z-]*[0-9a-z])?$ ]]; then
  echo "Error: box name '$BOX_NAME' is not a valid URL slug."
  echo "       Use lowercase letters, digits, and hyphens (no leading/trailing hyphen)."
  if [[ -z "$CREATE" ]]; then
    echo "       Pass an explicit name: $0 <repo> <box-name>"
  fi
  exit 1
fi

# Every remaining value is interpolated into shell that runs as root on the
# production server (see the heredoc note below), so each one is constrained to
# a shape that cannot carry a quote, a `$(...)`, a `;`, a newline, or a glob.
# Cheaper and more legible than escaping, and a name that needs those
# characters is a mistake worth stopping on anyway.
if ! [[ "$REPO" =~ ^[A-Za-z0-9@:/_.-]+$ ]]; then
  echo "Error: repo '$REPO' contains characters this script will not send to the server."
  exit 1
fi
if [[ -n "$SECRETS_FROM" ]] && ! [[ "$SECRETS_FROM" =~ ^[0-9A-Za-z._-]+$ ]]; then
  echo "Error: --secrets-from '$SECRETS_FROM' must be a plain box directory name."
  exit 1
fi
for email in ${ALLOW_EMAILS[@]+"${ALLOW_EMAILS[@]}"}; do
  if ! [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    echo "Error: --allow '$email' is not a plain email address."
    exit 1
  fi
done

# Comma-join allowed emails for the remote python one-liner.
ALLOW_CSV=""
if [[ ${#ALLOW_EMAILS[@]} -gt 0 ]]; then
  ALLOW_CSV=$(IFS=,; echo "${ALLOW_EMAILS[*]}")
fi

# ── Get server IP ───────────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
else
  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
fi

if [[ -z "$SERVER_IP" ]]; then
  echo "Error: No server IP found. Run create-server.sh first."
  exit 1
fi

SSH_OPTS="-A -o StrictHostKeyChecking=no"

# ── Preflight (read-only on the server) ─────────────────────────────
# `cb hub add-box --dry-run` validates the slug against the LIVE hub.json:
# reserved names, slug already taken by another box, and a config the hub
# would refuse to load. It writes nothing. Running it before the clone is the
# point — the previous version of this script failed at the very end, after
# it had already cloned, inited, and written config, leaving the operator
# unsure how much had landed.
echo "Preflight: validating slug '$BOX_NAME' against the live hub config..."
# shellcheck disable=SC2029
ssh $SSH_OPTS "root@$SERVER_IP" \
  "su - $CB_USER -c \"cb hub add-box '$BOX_NAME' '$BOX_PATH' --dry-run\""

# ── Preflight for --create (local + GitHub, still no mutation) ──────
# Deliberately after the hub preflight: a name the hub would refuse must never
# get as far as becoming a repo.
if [[ -n "$CREATE" ]]; then
  command -v gh >/dev/null || { echo "Error: --create needs the 'gh' CLI on PATH."; exit 1; }
  CB_BIN="$SCRIPT_DIR/../bin/cb"
  [[ -x "$CB_BIN" ]] || { echo "Error: could not find this checkout's cb at $CB_BIN"; exit 1; }

  # An EMPTY repo is fine (creating one in the web UI first is the common
  # case). One with commits is not: pushing a fresh scaffold over it is either
  # a no-op or a clobber, and neither is something to guess at.
  REPO_EXISTS=""
  if REPO_JSON=$(gh repo view "$CREATE_REPO" --json isEmpty 2>/dev/null); then
    REPO_EXISTS="1"
    if [[ "$REPO_JSON" != *'"isEmpty":true'* ]]; then
      echo "Error: $CREATE_REPO already has commits."
      echo "       Drop --create and add it directly: $0 $CREATE_REPO $BOX_NAME"
      exit 1
    fi
  fi
fi

if [[ -n "$DRY_RUN" ]]; then
  echo ""
  if [[ -n "$CREATE" ]]; then
    echo "[dry-run] Would first, locally:"
    if [[ -n "$REPO_EXISTS" ]]; then
      echo "  - use the existing EMPTY repo $CREATE_REPO"
    else
      echo "  - create a PRIVATE GitHub repo $CREATE_REPO"
    fi
    echo "  - scaffold a new box with 'cb init' and push its initial commit"
    echo ""
  fi
  echo "[dry-run] Would then, on the server:"
  echo "  - clone $REPO to $BOX_PATH (or pull, if it exists)"
  echo "  - run 'cb init' in it as $CB_USER"
  if [[ -n "$ALLOW_CSV" ]]; then
    echo "  - write config/box.json with allowedEmails: $ALLOW_CSV (new boxes only)"
  fi
  if [[ -n "$SECRETS_FROM" ]]; then
    echo "  - copy connector secrets from box '$SECRETS_FROM'"
  fi
  echo "  - register with the hub (cb hub add-box, per the plan above)"
  echo "  - register with the scheduler manifest (cb boxes add)"
  echo "  - systemctl restart callback-hub callback-scheduler"
  echo "  - verify with the hub's canary for this box"
  echo ""
  echo "[dry-run] Nothing was changed."
  exit 0
fi

# ── Create the box and its repo (local + GitHub) ────────────────────
# Scaffolds into a temp directory and pushes. Nothing is left behind locally:
# the box's homes are its GitHub repo and the server. Clone it if you want to
# work on it here.
if [[ -n "$CREATE" ]]; then
  STAGING=$(mktemp -d)
  trap 'rm -rf "$STAGING"' EXIT
  BOX_STAGE="$STAGING/$BOX_NAME"

  echo "Scaffolding a new box in a temp directory..."
  # `cb init` scaffolds the v2 package (content/, .cb-box, package.json, ...)
  # AND makes the initial git commit — no --skip-git here, that commit is what
  # gets pushed.
  "$CB_BIN" init "$BOX_STAGE"

  if [[ -z "$REPO_EXISTS" ]]; then
    echo "Creating PRIVATE GitHub repo $CREATE_REPO..."
    gh repo create "$CREATE_REPO" --private
  else
    echo "Using the existing empty repo $CREATE_REPO."
  fi

  echo "Pushing the initial commit..."
  git -C "$BOX_STAGE" remote add origin "$REPO"
  git -C "$BOX_STAGE" push -u origin HEAD

  echo "Box repo ready: $CREATE_REPO"
fi

echo "Adding box '$BOX_NAME' from $REPO..."

# ── Provision the box on the server ─────────────────────────────────
# NOTE: this is an UNQUOTED heredoc — local vars ($BOX_PATH, $ALLOW_CSV,
# ...) expand here before sending. Keep it free of backticks and bare
# $(...) (they'd run locally); use \$ for anything the remote evaluates.
# shellcheck disable=SC2029
ssh $SSH_OPTS "root@$SERVER_IP" bash -s <<REMOTE
set -euo pipefail

# Clone/pull as root (su drops the SSH agent socket, breaking agent
# forwarding), then chown to the callback user.
# Mark as safe.directory so root can operate on callback-owned repos.
git config --global --add safe.directory "$BOX_PATH"

if [[ -d "$BOX_PATH" ]]; then
  echo "Box already exists at $BOX_PATH, pulling latest..."
  cd "$BOX_PATH" && git pull --ff-only
else
  echo "Cloning $REPO to $BOX_PATH..."
  mkdir -p "$BOXES_DIR"
  git clone "$REPO" "$BOX_PATH"
fi

# Run cb init to ensure all standard directories exist (e.g., people/)
# and agent docs are up to date. Run as callback user so files get
# correct ownership. Must chown first so callback can write.
#
# A failure here is fatal: everything below (access config, secrets, both
# manifest registrations, the restart) would otherwise register a box whose
# structure is not known-good, and the restart would put it in front of users.
chown -R $CB_USER:$CB_USER "$BOX_PATH"
echo "Running cb init to update box structure..."
if ! su - $CB_USER -c "cd '$BOX_PATH' && cb init . --skip-git" 2>&1; then
  echo "cb init FAILED for $BOX_PATH — stopping before the box is registered."
  echo "The repo is cloned; fix the box and re-run this script."
  exit 1
fi

# A v2 box is a package whose operational content lives in content/ — so
# config/ is under content/, not at the package root. Resolve it the same way
# the hub does (.cb-box marks the content dir; see src/hub/child-spawn.ts's
# resolveBoxRoot), instead of assuming either layout.
if [[ -f "$BOX_PATH/content/.cb-box" ]]; then
  CONTENT_DIR="$BOX_PATH/content"
elif [[ -f "$BOX_PATH/.cb-box" ]]; then
  CONTENT_DIR="$BOX_PATH"
else
  echo "Could not find .cb-box in $BOX_PATH or $BOX_PATH/content — is this a box?"
  exit 1
fi

# Access config: only write for a brand-new box, never clobber an
# existing one (re-deploys keep their hand-tuned access).
if [[ -n "$ALLOW_CSV" ]]; then
  if [[ -f "\$CONTENT_DIR/config/box.json" ]]; then
    echo "Access: box.json exists — leaving it unchanged (add by hand: $ALLOW_CSV)"
  else
    mkdir -p "\$CONTENT_DIR/config"
    python3 -c "import json,sys; json.dump({'allowedEmails': '$ALLOW_CSV'.split(',')}, open(sys.argv[1],'w'), indent=2)" "\$CONTENT_DIR/config/box.json"
    echo "Access: wrote config/box.json (allowedEmails: $ALLOW_CSV)"
  fi
fi

# Seed connector secrets from a reference box (the shared Mistral key,
# etc.) so transcription and connectors work without a manual copy.
if [[ -n "$SECRETS_FROM" ]]; then
  SRC_DIR="$BOXES_DIR/$SECRETS_FROM/content/config/connectors"
  [[ -d "\$SRC_DIR" ]] || SRC_DIR="$BOXES_DIR/$SECRETS_FROM/config/connectors"
  mkdir -p "\$CONTENT_DIR/config/connectors"
  if cp "\$SRC_DIR"/*.secret.json "\$CONTENT_DIR/config/connectors/" 2>/dev/null; then
    chmod 600 "\$CONTENT_DIR/config/connectors/"*.secret.json
    echo "Secrets: copied from '$SECRETS_FROM'"
  else
    echo "Secrets: none found on '$SECRETS_FROM' (nothing copied)"
  fi
fi

# Re-chown everything (cb init / the writes above ran as root in places).
chown -R $CB_USER:$CB_USER "$BOX_PATH"

# ── Register the box with both manifests ────────────────────────────
# They are separate on purpose, BOTH are live, and they take DIFFERENT paths:
#   ~/.config/cb/hub.json   — the hub's routing table: which URL slug maps to
#                             which box. Takes the PACKAGE ROOT (the hub
#                             resolves either form itself). This is what makes
#                             the box reachable.
#   ~/.config/cb/boxes.json — the scheduler's box list (cb scheduler start /
#                             cb tick). Takes the BOX ROOT, i.e. content/ —
#                             that is where .cb-box lives and what every
#                             existing entry holds. See
#                             src/core/box/boxes-config.ts.
# Passing the package root to `cb boxes add` fails its .cb-box check, so use
# the content dir resolved above. Neither file is hot-reloaded, hence the
# restart below.
#
# The hub goes first: it is the step with real validation behind it, so if
# anything is going to be refused it is refused while boxes.json is still
# untouched. Both commands are idempotent and print what they did.
su - $CB_USER -c "cb hub add-box '$BOX_NAME' '$BOX_PATH'"
su - $CB_USER -c "cb boxes add '\$CONTENT_DIR'"

# Restart both services LAST, so they pick up the box, its access config,
# and its secrets in a single restart.
systemctl restart callback-hub callback-scheduler
echo "Registered and restarted (callback-hub, callback-scheduler)."
REMOTE

# ── Verify the box actually serves ──────────────────────────────────
# The hub's canary cold-starts THIS box and requires the box's own /healthz to
# answer 200 — the same check the deploy runs, targeted at the new slug. The
# box's app routes can't be curled directly: the hub puts them behind the
# session-cookie auth wall, so a plain request just redirects to login and
# proves nothing.
echo "Verifying the new box serves..."
# shellcheck disable=SC2029
ssh $SSH_OPTS "root@$SERVER_IP" bash -s <<VERIFY
set -euo pipefail
KEY=\$(grep -E '^CB_DIAG_API_KEY=' $CB_HOME/.env 2>/dev/null | cut -d= -f2- || true)
if [ -z "\$KEY" ]; then
  echo "  Could not verify: CB_DIAG_API_KEY not set in $CB_HOME/.env."
  echo "  The box is registered; check it by hand."
  exit 1
fi
CURL="curl -s --connect-timeout 5 --max-time 60"

# The hub was just restarted; poll until it answers before judging the canary.
for _ in \$(seq 1 60); do
  code=\$(\$CURL -o /dev/null -w '%{http_code}' -H "Authorization: Bearer \$KEY" \
    http://localhost:3210/healthz 2>/dev/null || echo "000")
  # 200 (ok) or 503 (a verdict of unhealthy) both mean the hub is answering;
  # only a connection failure (000) means it is still booting.
  if [ "\$code" = "200" ] || [ "\$code" = "503" ]; then break; fi
  sleep 1
done

ccode=\$(\$CURL -o /tmp/add-box-canary.out -w '%{http_code}' \
  -H "Authorization: Bearer \$KEY" \
  "http://localhost:3210/healthz/canary?box=$BOX_NAME" 2>/dev/null || echo "000")
cstatus=\$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/add-box-canary.out","utf8")).status)' 2>/dev/null || echo "unparseable")
if [ "\$ccode" != "200" ] || [ "\$cstatus" != "ok" ]; then
  echo "  Canary FAILED for '$BOX_NAME' (code: \$ccode, status: \$cstatus) — it is registered but does not serve:"
  [ -f /tmp/add-box-canary.out ] && cat /tmp/add-box-canary.out
  echo ""
  echo "  Current /healthz:"
  \$CURL -H "Authorization: Bearer \$KEY" http://localhost:3210/healthz 2>/dev/null || true
  echo ""
  rm -f /tmp/add-box-canary.out
  exit 1
fi
echo "  Canary OK: \$(cat /tmp/add-box-canary.out)"
rm -f /tmp/add-box-canary.out
VERIFY

# Only now — past the registration, the restart, and a box that answered its
# own health endpoint through the hub — is this a success.
echo ""
echo "Box '$BOX_NAME' added."
echo "  Path: $BOX_PATH"
echo "  URL:  https://box.example.com/$BOX_NAME"
