#!/usr/bin/env bash
#
# Bare-machine developer-install smoke test.
#
# Executable approximation of the "clean-clone walkthrough on a machine without
# the personal layout" rollout verification in
# docs/plans/installation-story.md. Starts from a bare `debian:bookworm`
# container (fresh every run, removed after) and follows docs/developer-install.md
# step by step, as a stranger with nothing preinstalled would:
#
#   apt prerequisites → Node 24 → corepack/pnpm → git lfs install → the Claude
#   Code CLI native installer → clone → pnpm install → build:frontend →
#   cb init → box-local pnpm install → cb serve → HTTP probe → pnpm run doctor.
#
# The doctor assertion is the payoff: EVERY check must pass EXCEPT "Claude
# auth", which must be present and *failed* with the `claude auth login`
# remedy — a headless container legitimately cannot complete an interactive
# login, and the doctor reporting exactly that one gap (and nothing else) is
# the contract this test pins.
#
# Clone mechanics: a git worktree's `.git` is a pointer to a host-absolute
# gitdir that does not exist inside the container, so we first stage a
# self-contained clone of the current branch on the host, mount it read-only
# at /repo-src, and `git clone` from THAT inside the container (a stranger's
# file-protocol clone).
#
# What this does NOT cover (needs a human / real infra):
#   - interactive `claude auth login` (the one asymmetric doctor failure above)
#   - the macOS/Homebrew prerequisite path (this exercises the Debian/apt path)
#
# Quiet on success (one "ok |" line per step); on failure it prints the failing
# step's last output and exits nonzero.
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/../.." && pwd)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
IMAGE="${SMOKE_DEV_IMAGE:-debian:bookworm}"

WORK_DIR="$(mktemp -d)"
STAGE="$WORK_DIR/callback-mono-src"
INNER="$WORK_DIR/inner.sh"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

START=$(date +%s)
echo "smoke-dev-install: staging a self-contained clone of '$BRANCH' (so the"
echo "                   in-container clone doesn't chase the worktree's host gitdir)..."
git clone -q -b "$BRANCH" "$REPO_ROOT" "$STAGE"

# ── The in-container walkthrough ─────────────────────────────────────────────
# Single-quoted heredoc: nothing expands on the host. $BRANCH etc. resolve
# inside the container from the -e env below.
cat > "$INNER" <<'INNER_EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The Claude Code native installer drops `claude` in ~/.local/bin.
export PATH="$HOME/.local/bin:$PATH"
STEPLOG=/tmp/step.log

step() {
  local desc="$1"; shift
  if "$@" > "$STEPLOG" 2>&1; then
    echo "  ok  | $desc"
  else
    local code=$?
    echo "  FAIL| $desc (exit $code)" >&2
    echo "  ---- last 80 lines of output ----" >&2
    tail -n 80 "$STEPLOG" >&2
    exit 1
  fi
}

# ── (container-only) bootstrap ───────────────────────────────────────────────
# A real developer machine already has git + curl; the bare debian:bookworm
# base does not. These exist only to bootstrap the clone and the NodeSource
# setup script — they are NOT part of developer-install.md's prerequisites.
step "bootstrap: apt update + git/curl/ca-certificates/gnupg (container-only)" \
  bash -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends git curl ca-certificates gnupg'

# ── developer-install.md prerequisites ───────────────────────────────────────
# The doc's Debian/apt line verbatim.
step "apt prerequisites (doc: pandoc imagemagick poppler-utils git-lfs)" \
  bash -c 'apt-get install -y -qq --no-install-recommends pandoc imagemagick poppler-utils git-lfs'

# Debian's `imagemagick` is IM6, which ships `convert` but not `magick` (IM7).
# The agent's external-tools contract and `pnpm run doctor` both look for
# `magick`, so alias it — the same shim the Docker image and setup-server.sh
# apply. Documented in developer-install.md's Debian note.
step "magick shim (Debian IM6 ships convert, doctor/agent want magick)" \
  bash -c 'command -v magick >/dev/null 2>&1 || ln -sf "$(command -v convert)" /usr/local/bin/magick'

# Node 24 — developer-install.md states the version; NodeSource is the stated
# Linux mechanism.
step "Node 24 via NodeSource" \
  bash -c 'curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1 && apt-get install -y -qq nodejs'

# pnpm via corepack (doc: `corepack enable`).
step "corepack enable (pnpm)" corepack enable

# git-lfs filters (doc: `git lfs install`).
step "git lfs install" git lfs install

# Claude Code CLI native installer (doc: install the Claude Code CLI).
step "Claude Code CLI native installer" \
  bash -c 'curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1'
step "claude --version (headless — the binary works without a login)" \
  claude --version

# (container-only) A fresh container has no git identity, but `cb init` makes a
# commit. A real dev machine already has user.name/email set globally.
step "git identity (container-only: cb init commits)" \
  bash -c 'git config --global user.name "Smoke Test" && git config --global user.email "smoke@box.example.com"'

# ── quickstart (developer-install.md), verbatim ──────────────────────────────
step "git clone (file-protocol, stranger's clone of '$BRANCH')" \
  git clone -b "$BRANCH" /repo-src /root/callback-mono

step "pnpm install (root workspace)" \
  bash -c 'cd /root/callback-mono && pnpm install'
step "pnpm --dir callback-box build:frontend" \
  bash -c 'cd /root/callback-mono && pnpm --dir callback-box build:frontend'
step "cb init /root/boxes/dev1" \
  bash -c 'cd /root/callback-mono/callback-box && pnpm cb init /root/boxes/dev1'
step "box-local pnpm install (v2 boxes are packages)" \
  bash -c 'cd /root/boxes/dev1 && pnpm install'

# ── cb serve + HTTP probe ────────────────────────────────────────────────────
echo "  ... | starting cb serve on :3210"
( cd /root/callback-mono/callback-box && exec pnpm cb serve /root/boxes/dev1 --port 3210 ) \
  > /tmp/serve.log 2>&1 &
SERVE_PID=$!

probe_fail() {
  echo "  FAIL| $1" >&2
  echo "  ---- cb serve log ----" >&2
  tail -n 80 /tmp/serve.log >&2
  exit 1
}

code=""
deadline=$(( $(date +%s) + 120 ))
until [[ "$(date +%s)" -ge "$deadline" ]]; do
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    probe_fail "cb serve exited before it answered"
  fi
  code="$(curl -s -o /tmp/body.html -w '%{http_code}' http://127.0.0.1:3210/ 2>/dev/null || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
[[ "$code" == "200" ]] || probe_fail "expected HTTP 200 at / , got '${code:-none}'"
grep -qi '<!doctype html\|<html' /tmp/body.html || probe_fail "response at / was not HTML"
echo "  ok  | GET / → 200 HTML"

# A built page must reference at least one hashed JS asset; that asset must 200.
asset="$(grep -oE '(src|href)="[^"]+\.js"' /tmp/body.html | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
[[ -n "$asset" ]] || probe_fail "no .js asset referenced in the served HTML"
acode="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3210${asset}" 2>/dev/null || true)"
[[ "$acode" == "200" ]] || probe_fail "JS asset $asset returned '${acode:-none}', expected 200"
echo "  ok  | GET $asset → 200"

# ── pnpm run doctor: everything ok EXCEPT Claude auth ────────────────────────
# doctor exits nonzero (Claude auth fails in a headless container), so tolerate
# the exit and assert on the JSON. `--silent` suppresses pnpm's own lifecycle
# banner ("> callback-box@… doctor"), which would otherwise pollute the JSON.
( cd /root/callback-mono && pnpm --silent run doctor --json ) > /tmp/doctor.json 2>/tmp/doctor.err || true
if ! grep -q '"checks"' /tmp/doctor.json; then
  echo "  FAIL| doctor --json produced no parseable output" >&2
  echo "  ---- stdout ----" >&2; tail -n 40 /tmp/doctor.json >&2
  echo "  ---- stderr ----" >&2; tail -n 40 /tmp/doctor.err >&2
  exit 1
fi
node -e '
  const fs = require("fs");
  const { checks } = JSON.parse(fs.readFileSync("/tmp/doctor.json", "utf8"));
  const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
  const auth = byName["Claude auth"];
  const problems = [];
  for (const c of checks) {
    if (c.name === "Claude auth") continue;
    if (!c.ok) problems.push(`${c.name}: ${c.detail}`);
  }
  if (!auth) problems.push("expected a \"Claude auth\" check, none present");
  else if (auth.ok) problems.push("expected \"Claude auth\" to FAIL headless, but it passed");
  else if (!/claude auth login/i.test(auth.remedy || "")) {
    problems.push(`Claude auth remedy should mention \`claude auth login\`, got: ${auth.remedy}`);
  }
  if (problems.length) {
    console.error("  FAIL| doctor assertions:");
    for (const p of problems) console.error("       - " + p);
    console.error("  ---- full doctor output ----");
    console.error(checks.map((c) => `${c.ok ? "ok " : "FAIL"} ${c.name}: ${c.detail}`).join("\n"));
    process.exit(1);
  }
  const okCount = checks.filter((c) => c.ok).length;
  console.error(`  ok  | doctor: ${okCount}/${checks.length} checks pass; only "Claude auth" fails (remedy: ${auth.remedy})`);
'
INNER_EOF

echo "smoke-dev-install: running the bare-machine install in $IMAGE"
echo "                   (cold — several minutes: apt, Node, pnpm install, frontend build)..."
if docker run -i --rm \
      -v "$STAGE":/repo-src:ro \
      -e BRANCH="$BRANCH" \
      "$IMAGE" bash -s < "$INNER"; then
  echo "smoke-dev-install: PASS ($(( $(date +%s) - START ))s)"
else
  echo "smoke-dev-install: FAIL (see the failing step above) ($(( $(date +%s) - START ))s)" >&2
  exit 1
fi
