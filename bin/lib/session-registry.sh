#!/usr/bin/env bash
# Workstream session registry. SOURCE this file; do not execute it.

# shellcheck source=worktree-paths.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worktree-paths.sh"

SESSION_REGISTRY_LOCK=""
SESSION_LAUNCH_LEASE_SECONDS=3600

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

session_registry_iso_epoch() {
  local value="$1"
  [ -n "$value" ] || return 1
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$value" +%s 2>/dev/null \
    || date -u -d "$value" +%s 2>/dev/null
}

session_registry_epoch_iso() {
  local value="$1"
  date -j -u -f '%s' "$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -d "@$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

# Classify one already-validated registry record at an explicit epoch. The
# explicit clock keeps expiry deterministic in callers and doctests.
session_registry_launch_status_from_record() {
  local record="$1" now_epoch="$2" token started_at started_epoch expires_epoch expires_at
  local failed_at failure_reason failed_epoch
  case "$now_epoch" in ''|*[!0-9]*)
    jq -cn '{state:"unknown",startedAt:null,expiresAt:null,failedAt:null,reason:"invalid-current-epoch"}'
    return 0 ;;
  esac
  if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$record"; then
    jq -cn '{state:"unknown",startedAt:null,expiresAt:null,failedAt:null,reason:"invalid-registry-record"}'
    return 0
  fi
  if ! jq -e '.launch != null' >/dev/null 2>&1 <<<"$record"; then
    jq -cn '{state:"none",startedAt:null,expiresAt:null,failedAt:null,reason:null}'
    return 0
  fi
  if ! jq -e '.launch | type == "object"' >/dev/null 2>&1 <<<"$record"; then
    jq -cn '{state:"unknown",startedAt:null,expiresAt:null,failedAt:null,reason:"invalid-launch-record"}'
    return 0
  fi
  token=$(jq -r '.launch.token // empty' <<<"$record")
  started_at=$(jq -r '.launch.startedAt // empty' <<<"$record")
  if [ -z "$token" ] || [ -z "$started_at" ] || ! started_epoch=$(session_registry_iso_epoch "$started_at"); then
    jq -cn --arg startedAt "$started_at" \
      '{state:"unknown",startedAt:(if $startedAt == "" then null else $startedAt end),expiresAt:null,failedAt:null,reason:"invalid-launch-record"}'
    return 0
  fi
  expires_epoch=$((started_epoch + SESSION_LAUNCH_LEASE_SECONDS))
  expires_at=$(session_registry_epoch_iso "$expires_epoch" || true)
  [ -n "$expires_at" ] || {
    jq -cn --arg startedAt "$started_at" \
      '{state:"unknown",startedAt:$startedAt,expiresAt:null,failedAt:null,reason:"invalid-launch-expiry"}'
    return 0
  }
  failed_at=$(jq -r '.launch.failedAt // empty' <<<"$record")
  failure_reason=$(jq -r '.launch.failureReason // empty' <<<"$record")
  if [ -n "$failed_at" ]; then
    if ! failed_epoch=$(session_registry_iso_epoch "$failed_at"); then
      jq -cn --arg startedAt "$started_at" --arg expiresAt "$expires_at" \
        '{state:"unknown",startedAt:$startedAt,expiresAt:$expiresAt,failedAt:null,reason:"invalid-launch-failure"}'
      return 0
    fi
    jq -cn --arg startedAt "$started_at" --arg expiresAt "$expires_at" \
      --arg failedAt "$failed_at" --arg reason "${failure_reason:-launch-failed}" \
      '{state:"failed",startedAt:$startedAt,expiresAt:$expiresAt,failedAt:$failedAt,reason:$reason}'
    return 0
  fi
  if [ "$now_epoch" -ge "$expires_epoch" ]; then
    jq -cn --arg startedAt "$started_at" --arg expiresAt "$expires_at" \
      '{state:"expired",startedAt:$startedAt,expiresAt:$expiresAt,failedAt:null,reason:"launch-lease-expired"}'
    return 0
  fi
  jq -cn --arg startedAt "$started_at" --arg expiresAt "$expires_at" \
    '{state:"active",startedAt:$startedAt,expiresAt:$expiresAt,failedAt:null,reason:null}'
}

session_registry_launch_status() {
  local name="$1" now_epoch="${2:-$(date +%s)}" file record
  file=$(session_registry_file "$name") || {
    jq -cn '{state:"unknown",startedAt:null,expiresAt:null,failedAt:null,reason:"invalid-workstream-name"}'
    return 0
  }
  if [ ! -f "$file" ]; then
    session_registry_launch_status_from_record '{}' "$now_epoch"
    return 0
  fi
  if ! record=$(session_registry_read "$name"); then
    # Registry corruption predates launch leases and must not become an
    # unrelated, non-overridable liveness pin. A valid record containing a
    # malformed launch object still classifies as unknown above.
    jq -cn '{state:"none",startedAt:null,expiresAt:null,failedAt:null,reason:"invalid-registry-record"}'
    return 0
  fi
  session_registry_launch_status_from_record "$record" "$now_epoch"
}

session_registry_summary() {
  local name="$1" record launch
  record=$(session_registry_read "$name" || true)
  launch=$(session_registry_launch_status "$name")
  if [ -z "$record" ]; then
    jq -cn --argjson launch "$launch" \
      '{agent:null,hasSession:false,tty:null,emoji:null,baseSha:null,removed:null,archived:null,description:null,launch:$launch}'
    return 0
  fi
  printf '%s' "$record" | jq -c --argjson launch "$launch" '
    {
      agent: (.agent // null),
      hasSession: (((.sessionId // null) != null) or ((.agent // null) == "codex")),
      tty: (.tty // null),
      emoji: (.emoji // null),
      baseSha: (.baseSha // null),
      removed: (.removed // null),
      archived: (.archived // null),
      description: (.description // null),
      launch: $launch
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
  if ! printf '%s\n' "$$" > "$lock/pid"; then
    rmdir "$lock" 2>/dev/null || true
    SESSION_REGISTRY_LOCK=""
    return 1
  fi
}

# Internal conditional update. An expected token makes the read/compare/write
# atomic under the registry's existing lock. Return 2 for token supersession so
# launch callers can distinguish it from an IO/lock failure.
session_registry_update() {
  local name="$1" patch="$2" preserve_base_sha="$3" expected_token="$4" clear_launch="$5"
  local dir file lock current tmp updated_at current_token
  wt_paths_valid_name "$name" || {
    echo "session-registry: invalid workstream name '$name'" >&2
    return 1
  }
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$patch" || {
    echo "session-registry: update must be a JSON object" >&2
    return 1
  }
  dir="$WT_STATE_DIR/workstreams"
  if ! mkdir -p "$dir"; then
    echo "session-registry: could not create registry directory $dir" >&2
    return 1
  fi
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
  if [ -n "$expected_token" ]; then
    current_token=$(jq -r '.launch.token // empty' <<<"$current")
    if [ "$current_token" != "$expected_token" ]; then
      echo "session-registry: launch token for $name was superseded; refusing stale update" >&2
      session_registry_unlock
      return 2
    fi
  fi
  updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if ! tmp=$(mktemp "$dir/.$name.XXXXXX"); then
    echo "session-registry: could not create temporary registry file for $name" >&2
    session_registry_unlock
    return 1
  fi
  if ! jq -n --argjson current "$current" --argjson patch "$patch" \
    --arg preserveBaseSha "$preserve_base_sha" \
    --arg name "$name" --arg updatedAt "$updated_at" \
    --arg clearLaunch "$clear_launch" \
    '$current * $patch * {name: $name, updatedAt: $updatedAt}
     | if $clearLaunch == "true" then .launch = null else . end
     | if $preserveBaseSha == "--preserve-base-sha" and $current.baseSha?
       then .baseSha = $current.baseSha else . end' > "$tmp"; then
    echo "session-registry: could not compose registry update for $name" >&2
    rm -f "$tmp"
    session_registry_unlock
    return 1
  fi
  if ! mv "$tmp" "$file"; then
    echo "session-registry: could not install registry update for $name" >&2
    rm -f "$tmp"
    session_registry_unlock
    return 1
  fi
  session_registry_unlock
}

# session_registry_merge <name> <JSON object> [--preserve-base-sha]
session_registry_merge() {
  session_registry_update "$1" "$2" "${3:-}" "" false
}

session_registry_begin_launch() {
  local name="$1" token="$2" metadata="${3:-}" started_at patch
  [ -n "$token" ] || { echo "session-registry: launch token must not be empty" >&2; return 1; }
  [ -n "$metadata" ] || metadata='{}'
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$metadata" || {
    echo "session-registry: launch metadata must be a JSON object" >&2
    return 1
  }
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  patch=$(jq -cn --argjson metadata "$metadata" --arg token "$token" --arg startedAt "$started_at" \
    '$metadata * {launch:{token:$token,startedAt:$startedAt,failedAt:null,failureReason:null}}')
  session_registry_update "$name" "$patch" "" "" false
}

session_registry_record_launch_session() {
  local name="$1" token="$2" patch="$3" preserve_base_sha="${4:-}"
  session_registry_update "$name" "$patch" "$preserve_base_sha" "$token" false
}

session_registry_complete_launch() {
  local name="$1" token="$2" patch="$3" preserve_base_sha="${4:-}"
  session_registry_update "$name" "$patch" "$preserve_base_sha" "$token" true
}

session_registry_fail_launch() {
  local name="$1" token="$2" reason="$3" failed_at patch
  [ -n "$reason" ] || reason="launch-failed"
  failed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  patch=$(jq -cn --arg failedAt "$failed_at" --arg reason "$reason" \
    '{launch:{failedAt:$failedAt,failureReason:$reason}}')
  session_registry_update "$name" "$patch" "" "$token" false
}

# Remove records for absent worktrees only after their removal record is old.
session_registry_prune() {
  local cutoff_epoch="$1" file name removed_at removed_epoch record launch launch_state launch_at launch_epoch
  [ -d "$WT_STATE_DIR/workstreams" ] || return 0
  for file in "$WT_STATE_DIR"/workstreams/*.json; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .json)
    [ -d "$WT_ROOT/$name" ] && continue
    record=$(session_registry_read "$name" || true)
    [ -n "$record" ] || continue
    removed_at=$(jq -r '.removed.at // empty' <<<"$record")
    if [ -n "$removed_at" ]; then
      removed_epoch=$(session_registry_iso_epoch "$removed_at" || true)
      [ -n "$removed_epoch" ] && [ "$removed_epoch" -lt "$cutoff_epoch" ] && rm -f "$file"
      continue
    fi
    launch=$(session_registry_launch_status_from_record "$record" "$(date +%s)")
    launch_state=$(jq -r '.state' <<<"$launch")
    case "$launch_state" in failed) launch_at=$(jq -r '.failedAt // empty' <<<"$launch") ;; expired) launch_at=$(jq -r '.expiresAt // empty' <<<"$launch") ;; *) continue ;; esac
    launch_epoch=$(session_registry_iso_epoch "$launch_at" || true)
    [ -n "$launch_epoch" ] && [ "$launch_epoch" -lt "$cutoff_epoch" ] && rm -f "$file"
  done
}
