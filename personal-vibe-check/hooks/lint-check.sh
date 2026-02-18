#!/bin/bash
# PostToolUse hook: lint edited/written files
# Exit 2 + stderr = feedback to Claude Code

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only lint TypeScript/TSX files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]]; then
  exit 0
fi

# Find the nearest package.json to determine the subproject root
DIR=$(dirname "$FILE_PATH")
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ]; then
    break
  fi
  DIR=$(dirname "$DIR")
done

if [ "$DIR" = "/" ]; then
  exit 0
fi

# Run eslint from the subproject root, capture output
OUTPUT=$(cd "$DIR" && npx eslint --no-warn-ignored "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0
