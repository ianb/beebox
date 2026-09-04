#!/usr/bin/env bash
set -euo pipefail

# Add a box to the server: clone its repo, register it with the hub (routing)
# and the scheduler (periodic tasks), seed access + connector secrets, restart
# the services, and verify the new box actually serves.
#
# This is the whole process — there is no by-hand `hub.json` step left. The
# hub edit goes through `bbx hub add-box`, which validates the resulting config
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
#   --create         scaffold a new box locally (`bbx init`), push it to a
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
#   --secrets-from BOX  give the new box the same secret GRANTS another box
#                    holds (e.g. the shared Mistral key), via
#                    `bbx secrets copy-grants`. Avoids the "API key not
#                    configured" health warning. Nothing is copied into the
#                    box tree: there is one copy of each secret in the
#                    machine store and this adds a grant to it, so rotation
#                    still touches one place (docs/secrets.md). Secrets that
#                    bind to one box (a Telegram bot token) are skipped and
#                    named. If the source box predates the store — it still
#                    has *.secret.json files and no grants — the old file
#                    copy runs instead, with a deprecation warning.
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
# `bbx init`, the manifests, or the restart still leaves the earlier steps done.
# The script says which step failed, and re-running is safe.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BBX_USER="beebox"
BBX_HOME="/home/$BBX_USER"
BOXES_DIR="$BBX_HOME/boxes"

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

# ── Push credential naming ──────────────────────────────────────────
# A GitHub deploy key attaches to exactly ONE repo, so every box needs its own,
# reached through a per-box ssh host alias (`IdentitiesOnly yes` in the stanza
# keeps ssh from offering all of them and tripping GitHub's max-auth-attempts
# limit). Key filenames take underscores because that is the existing
# convention on the server; the host alias keeps the box's own hyphens.
SSH_ALIAS="github.com-box-$BOX_NAME"
KEY_PATH="$BBX_HOME/.ssh/id_ed25519_box_${BOX_NAME//-/_}"

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

# ── Resolve the deploy target ───────────────────────────────────────
# Same opt-in config the deploy uses, so a box is added to the server this
# checkout actually ships to — never to whatever `hcloud` happens to name.
# shellcheck source=beebox/deploy/deploy-target.sh
. "$SCRIPT_DIR/deploy-target.sh"
require_deploy_target "$SCRIPT_DIR"
SSH_TARGET="$BBX_DEPLOY_SSH_TARGET"

SSH_OPTS=(-A -o StrictHostKeyChecking=no)

# ── Preflight (read-only on the server) ─────────────────────────────
# `bbx hub add-box --dry-run` validates the slug against the LIVE hub.json:
# reserved names, slug already taken by another box, and a config the hub
# would refuse to load. It writes nothing. Running it before the clone is the
# point — the previous version of this script failed at the very end, after
# it had already cloned, inited, and written config, leaving the operator
# unsure how much had landed.
echo "Preflight: validating slug '$BOX_NAME' against the live hub config..."
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "su - $BBX_USER -c \"bbx hub add-box '$BOX_NAME' '$BOX_PATH' --dry-run\""

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
    echo "  - scaffold a new box with 'bbx init' and push its initial commit"
    echo ""
  fi
  echo "[dry-run] Would then, on the server:"
  echo "  - clone $REPO to $BOX_PATH (or pull, if it exists)"
  echo "  - run 'bbx init' in it as $BBX_USER"
  if [[ -n "$ALLOW_CSV" ]]; then
    echo "  - write config/box.json with allowedEmails: $ALLOW_CSV (new boxes only)"
  fi
  if [[ -n "$SECRETS_FROM" ]]; then
    echo "  - copy box '$SECRETS_FROM's secret grants (bbx secrets copy-grants; no files move)"
  fi
  echo "  - register with the hub (bbx hub add-box, per the plan above)"
  echo "  - register with the scheduler manifest (bbx boxes add)"
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
  # `bbx init` scaffolds the v2 package (content/.beebox/box.json, package.json, ...)
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

# Clone/pull as root (su drops the SSH agent socket, breaking agent
# forwarding), then chown to the Bee Box user.
# Mark as safe.directory so root can operate on Bee Box-owned repos.
git config --global --add safe.directory "$BOX_PATH"

if [[ -d "$BOX_PATH" ]]; then
  echo "Box already exists at $BOX_PATH, pulling latest..."
  cd "$BOX_PATH" && git pull --ff-only
else
  echo "Cloning $REPO to $BOX_PATH..."
  mkdir -p "$BOXES_DIR"
  git clone "$REPO" "$BOX_PATH"
fi

# Run bbx init to ensure all standard directories exist (e.g., people/)
# and agent docs are up to date. Run as Bee Box user so files get
# correct ownership. Must chown first so the Bee Box user can write.
#
# A failure here is fatal: everything below (access config, secrets, both
# manifest registrations, the restart) would otherwise register a box whose
# structure is not known-good, and the restart would put it in front of users.
chown -R $BBX_USER:$BBX_USER "$BOX_PATH"
echo "Running bbx init to update box structure..."
if ! su - $BBX_USER -c "cd '$BOX_PATH' && bbx init . --skip-git" 2>&1; then
  echo "bbx init FAILED for $BOX_PATH — stopping before the box is registered."
  echo "The repo is cloned; fix the box and re-run this script."
  exit 1
fi

# A v2 box is a package whose operational content lives in content/ — so
# config/ is under content/, not at the package root. Resolve it the same way
# the hub does (.beebox/box.json marks the content dir; see src/hub/child-spawn.ts's
# resolveBoxRoot), instead of assuming either layout.
if [[ -f "$BOX_PATH/content/.beebox/box.json" ]]; then
  CONTENT_DIR="$BOX_PATH/content"
elif [[ -f "$BOX_PATH/.beebox/box.json" ]]; then
  CONTENT_DIR="$BOX_PATH"
else
  echo "Could not find .beebox/box.json in $BOX_PATH or $BOX_PATH/content — is this a box?"
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

# Seed connector secrets from a reference box (the shared Mistral key, etc.) so
# transcription and connectors work without a manual step.
#
# This copies GRANTS, not files: each secret has one copy in the machine store
# and the new box gets a grant to it, so rotating a key later touches one entry
# instead of every box that was ever seeded from this one (the rotation hazard
# the secret-custody plan exists to end — docs/secrets.md). Secrets that bind
# structurally to one box (a Telegram bot token routes to one webhook URL) are
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
  if ! COPY_OUT=\$(su - $BBX_USER -c "bbx secrets copy-grants '$SECRETS_FROM' '$BOX_NAME' --agent-confirmed" 2>&1); then
    echo "\$COPY_OUT"
    echo "Secrets: 'bbx secrets copy-grants $SECRETS_FROM $BOX_NAME' FAILED — stopping before the box is registered."
    exit 1
  fi
  echo "\$COPY_OUT"

  # Legacy path, for a machine that has not run \`bbx secrets migrate\` yet: the
  # source box has NO GRANTS AT ALL but still holds in-tree secret files. Copy
  # them so provisioning still works, and say plainly that this is deprecated.
  #
  # The phrase below is the one copy-grants prints only for that case — a source
  # whose grants are all single-box copies nothing either, and must NOT land
  # here: falling back would hand this box the very Telegram token the command
  # just refused to share.
  SRC_DIR="$BOXES_DIR/$SECRETS_FROM/content/config/connectors"
  [[ -d "\$SRC_DIR" ]] || SRC_DIR="$BOXES_DIR/$SECRETS_FROM/config/connectors"
  if echo "\$COPY_OUT" | grep -q "has no grants at all" && compgen -G "\$SRC_DIR/*.secret.json" >/dev/null; then
    echo "Secrets: '$SECRETS_FROM' has no grants but still has in-tree secret files — falling back to the OLD file copy."
    echo "         DEPRECATED: run 'bbx secrets migrate' on this server (with the boxholder) to move them into the"
    echo "         machine store, then re-run this with --secrets-from to grant instead of copy."
    mkdir -p "\$CONTENT_DIR/config/connectors"
    for secret_file in "\$SRC_DIR"/*.secret.json; do
      # Same rule as the grant path, applied to files: a Telegram bot token
      # routes to ONE webhook URL and a publish token is scoped to one bucket,
      # so copying either would break the box already using it. (The old
      # version of this script copied them, which was the bug.)
      case "\$(basename "\$secret_file")" in
        telegram.secret.json|publish.secret.json|google.secret.json|gmail.secret.json)
          echo "Secrets: NOT copying \$(basename "\$secret_file") — it belongs to '$SECRETS_FROM' alone."
          continue ;;
      esac
      cp "\$secret_file" "\$CONTENT_DIR/config/connectors/"
      chmod 600 "\$CONTENT_DIR/config/connectors/\$(basename "\$secret_file")"
      echo "Secrets: copied \$(basename "\$secret_file") from '$SECRETS_FROM'"
    done
  fi
fi

# Re-chown everything (bbx init / the writes above ran as root in places).
chown -R $BBX_USER:$BBX_USER "$BOX_PATH"

# ── Register the box with both manifests ────────────────────────────
# They are separate on purpose, BOTH are live, and they take DIFFERENT paths:
#   ~/.config/beebox/hub.json   — the hub's routing table: which URL slug maps to
#                             which box. Takes the PACKAGE ROOT (the hub
#                             resolves either form itself). This is what makes
#                             the box reachable.
#   ~/.config/beebox/boxes.json — the scheduler's box list (bbx scheduler start /
#                             bbx tick). Takes the BOX ROOT, i.e. content/ —
#                             that is where .beebox/box.json lives and what every
#                             existing entry holds. See
#                             src/core/box/boxes-config.ts.
# Passing the package root to 'bbx boxes add' fails its .beebox/box.json check, so use
# the content dir resolved above. Neither file is hot-reloaded, hence the
# restart below.
#
# The hub goes first: it is the step with real validation behind it, so if
# anything is going to be refused it is refused while boxes.json is still
# untouched. Both commands are idempotent and print what they did.
su - $BBX_USER -c "bbx hub add-box '$BOX_NAME' '$BOX_PATH'"
su - $BBX_USER -c "bbx boxes add '\$CONTENT_DIR'"

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

# Everything here belongs to the service account, which is what actually pushes.
su - $BBX_USER -s /bin/bash <<'INNER'
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

# The remote lives in the box repo, which the service account owns.
su - $BBX_USER -c "git -C '$BOX_PATH' remote set-url origin '$PUSH_REMOTE'"
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
  echo "  deploy/prod-ssh \"sudo -u $BBX_USER -H git -C '$BOX_PATH' push origin main\""
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
  echo "  deploy/prod-ssh \"sudo -u $BBX_USER -H git -C '$BOX_PATH' push origin main\""
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
  echo "  deploy/prod-ssh \"sudo -u $BBX_USER -H git -C '$BOX_PATH' push origin main\""
fi
