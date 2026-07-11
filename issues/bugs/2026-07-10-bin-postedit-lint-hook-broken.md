---
title: "PostToolUse lint hook errors on every bin/ edit (can't find eslint config)"
area: router
filed-by: agent
discovered-in: worktree-chat-steering — editing bin/update-agent-sdk.ts
---

Every Edit/Write to a file under `bin/` makes the PostToolUse lint hook report
"ESLint couldn't find an eslint.config.(js|mjs|cjs) file" — even though
`bin/eslint.config.mjs` exists (the deliberately empty flat config whose whole
purpose is to silence this hook; see its header comment). So either the hook
invokes eslint with a cwd/`--config` resolution that doesn't see `bin/`'s
config, or ESLint 9.39 stopped accepting an empty default export as a config.

Effect: pure noise — one spurious error block per bin/ edit, burning agent
context (the monorepo treats noisy tool output as a bug). Direct
`cd bin && pnpm exec eslint <file>` reports "No files matching the pattern",
which is a different failure — worth understanding both while fixing.

Fix direction: make the hook's eslint invocation resolve `bin/eslint.config.mjs`
(or give bin/ a minimal real config the hook can find), then confirm a bin/
edit produces a clean hook report.
