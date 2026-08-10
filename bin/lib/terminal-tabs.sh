#!/usr/bin/env bash
# Terminal.app adapter for workstream session tabs.

terminal_valid_tty() {
  [[ "$1" =~ ^/dev/tty[a-zA-Z0-9._-]+$ ]]
}

terminal_agent_on_tty() {
  local tty_path="$1" worktree_path="${2:-}" tty_name pid command cwd
  terminal_valid_tty "$tty_path" || return 1
  tty_name=${tty_path#/dev/}
  while read -r pid command; do
    command=${command##*/}
    [ "$command" = claude ] || [ "$command" = codex ] || continue
    [ -n "$worktree_path" ] || return 0
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    case "$cwd" in "$worktree_path"|"$worktree_path"/*) return 0 ;; esac
  done < <(ps -t "$tty_name" -o pid=,comm= 2>/dev/null || true)
  return 1
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
  tell application "System Events"
    repeat 40 times
      if frontmost of process "Terminal" then exit repeat
      delay 0.05
    end repeat
    if not frontmost of process "Terminal" then error "Terminal did not become frontmost"
  end tell
  tell application "System Events" to keystroke "w" using command down
  repeat 40 times
    tell application "Terminal"
      set stillPresent to false
      repeat with targetWindow in windows
        repeat with targetTab in tabs of targetWindow
          if tty of targetTab is wantedTty then set stillPresent to true
        end repeat
      end repeat
    end tell
    if not stillPresent then return
    delay 0.05
  end repeat
  error "Terminal tab remained open after Cmd-W"
end run
APPLESCRIPT
}
