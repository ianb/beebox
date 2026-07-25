#!/usr/bin/env bash
# Run the callback-box precise OpenGrep rulepack (security/opengrep/precise.yml)
# — self-incident security-regression guards — over the working tree.
#
# Usage:
#   security/opengrep/run.sh              # scan repo, human output (non-failing)
#   security/opengrep/run.sh --error      # fail non-zero on any finding (gate mode)
#   security/opengrep/run.sh --changed    # scan only paths changed vs origin/main
#   security/opengrep/run.sh --sarif      # write SARIF to .opengrep-out/ (for CI/triage)
#   security/opengrep/run.sh -- <paths>   # scan specific paths
#
# opengrep is a separate SAST engine (not our lint stack). It expresses the
# multi-statement dataflow shapes ESLint selectors can't. Install (pinned):
#   curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/v1.25.0/install.sh | bash -s -- -v v1.25.0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$REPO_ROOT/security/opengrep/precise.yml"

# Locate opengrep: PATH first, then the official installer's default location.
if command -v opengrep >/dev/null 2>&1; then
  OPENGREP="opengrep"
elif [[ -x "$HOME/.opengrep/cli/latest/opengrep" ]]; then
  OPENGREP="$HOME/.opengrep/cli/latest/opengrep"
else
  cat >&2 <<'EOF'
error: 'opengrep' not found on PATH or ~/.opengrep/cli/latest/.
Install (pinned to match CI):
  curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/v1.25.0/install.sh | bash -s -- -v v1.25.0
  # or: brew install opengrep/tap/opengrep
EOF
  exit 127
fi

ARGS=()
CHANGED=0
while (($# > 0)); do
  case "$1" in
    --error) ARGS+=("--error"); shift ;;
    --sarif) mkdir -p "$REPO_ROOT/.opengrep-out"; ARGS+=("--sarif-output=$REPO_ROOT/.opengrep-out/precise.sarif"); shift ;;
    --changed) CHANGED=1; shift ;;
    --) shift; break ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

TARGETS=("$@")
if ((CHANGED == 1)) && ((${#TARGETS[@]} == 0)); then
  # Only first-party TypeScript/JavaScript changed vs the merge base with main.
  base="$(git -C "$REPO_ROOT" merge-base HEAD origin/main 2>/dev/null || echo HEAD)"
  while IFS= read -r f; do [[ -n "$f" && -f "$REPO_ROOT/$f" ]] && TARGETS+=("$f"); done \
    < <(git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$base" HEAD -- '*.ts' '*.tsx' '*.js' '*.mjs')
  if ((${#TARGETS[@]} == 0)); then echo "opengrep: no changed TS/JS files to scan."; exit 0; fi
fi
if ((${#TARGETS[@]} == 0)); then TARGETS=("$REPO_ROOT"); fi

exec "$OPENGREP" scan --config "$CONFIG" "${ARGS[@]}" "${TARGETS[@]}"
