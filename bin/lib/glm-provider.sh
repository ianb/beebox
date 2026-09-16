#!/usr/bin/env bash
# GLM (Z.ai) as a provider for Claude Code sessions. SOURCE this file; do not execute it.
#
# Z.ai serves an Anthropic-compatible endpoint, so `claude` needs no patching —
# only three environment variables and a model name per tier. Everything else
# about the session stays identical: the agent is still `claude`, so liveness
# checks, `--resume`, remote control and the sweep's argv matching all keep
# working unchanged. GLM is a PROVIDER of the claude agent, not a third agent.
#
# Deliberately NOT written to `~/.claude/settings.json`, which every setup guide
# tells you to do: that file is global, so it would silently redirect every
# Claude Code session on the machine — including the ones already running on
# Opus. The variables are exported inside one generated launcher script and die
# with that tab.
#
# The key lives in `beebox/.env` as `GLM_API_KEY`, the same file the dev router
# reads `BOXES=` from; no second home for credentials.

GLM_BASE_URL="https://api.z.ai/api/anthropic"

# A long timeout because the coding endpoint's first token can lag well past
# Claude Code's default, and a timeout mid-turn reads as a hang.
GLM_API_TIMEOUT_MS="3000000"

glm_is_model() {
  case "${1:-}" in glm-*) return 0 ;; *) return 1 ;; esac
}

glm_read_key() {
  local mono="$1" key
  key=$(sed -n 's/^GLM_API_KEY=//p' "$mono/beebox/.env" 2>/dev/null | tr -d '"' | head -1)
  [ -n "$key" ] || return 1
  printf '%s\n' "$key"
}

# The env block a generated launcher sources before running `claude`. Claude Code
# asks for a model by TIER name (opus/sonnet/haiku), so every tier is pointed at
# the requested GLM model rather than passing `--model`, which Z.ai would not
# recognize.
glm_env_block() {
  local model="$1" key="$2"
  cat <<ENVEOF
export ANTHROPIC_BASE_URL="$GLM_BASE_URL"
export ANTHROPIC_AUTH_TOKEN="$key"
export API_TIMEOUT_MS="$GLM_API_TIMEOUT_MS"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$model"
ENVEOF
}
