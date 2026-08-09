#!/usr/bin/env bash
# Terminal.app adapter for workstream session tabs.

terminal_valid_tty() {
  [[ "$1" =~ ^/dev/tty[a-zA-Z0-9._-]+$ ]]
}

terminal_agent_on_tty() {
  local tty_path="$1" tty_name snapshot
  terminal_valid_tty "$tty_path" || return 1
  tty_name=${tty_path#/dev/}
  snapshot=$(ps -t "$tty_name" -o comm= 2>/dev/null || true)
  printf '%s\n' "$snapshot" | awk '
    { name=$0; sub(/.*\//, "", name) }
    name == "claude" || name == "codex" { found=1 }
    END { exit(found ? 0 : 1) }'
}

terminal_focus_tty() {
  local tty_path="$1"
  terminal_valid_tty "$tty_path" || return 1
  osascript - "$tty_path" <<'APPLESCRIPT'
on run argv
  set wantedTty to item 1 of argv
  tell application "Terminal"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        if tty of targetTab is wantedTty then
          set selected of targetTab to true
          set index of targetWindow to 1
          activate
          return
        end if
      end repeat
    end repeat
  end tell
  error "no Terminal tab has tty " & wantedTty
end run
APPLESCRIPT
}

terminal_close_tty() {
  local tty_path="$1"
  terminal_valid_tty "$tty_path" || return 1
  # Terminal tabs do not implement AppleScript's `close` command. Select the
  # exact tty-matched tab, then use Terminal's native Cmd-W action; this keeps
  # its busy-process confirmation instead of killing the agent directly.
  osascript - "$tty_path" <<'APPLESCRIPT'
on run argv
  set wantedTty to item 1 of argv
  set foundTab to false
  tell application "Terminal"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        if tty of targetTab is wantedTty then
          set selected of targetTab to true
          set index of targetWindow to 1
          activate
          set foundTab to true
          exit repeat
        end if
      end repeat
      if foundTab then exit repeat
    end repeat
  end tell
  if not foundTab then error "no Terminal tab has tty " & wantedTty
  tell application "System Events" to keystroke "w" using command down
end run
APPLESCRIPT
}
