#!/usr/bin/env bash
# Workstream session registry. SOURCE this file; do not execute it.

# shellcheck source=worktree-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worktree-paths.sh"

SESSION_REGISTRY_LOCK=""

session_registry_file() {
  local name="$1"
  wt_paths_valid_name "$name" || return 1
  printf '%s/workstreams/%s.json\n' "$WT_STATE_DIR" "$name"
}

session_registry_read() {
  local name="$1" file
  file=$(session_registry_file "$name") || return 1
  [ -f "$file" ] || return 1
  if ! jq -e 'type == "object"' "$file" >/dev/null 2>&1; then
    echo "session-registry: ignoring invalid registry file $file" >&2
    return 1
  fi
  jq -c . "$file"
}

session_registry_summary() {
  local name="$1" record
  record=$(session_registry_read "$name" || true)
  if [ -z "$record" ]; then
    printf '%s\n' '{"agent":null,"hasSession":false,"tty":null,"emoji":null,"baseSha":null,"removed":null}'
    return 0
  fi
  printf '%s' "$record" | jq -c '
    {
      agent: (.agent // null),
      hasSession: (((.sessionId // null) != null) or ((.agent // null) == "codex")),
      tty: (.tty // null),
      emoji: (.emoji // null),
      baseSha: (.baseSha // null),
      removed: (.removed // null)
    }'
}

session_registry_unlock() {
  [ -n "$SESSION_REGISTRY_LOCK" ] || return 0
  if [ "$(cat "$SESSION_REGISTRY_LOCK/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -rf "$SESSION_REGISTRY_LOCK"
  fi
  SESSION_REGISTRY_LOCK=""
}

session_registry_lock() {
  local lock="$1" tries=0 owner now mtime
  SESSION_REGISTRY_LOCK="$lock"
  while ! mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then
      owner=$(cat "$lock/pid" 2>/dev/null || true)
      if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$lock"
        tries=0
        continue
      fi
      if [ -z "$owner" ]; then
        now=$(date +%s)
        mtime=$(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo "$now")
        if [ $((now - mtime)) -gt 60 ]; then
          rm -rf "$lock"
          tries=0
          continue
        fi
      fi
      echo "session-registry: timed out acquiring $lock (owner ${owner:-unknown}); skipping update" >&2
      SESSION_REGISTRY_LOCK=""
      return 1
    fi
    sleep 0.02
  done
  printf '%s\n' "$$" > "$lock/pid"
}

# session_registry_merge <name> <JSON object> [--preserve-base-sha]
session_registry_merge() {
  local name="$1" patch="$2" preserve_base_sha="${3:-}" dir file lock current tmp updated_at
  wt_paths_valid_name "$name" || {
    echo "session-registry: invalid workstream name '$name'" >&2
    return 1
  }
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$patch" || {
    echo "session-registry: update must be a JSON object" >&2
    return 1
  }
  dir="$WT_STATE_DIR/workstreams"
  mkdir -p "$dir"
  file="$dir/$name.json"
  lock="$dir/$name.lock"
  session_registry_lock "$lock" || return 1

  current='{}'
  if [ -f "$file" ]; then
    if jq -e 'type == "object"' "$file" >/dev/null 2>&1; then
      current=$(jq -c . "$file")
    else
      echo "session-registry: replacing invalid registry file $file" >&2
    fi
  fi
  updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp=$(mktemp "$dir/.$name.XXXXXX")
  jq -n --argjson current "$current" --argjson patch "$patch" \
    --arg preserveBaseSha "$preserve_base_sha" \
    --arg name "$name" --arg updatedAt "$updated_at" \
    '$current * $patch * {name: $name, updatedAt: $updatedAt}
     | if $preserveBaseSha == "--preserve-base-sha" and $current.baseSha?
       then .baseSha = $current.baseSha else . end' > "$tmp"
  mv "$tmp" "$file"
  session_registry_unlock
}

# Remove records for absent worktrees only after their removal record is old.
session_registry_prune() {
  local cutoff_epoch="$1" file name removed_at removed_epoch
  [ -d "$WT_STATE_DIR/workstreams" ] || return 0
  for file in "$WT_STATE_DIR"/workstreams/*.json; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .json)
    [ -d "$WT_ROOT/$name" ] && continue
    removed_at=$(jq -r '.removed.at // empty' "$file" 2>/dev/null || true)
    [ -n "$removed_at" ] || continue
    removed_epoch=$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$removed_at" +%s 2>/dev/null \
      || date -u -d "$removed_at" +%s 2>/dev/null || true)
    [ -n "$removed_epoch" ] && [ "$removed_epoch" -lt "$cutoff_epoch" ] && rm -f "$file"
  done
}
