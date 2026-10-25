#!/usr/bin/env bash
set -euo pipefail

# Add a box to the server: clone its repo, register it with the hub (routing)
# and the scheduler (periodic tasks), seed access + connector secrets, restart
# the services, and verify the new box actually serves.
#
# This is the whole process — there is no by-hand `hub.json` step left. The
# hub edit goes through `bbx engine hub add-box`, which validates the resulting config
# with the hub's own loader before writing it (`src/hub/config-edit.ts`).
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
#   --create         scaffold a new box locally (`bbx engine init`), push it to a
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
#                    Written to _config/box.json, new boxes only — never
#                    clobbers an existing config.
#   --secrets-from BOX  give the new box the same secret GRANTS another box
#                    holds (e.g. the shared Mistral key), via
#                    `bbx engine secrets copy-grants`. Avoids the "API key not
#                    configured" health warning. Nothing is copied into the
#                    box tree: there is one copy of each secret in the
#                    machine store and this adds a grant to it, so rotation
#                    still touches one place (docs/secrets.md). Secrets that
#                    bind to one box (a bucket-scoped publish token) are skipped and
#                    named. A source box with no grants at all copies nothing:
#                    grant it the secrets it should have first.
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
# `bbx engine init`, the manifests, or the restart still leaves the earlier steps done.
# The script says which step failed, and re-running is safe.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BBX_USER="beebox"
BBX_HOME="/home/$BBX_USER"
BOXES_DIR="$BBX_HOME/boxes"
# A unit host (docs/plans/per-box-units.md) keeps each box as its own user at
# /var/lib/beebox/<slug>/box and routes to a systemd socket unit. Decided on
# the server, below, from the presence of /var/lib/beebox; everything after
# the preflight branches on UNIT_HOST.
UNIT_HOST=""

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
# A box user name is `bbx-<slug>`, capped by useradd at 32 characters.
if [[ ${#BOX_NAME} -gt 28 ]]; then
  echo "Error: box name '$BOX_NAME' is longer than 28 characters; its user name bbx-$BOX_NAME would not fit."
  exit 1
fi

# ── Push credential naming ──────────────────────────────────────────
# A GitHub deploy key attaches to exactly ONE repo, so every box needs its own,
# reached through a per-box ssh host alias (`IdentitiesOnly yes` in the stanza
# keeps ssh from offering all of them and tripping GitHub's max-auth-attempts
# limit). Key filenames take underscores because that is the existing
# convention on the server; the host alias keeps the box's own hyphens.
SSH_ALIAS="github.com-box-$BOX_NAME"
KEY_PATH="$BBX_HOME/.ssh/id_ed25519_box_${BOX_NAME//-/_}"
# On a unit host the key lives in the box user's home; re-pointed once the
# layout is known (below, after the preflight).

# Only a GitHub remote gets this treatment: the alias trick exists to select
# among per-repo deploy keys, which is a GitHub concept. Rewriting a GitLab or
# self-hosted remote into an alias form would just break it, so those keep
# whatever credential the operator already arranged.
PUSH_REMOTE=""
if [[ "$REPO" =~ ^git@github\.com:(.+)$ ]]; then
  PUSH_REMOTE="git@$SSH_ALIAS:${BASH_REMATCH[1]}"
elif [[ "$REPO" =~ ^ssh://git@github\.com/(.+)$ ]]; then
  PUSH_REMOTE="git@$SSH_ALIAS:${BASH_REMATCH[1]}"
elif [[ "$REPO" =~ ^https://github\.com/(.+)$ ]]; then
  # The usage line accepts an https GitHub URL and it clones fine — but a deploy
  # key is an SSH credential, so leaving origin on https would provision a box
  # that cannot push: the very bug this section exists to prevent, reachable
  # through a documented input.
  PUSH_REMOTE="git@$SSH_ALIAS:${BASH_REMATCH[1]%.git}.git"
fi

# The box name is also its URL slug, so it must satisfy the hub's slug rule
# (SLUG_PATTERN in src/hub/config.ts). Checked locally so a repo whose
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

# ── Resolve the deploy target ───────────────────────────────────────
# Same opt-in config the deploy uses, so a box is added to the server this
# checkout actually ships to — never to whatever `hcloud` happens to name.
# shellcheck source=beebox/deploy/deploy-target.sh
. "$SCRIPT_DIR/deploy-target.sh"
require_deploy_target "$SCRIPT_DIR"
SSH_TARGET="$BBX_DEPLOY_SSH_TARGET"

SSH_OPTS=(-A -o StrictHostKeyChecking=no)

# ── Preflight (read-only on the server) ─────────────────────────────
# `bbx engine hub add-box --dry-run` validates the slug against the LIVE hub.json:
# reserved names, slug already taken by another box, and a config the hub
# would refuse to load. It writes nothing. Running it before the clone is the
# point — the previous version of this script failed at the very end, after
# it had already cloned, inited, and written config, leaving the operator
# unsure how much had landed.
# shellcheck disable=SC2029
if ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "test -d /var/lib/beebox && id beebox-sched >/dev/null 2>&1"; then
  UNIT_HOST="1"
  BOX_HOME="/var/lib/beebox/$BOX_NAME"
  BOX_PATH="$BOX_HOME/box"
  BOX_OWNER="bbx-$BOX_NAME"
  SOCKET_FLAG="--socket"
  KEY_PATH="$BOX_HOME/.ssh/id_ed25519_box_${BOX_NAME//-/_}"
  echo "Server layout: one user and unit per box ($BOX_PATH as $BOX_OWNER)."
else
  BOX_OWNER="$BBX_USER"
  SOCKET_FLAG=""
fi

echo "Preflight: validating slug '$BOX_NAME' against the live hub config..."
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "su - $BBX_USER -c \"bbx engine hub add-box '$BOX_NAME' '$BOX_PATH' $SOCKET_FLAG --dry-run\""

# ── Preflight for --create (local + GitHub, still no mutation) ──────
# Deliberately after the hub preflight: a name the hub would refuse must never
# get as far as becoming a repo.
if [[ -n "$CREATE" ]]; then
  command -v gh >/dev/null || { echo "Error: --create needs the 'gh' CLI on PATH."; exit 1; }
  BBX_BIN="$SCRIPT_DIR/../bin/bbx"
  [[ -x "$BBX_BIN" ]] || { echo "Error: could not find this checkout's bbx at $BBX_BIN"; exit 1; }

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
    echo "  - scaffold a new box with 'bbx engine init' and push its initial commit"
    echo ""
  fi
  echo "[dry-run] Would then, on the server:"
  if [[ -n "$UNIT_HOST" ]]; then
    echo "  - create user $BOX_OWNER with home $BOX_HOME (0751), in group beebox-boxes"
  fi
  echo "  - clone $REPO to $BOX_PATH (or pull, if it exists)"
  echo "  - run 'bbx engine init' in it as $BOX_OWNER"
  if [[ -n "$ALLOW_CSV" ]]; then
    echo "  - write _config/box.json with allowedEmails: $ALLOW_CSV (new boxes only)"
  fi
  if [[ -n "$SECRETS_FROM" ]]; then
    echo "  - copy box '$SECRETS_FROM's secret grants (bbx engine secrets copy-grants; no files move)"
  fi
  echo "  - register with the hub (bbx engine hub add-box, per the plan above)"
  echo "  - register with the scheduler manifest (bbx engine boxes add)"
  if [[ -n "$UNIT_HOST" ]]; then
    echo "  - copy the box's grants into its own secret store and verify the copy"
    echo "  - systemctl enable --now beebox-box@$BOX_NAME.socket"
  fi
  echo "  - systemctl restart beebox-hub beebox-scheduler"
  echo "  - verify with the hub's canary for this box"
  if [[ -z "$PUSH_REMOTE" ]]; then
    echo "  - NOT set up a push credential ($REPO is not a GitHub remote)"
  else
    echo "  - create $KEY_PATH if absent, add an ssh stanza for $SSH_ALIAS,"
    echo "    and point origin at $PUSH_REMOTE"
    if [[ -n "$CREATE" ]]; then
      # A step that grants WRITE access to a repo does not belong only in the
      # run itself — the dry-run is where an operator decides whether to let it
      # happen.
      echo "  - register that key on $CREATE_REPO as a deploy key WITH WRITE ACCESS"
      echo "    (skipped if this box's key is already registered there)"
    else
      echo "  - print the public key for you to register by hand (write access)"
    fi
  fi
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
  # `bbx engine init` scaffolds the box (package.json with its beebox shape block, _config/, ...)
  # AND makes the initial git commit — no --skip-git here, that commit is what
  # gets pushed.
  "$BBX_BIN" init "$BOX_STAGE"

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
# The heredoc is deliberately unquoted: the local box name, paths and user are
# interpolated here, on purpose, before the script is sent.
# shellcheck disable=SC2087
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s <<REMOTE
set -euo pipefail

# On a unit host the box gets its own user first (docs/plans/per-box-units.md):
# bbx-<slug>, a UID from 2000-2999, home /var/lib/beebox/<slug> at 0751 so
# the hub can reach the one file the box publishes, in the shared-cache group.
if [[ -n "$UNIT_HOST" ]]; then
  if ! id "$BOX_OWNER" >/dev/null 2>&1; then
    # A run that failed between groupadd and useradd left the group: reuse its id.
    if getent group "$BOX_OWNER" >/dev/null; then
      uid=\$(getent group "$BOX_OWNER" | cut -d: -f3)
    else
      uid=""
      for candidate in \$(seq 2000 2999); do
        if ! getent passwd "\$candidate" >/dev/null && ! getent group "\$candidate" >/dev/null; then uid="\$candidate"; break; fi
      done
      [[ -n "\$uid" ]] || { echo "no free UID in 2000-2999"; exit 1; }
      groupadd -g "\$uid" "$BOX_OWNER"
    fi
    useradd -u "\$uid" -g "$BOX_OWNER" -G beebox-boxes -d "$BOX_HOME" -M -s /bin/bash "$BOX_OWNER"
    echo "Created user $BOX_OWNER (uid \$uid)."
  fi
  install -d -o "$BOX_OWNER" -g "$BOX_OWNER" -m 0751 "$BOX_HOME"
  for d in .claude .codex .config .local .cache .ssh; do
    install -d -o "$BOX_OWNER" -g "$BOX_OWNER" -m 0700 "$BOX_HOME/\$d"
  done
  su - "$BOX_OWNER" -c 'git config --global user.email beebox@box.example.com && git config --global user.name "Bee Box"'
fi

# Clone/pull as root (su drops the SSH agent socket, breaking agent
# forwarding), then chown to the box's owner.
# Mark as safe.directory so root can operate on the owner's repos (the deploy's
# maintenance controller reads each box's Git state as root). Once: a rerun
# used to append a duplicate entry every time.
git config --global --get-all safe.directory | grep -qxF "$BOX_PATH" || git config --global --add safe.directory "$BOX_PATH"

if [[ -d "$BOX_PATH" ]]; then
  echo "Box already exists at $BOX_PATH, pulling latest..."
  cd "$BOX_PATH" && git pull --ff-only
else
  echo "Cloning $REPO to $BOX_PATH..."
  mkdir -p "$(dirname "$BOX_PATH")"
  git clone "$REPO" "$BOX_PATH"
fi

# Run bbx engine init to ensure all standard directories exist (e.g., people/)
# and agent docs are up to date. Run as Bee Box user so files get
# correct ownership. Must chown first so the Bee Box user can write.
#
# A failure here is fatal: everything below (access config, secrets, both
# manifest registrations, the restart) would otherwise register a box whose
# structure is not known-good, and the restart would put it in front of users.
chown -R $BOX_OWNER:$BOX_OWNER "$BOX_PATH"
# On a unit host every file a box owns is private to it (the unit's UMask=0077);
# the engine opens the root, .beebox/ and hub-meta.json for the hub itself.
[[ -z "$UNIT_HOST" ]] || chmod -R go-rwx "$BOX_PATH"
# No --skip-git flag: it is gone (a box is always a git repo), and this is an
# EXISTING box, so bbx engine init re-inits in place and makes no initial commit of
# its own. It does bring the box git-annex configuration up to spec, which is
# the point of running it here.
echo "Running bbx engine init to update box structure..."
if ! su - $BOX_OWNER -c "umask 007; cd '$BOX_PATH' && BBX_UNIT_HOST=${UNIT_HOST:+1} bbx engine init ." 2>&1; then
  echo "bbx engine init FAILED for $BOX_PATH — stopping before the box is registered."
  echo "The repo is cloned; fix the box and re-run this script."
  exit 1
fi

# A box has one root: package.json, _config/, and every operational area live
# at $BOX_PATH (src/lib/box-identity.ts's isBoxRoot checks the same _config/).
# The gitignored .beebox/box.json is not a signal: a clone has none. A v2 box
# (operational tree under content/) can no longer be opened.
if [[ -d "$BOX_PATH/_config" ]]; then
  CONTENT_DIR="$BOX_PATH"
else
  echo "Could not find _config/ in $BOX_PATH — is this a box? (A v2 box with content/ cannot be opened.)"
  exit 1
fi

# Access config: only write for a brand-new box, never clobber an
# existing one (re-deploys keep their hand-tuned access).
if [[ -n "$ALLOW_CSV" ]]; then
  if [[ -f "\$CONTENT_DIR/_config/box.json" ]]; then
    echo "Access: box.json exists — leaving it unchanged (add by hand: $ALLOW_CSV)"
  else
    mkdir -p "\$CONTENT_DIR/_config"
    python3 -c "import json,sys; json.dump({'allowedEmails': '$ALLOW_CSV'.split(',')}, open(sys.argv[1],'w'), indent=2)" "\$CONTENT_DIR/_config/box.json"
    echo "Access: wrote _config/box.json (allowedEmails: $ALLOW_CSV)"
  fi
fi

# Seed connector secrets from a reference box (the shared Mistral key, etc.) so
# transcription and connectors work without a manual step.
#
# This copies GRANTS, not files: each secret has one copy in the machine store
# and the new box gets a grant to it, so rotating a key later touches one entry
# instead of every box that was ever seeded from this one (the rotation hazard
# the secret-custody plan exists to end — docs/secrets.md). Secrets that bind
# structurally to one box (a bucket-scoped publish token) are
# skipped by the command and named in its output.
#
# '--agent-confirmed' is correct here and not a rubber stamp: the operator
# explicitly passed --secrets-from. Without it the command would refuse, since
# stdin over 'ssh'/'su -c' is not a TTY and therefore reads as an agent session.
if [[ -n "$SECRETS_FROM" ]]; then
  # A failure here is fatal on purpose: an unreadable store, a missing bbx, or a
  # crash would otherwise register a box with NO credentials and restart the
  # services in front of users, with the reason scrolled off the operator's
  # screen. The box is cloned and inited; fix the cause and re-run.
  if ! COPY_OUT=\$(su - $BBX_USER -c "bbx engine secrets copy-grants '$SECRETS_FROM' '$BOX_NAME' --agent-confirmed" 2>&1); then
    echo "\$COPY_OUT"
    echo "Secrets: 'bbx engine secrets copy-grants $SECRETS_FROM $BOX_NAME' FAILED — stopping before the box is registered."
    exit 1
  fi
  echo "\$COPY_OUT"
fi

# Re-chown everything (bbx engine init / the writes above ran as root in places).
chown -R $BOX_OWNER:$BOX_OWNER "$BOX_PATH"
if [[ -n "$UNIT_HOST" ]]; then
  # The box's own secret store: its share of the hub user's master, verified.
  # Grants are still made on the master (bbx engine secrets grant as beebox);
  # this copies the result (per-box-units.subplan.md).
  store="$BOX_HOME/.config/beebox/secrets.json"
  install -d -o "$BOX_OWNER" -g "$BOX_OWNER" -m 0700 "$BOX_HOME/.config/beebox"
  su - $BBX_USER -c "bbx engine secrets export-box '$BOX_NAME' --agent-confirmed" > "\$store.tmp"
  install -o "$BOX_OWNER" -g "$BOX_OWNER" -m 0600 "\$store.tmp" "\$store"
  rm -f "\$store.tmp"
  # Verify against the master file itself (root reads both): the copy's grant
  # names for this box equal the master's. A missing store reads as empty, so
  # a copy that lost a grant is exactly what this catches.
  master_store=\$(grep -E '^BBX_SECRETS_FILE=' $BBX_HOME/.env 2>/dev/null | cut -d= -f2- || true)
  master_store="\${master_store:-$BBX_HOME/.config/beebox/secrets.json}"
  names() { node -e 'const f=require("fs");const s=f.existsSync(process.argv[1])?JSON.parse(f.readFileSync(process.argv[1],"utf8")):{grants:{}};process.stdout.write(Object.keys(s.grants[process.argv[2]]??{}).sort().join(","))' "\$1" "$BOX_NAME"; }
  master=\$(names "\$master_store"); copy=\$(names "\$store")
  if [[ "\$master" != "\$copy" ]]; then
    echo "Secrets: the box's store (\$copy) does not match the master's grants (\$master) — stopping before the box is registered."
    exit 1
  fi
  echo "Secrets: \$store holds the box's grants (\${copy:-none})."
  # Unit host: the engine link and node_modules are the deploy's job; the
  # socket unit serves the box on its first request.
  systemctl enable --now "beebox-box@$BOX_NAME.socket"
fi

# ── Register the box with both manifests ────────────────────────────
# They are separate on purpose, BOTH are live, and they take DIFFERENT paths:
#   ~/.config/beebox/hub.json   — the hub's routing table: which URL slug maps to
#                             which box. Takes the PACKAGE ROOT (the hub
#                             resolves either form itself). This is what makes
#                             the box reachable.
#   ~/.config/beebox/boxes.json — the scheduler's box list (bbx engine scheduler start /
#                             bbx tick). Takes the BOX ROOT — for a one-root box
#                             the same directory. See
#                             src/core/box/boxes-config.ts.
# 'bbx engine boxes add' checks the box root (package.json declaring beebox
# beside _config/), so use the directory resolved above. Neither file is hot-reloaded, hence the
# restart below.
#
# The hub goes first: it is the step with real validation behind it, so if
# anything is going to be refused it is refused while boxes.json is still
# untouched. Both commands are idempotent and print what they did.
su - $BBX_USER -c "bbx engine hub add-box '$BOX_NAME' '$BOX_PATH' $SOCKET_FLAG"
if [[ -n "$UNIT_HOST" ]]; then
  # The scheduler runs as its own user on a unit host and its manifest lives
  # under that home, but that user cannot read the box (0751 root, private
  # contents), and 'bbx engine boxes add' validates the box before writing. So
  # root writes the manifest into the scheduler user's home and hands it over
  # (cross-model review round 2, codex gpt-6-sol, 2026-10-24).
  HOME=/var/lib/beebox-sched bbx engine boxes add "\$CONTENT_DIR"
  chown -R beebox-sched:beebox-sched /var/lib/beebox-sched/.config
else
  su - $BBX_USER -c "bbx engine boxes add '\$CONTENT_DIR'"
fi

# Restart both services LAST, so they pick up the box, its access config,
# and its secrets in a single restart.
systemctl restart beebox-hub beebox-scheduler
echo "Registered and restarted (beebox-hub, beebox-scheduler)."
REMOTE

# ── Push credential ─────────────────────────────────────────────────
# Without this a box works in every visible way and simply never reaches its
# remote: it serves, agents run, commits land locally, and nothing says the
# history is going nowhere. That is how a box reached hundreds of unpushed
# commits with no offsite copy. Three of the four steps can be done here; the
# fourth (registering the public key on GitHub) needs the operator's account
# and is printed as the closing instruction.
PUBKEY=""
if [[ -z "$PUSH_REMOTE" ]]; then
  echo "Push credential: skipped — '$REPO' is not a GitHub remote, so its"
  echo "  per-repo deploy key convention does not apply. Make sure the box can"
  echo "  push by whatever means that host uses."
else
  echo "Setting up the box's push credential..."
  # Deliberately unquoted: the key path, alias and remote are interpolated from
  # local values before the script is sent.
  # shellcheck disable=SC2087
  PUBKEY=$(ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s <<REMOTE
set -euo pipefail

# Everything here belongs to the account that pushes: the box's owner.
su - $BOX_OWNER -s /bin/bash <<'INNER'
set -euo pipefail
mkdir -p ~/.ssh && chmod 700 ~/.ssh

# NEVER regenerate an existing key. Re-running this script is otherwise safe,
# but a fresh keypair silently orphans whichever public key is already
# registered on GitHub — turning a working box into an unpushable one with no
# error anywhere. Absent is the only case we create.
if [[ ! -e "$KEY_PATH" ]]; then
  ssh-keygen -t ed25519 -N "" -f "$KEY_PATH" -C "$SSH_ALIAS deploy key" >/dev/null
  echo "  generated $KEY_PATH" >&2
else
  echo "  key already exists, keeping it (regenerating would orphan the registered one)" >&2
fi

# The stanza and the remote below ARE safe to re-apply, so they are written
# whenever they are missing rather than only on first run.
touch ~/.ssh/config && chmod 600 ~/.ssh/config
# Fixed-string, whole-line match. A regex would treat the dots in
# 'github.com-box-…' as wildcards and could match a different alias.
if ! grep -qxF "Host $SSH_ALIAS" ~/.ssh/config; then
  printf '\nHost %s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' \
    "$SSH_ALIAS" "$KEY_PATH" >> ~/.ssh/config
  echo "  added ssh config stanza for $SSH_ALIAS" >&2
fi

# Presence of a Host line is not the same as it being CORRECT. A stanza left by
# an earlier setup can name a different IdentityFile, and origin is about to
# point at this alias regardless — so ask ssh what the alias actually resolves
# to rather than trusting the grep.
RESOLVED=$(ssh -G "$SSH_ALIAS" 2>/dev/null | awk '$1 == "identityfile" { print $2 }' | head -1)
RESOLVED="${RESOLVED/#\~/$HOME}"
if [[ "$RESOLVED" != "$KEY_PATH" ]]; then
  echo "ERROR: ssh resolves $SSH_ALIAS to identity '$RESOLVED', not '$KEY_PATH'." >&2
  echo "  An existing ssh config stanza is claiming this alias. Fix it by hand:" >&2
  echo "  pointing the box's origin at an alias that uses another key would fail" >&2
  echo "  to push in a way nothing reports." >&2
  exit 1
fi

cat "$KEY_PATH.pub"
INNER

# The remote lives in the box repo, which its owner owns.
su - $BOX_OWNER -c "git -C '$BOX_PATH' remote set-url origin '$PUSH_REMOTE'"
echo "  origin -> $PUSH_REMOTE" >&2
REMOTE
  )
fi

# ── Verify the box actually serves ──────────────────────────────────
# The hub's canary cold-starts THIS box and requires the box's own /healthz to
# answer 200 — the same check the deploy runs, targeted at the new slug. The
# box's app routes can't be curled directly: the hub puts them behind the
# session-cookie auth wall, so a plain request just redirects to login and
# proves nothing.
echo "Verifying the new box serves..."
# shellcheck disable=SC2029
# Unquoted for the same reason as the REMOTE heredoc above.
# shellcheck disable=SC2087
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s <<VERIFY
set -euo pipefail
KEY=\$(grep -E '^BBX_DIAG_API_KEY=' $BBX_HOME/.env 2>/dev/null | cut -d= -f2- || true)
if [ -z "\$KEY" ]; then
  echo "  Could not verify: BBX_DIAG_API_KEY not set in $BBX_HOME/.env."
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

# Report the URL the box is ACTUALLY reachable at. The server knows it
# (BBX_PUBLIC_URL is what the hub itself builds login redirects from), so read
# it here rather than printing a guess — a success line ending in a hostname
# that doesn't resolve is worse than no URL at all.
PUBLIC_URL=\$(grep -E '^BBX_PUBLIC_URL=' $BBX_HOME/.env 2>/dev/null | cut -d= -f2- || true)
if [ -n "\$PUBLIC_URL" ]; then
  echo "  URL: \${PUBLIC_URL%/}/$BOX_NAME/"
else
  echo "  URL: (BBX_PUBLIC_URL not set in $BBX_HOME/.env — path is /$BOX_NAME/)"
fi
VERIFY

# Only now — past the registration, the restart, and a box that answered its
# own health endpoint through the hub — is this a success.
echo ""
echo "Box '$BOX_NAME' added at $BOX_PATH."

# Last, and deliberately after the success line: this is the one step that
# cannot be done from here, and a box whose key is unregistered looks entirely
# healthy — it just never pushes. Ending on the ask is the same reason this
# script ends on a canary rather than assuming the box serves.
# On --create the operator has already delegated repo creation to `gh`, which
# is authenticated right here — so the key can be registered without a detour
# through the browser, and that path never produces an unpushable box.
#
# STICKY, and changes are explicit. Registration happens once, at creation:
# a re-run finds the title already present and does nothing. Rotating or
# replacing the credential is deliberately not something this script will do
# on its own — a silent re-register would be indistinguishable from the
# orphaned-key failure this whole section exists to prevent. Removing the old
# key on GitHub and re-running is the explicit path.
REGISTERED=""
if [[ -n "$CREATE" && -n "$PUBKEY" ]]; then
  KEY_TITLE="$SSH_ALIAS"
  # Match on the KEY MATERIAL, not the title. The question is "is this box's key
  # registered", and an operator who added it by hand may well have titled it
  # something else entirely — a title check would then miss it and add a
  # duplicate. The base64 blob is the key's identity; the comment after it is
  # not part of it and GitHub does not always keep it.
  KEY_BLOB=$(printf '%s\n' "$PUBKEY" | awk '{print $2}')
  # Matching the key is not enough: a deploy key registered READ-ONLY fetches
  # fine and never pushes, which is the failure being fixed wearing a disguise.
  # So the check is "this key, with write access". (The API field is
  # `read_only`; gh's --json accepts `readOnly` but returns snake_case, so
  # reading `.readOnly` silently yields null and every key looks writable.)
  EXISTING=$(gh api "repos/$CREATE_REPO/keys" \
    --jq ".[] | select((.key | split(\" \")[1]) == \"$KEY_BLOB\") | .read_only" 2>/dev/null || true)
  if [[ "$EXISTING" == "false" ]]; then
    echo "This box's deploy key is already registered on $CREATE_REPO with write access — leaving it alone."
    REGISTERED=1
  elif [[ "$EXISTING" == "true" ]]; then
    # Not auto-upgraded: GitHub has no in-place permission change, so "fixing"
    # it means deleting someone's existing key and adding a new one. That is a
    # decision for the operator, not a side effect of re-running a script.
    echo "WARNING: this box's deploy key is registered on $CREATE_REPO as READ-ONLY." >&2
    echo "  It will fetch and never push. Remove it on GitHub and re-run, or tick" >&2
    echo "  'Allow write access' on it by hand." >&2
  else
    PUBKEY_FILE=$(mktemp)
    printf '%s\n' "$PUBKEY" > "$PUBKEY_FILE"
    if gh repo deploy-key add "$PUBKEY_FILE" --repo "$CREATE_REPO" --title "$KEY_TITLE" --allow-write; then
      echo "Registered deploy key '$KEY_TITLE' on $CREATE_REPO with write access."
      # gh's own caveat, worth repeating because the failure it describes is
      # silent and looks exactly like the problem this section exists to solve:
      # a key added through gh is tied to gh's auth token, and de-authorizing
      # that token removes the key. The box would then quietly stop pushing.
      echo "  NOTE: a key added via gh is tied to gh's auth token — de-authorizing"
      echo "        the GitHub CLI later removes it, and the box stops pushing"
      echo "        silently. Re-add it by hand if that ever happens."
      REGISTERED=1
    else
      # Not fatal: the box is built and serving. The closing instruction below
      # then carries the manual path, which is where a non-create run lives
      # anyway.
      echo "WARNING: could not register the deploy key automatically — falling back to the manual step." >&2
    fi
    rm -f "$PUBKEY_FILE"
  fi
fi

if [[ -n "$REGISTERED" ]]; then
  echo ""
  echo "Push credential is set up and registered. Confirm with:"
  echo "  deploy/prod-ssh \"sudo -u $BOX_OWNER -H git -C '$BOX_PATH' push origin main\""
elif [[ -n "$PUBKEY" && -n "$CREATE" ]]; then
  # --create promises a box that can push. If registration did not happen, the
  # box is built and serving but cannot reach its remote, and exiting 0 here
  # would report the exact silent-success this script was changed to prevent.
  echo ""
  echo "The box is added and serving, but it CANNOT PUSH yet — registering its"
  echo "deploy key did not happen (see the warning above)."
  echo ""
  echo "Register this key on $CREATE_REPO (Settings -> Deploy keys -> Add deploy"
  echo "key), TICKING 'Allow write access':"
  echo ""
  echo "     $PUBKEY"
  echo ""
  echo "Then confirm with:"
  echo "  deploy/prod-ssh \"sudo -u $BOX_OWNER -H git -C '$BOX_PATH' push origin main\""
  exit 1
elif [[ -n "$PUBKEY" ]]; then
  echo ""
  echo "ONE STEP LEFT — the box cannot push until you do this:"
  echo "  1. Open the repo's Settings -> Deploy keys -> Add deploy key"
  echo "  2. Paste:"
  echo ""
  echo "     $PUBKEY"
  echo ""
  echo "  3. TICK 'Allow write access'. Without it the box can fetch but never"
  echo "     push, which looks identical to everything working."
  echo ""
  echo "Then confirm with:"
  echo "  deploy/prod-ssh \"sudo -u $BOX_OWNER -H git -C '$BOX_PATH' push origin main\""
fi
