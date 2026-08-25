#!/usr/bin/env bash
# Pure routing-state projection for bin/workstreams list. States:
# launching | live | scheduled | removed | stale | dormant | uncertain.

# shellcheck source=session-registry.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-registry.sh"

workstream_iso_epoch() {
  local value="$1"
  [ -n "$value" ] || return 1
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$value" +%s 2>/dev/null \
    || date -u -d "$value" +%s 2>/dev/null
}

workstream_epoch_iso() {
  local value="$1"
  date -j -u -f '%s' "$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -d "@$value" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

# workstream_schedule_row <schedules-list-json> <name>
# The `schedule` field of one `bin/workstreams list` row: the named schedule's
# entry in `bin/schedules list --json`, or null for a workstream that is not a
# schedule. `heartbeat` is the whole scheduler's last tick rather than this
# schedule's — carried per row so a reader that only ever sees rows can still
# tell that the tick itself stopped, which is what makes `overdue` trustworthy.
workstream_schedule_row() {
  jq -c --arg name "$2" '
    ((.schedules | map(select(.name == $name)) | first) // null) as $s
    | if $s == null then null else {
        cadence: $s.cadence, enabled: $s.enabled,
        lastRunAt: $s.lastRunAt, lastOutcome: $s.lastOutcome,
        overdue: $s.overdue, nextDueAt: $s.nextDueAt, openAlerts: $s.openAlerts,
        heartbeat: (if .lastTickAt == null then null else {lastTickAt: .lastTickAt} end)
      } end' <<<"$1"
}

# workstream_routing_json <exists> <agent-state> <record-json> <tip-epoch> <dir-epoch> <now-epoch>
workstream_routing_json() {
  local exists="$1" agent_state="$2" record="$3" tip_epoch="$4" dir_epoch="$5" now_epoch="$6"
  local launched_at removed_at archived_at candidate last_epoch="" state action last_iso=""
  local launch launch_state
  launched_at=$(printf '%s' "$record" | jq -r '.launchedAt // empty' 2>/dev/null || true)
  removed_at=$(printf '%s' "$record" | jq -r '.removed.at // empty' 2>/dev/null || true)
  archived_at=$(printf '%s' "$record" | jq -r '.archived.at // empty' 2>/dev/null || true)
  for candidate in \
    "$(workstream_iso_epoch "$launched_at" 2>/dev/null || true)" \
    "$(workstream_iso_epoch "$removed_at" 2>/dev/null || true)" \
    "$tip_epoch"; do
    case "$candidate" in ''|*[!0-9]*) continue ;; esac
    [ -z "$last_epoch" ] || [ "$candidate" -le "$last_epoch" ] || last_epoch="$candidate"
    [ -n "$last_epoch" ] || last_epoch="$candidate"
  done
  # Directory mtime is only a fallback for uncommitted-only work. Treating it
  # as a peer would let installs and other top-level churn reset the stale clock.
  if [ -z "$last_epoch" ]; then
    case "$dir_epoch" in ''|*[!0-9]*) ;; *) last_epoch="$dir_epoch" ;; esac
  fi
  [ -z "$last_epoch" ] || last_iso=$(workstream_epoch_iso "$last_epoch")

  launch=$(session_registry_launch_status_from_record "$record" "$now_epoch")
  launch_state=$(jq -r '.state' <<<"$launch")

  if [ "$agent_state" = "unknown" ] || [ -n "$archived_at" ]; then
    state="uncertain"; action="investigate"
  elif [ "$agent_state" = "live" ]; then
    state="live"; action="manual-forward"
  elif [ "$launch_state" = "active" ] && [ "$agent_state" = "launching" ]; then
    state="launching"; action="wait-for-launch"
  elif [ "$launch_state" != "none" ]; then
    state="uncertain"; action="investigate"
  elif [ "$agent_state" = "none" ] && session_registry_is_scheduled "$record"; then
    # Placed after the launch-state branches on purpose: `live`, `launching`,
    # and `unknown` are fail-closed answers about a running agent, and a
    # schedule's record must never talk over one.
    state="scheduled"; action="resume-with-briefing"
  elif [ "$exists" != "true" ] && [ -n "$removed_at" ]; then
    state="removed"; action="resume-with-briefing"
  elif [ -n "$last_epoch" ] && [ $((now_epoch - last_epoch)) -ge $((14 * 24 * 60 * 60)) ]; then
    state="stale"; action="new-stream-preferred"
  elif [ "$exists" = "true" ]; then
    state="dormant"; action="resume-with-briefing"
  else
    state="uncertain"; action="investigate"
  fi
  jq -cn --arg state "$state" --arg action "$action" --arg last "$last_iso" \
    '{state:$state,action:$action,lastActivityAt:(if $last == "" then null else $last end)}'
}
