#!/bin/bash
# Validate .card files after Write/Edit operations
# Input: JSON with tool_name and tool_input from Claude Code hook

# Read input from stdin
input=$(cat)

# Extract file path from tool_input.file_path
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# If no file path or not a .card file, exit silently
if [ -z "$file_path" ] || [[ ! "$file_path" =~ \.card$ ]]; then
  exit 0
fi

# Check if file exists (might have been deleted or failed to write)
if [ ! -f "$file_path" ]; then
  exit 0
fi

# Find the box root by looking for a .git directory (callback boxes are git repos)
box_root=$(dirname "$file_path")
while [ "$box_root" != "/" ] && [ ! -d "$box_root/.git" ]; do
  box_root=$(dirname "$box_root")
done

# If we found a git repo, cd there before running validation
if [ -d "$box_root/.git" ]; then
  cd "$box_root" || exit 0
fi

# Run validation
output=$(cb validate "$file_path" 2>&1)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  # Output JSON with additionalContext so the agent sees the warning
  jq -n --arg msg "Card validation warning for $file_path:
$output" '{
    "hookSpecificOutput": {
      "hookEventName": "PostToolUse",
      "additionalContext": $msg
    }
  }'
  exit 0
fi
