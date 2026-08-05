---
title: "Doctest failure diagnostics can show source from the preceding block"
area: agent-doctest
filed-by: agent
discovered-in: worktree-agent-sdk-monitor — debugging the file-watcher doctest flake
resolution: implemented
---

Resolved in `d590ed90`. The generator now attaches the original markdown line
and example source to each TAP assertion. A real-loader regression test confirms
that a failure points to the second block at line 18 and excludes the preceding
passing block.

While debugging `callback-box/test/core/box/file-watcher.doctest.md`, a failing
subtest identified the block beginning around line 105, but its TAP diagnostic
`source` field displayed `grew < 20` from the preceding block. Temporary
instrumentation confirmed that the FD assertion passed (`before=26`, `after=26`,
`grew=0`) while the later file-change assertion timed out.

This misattribution caused the original issue to identify FD-count behavior as
part of the flake. Investigate the generated doctest line mapping and esbuild
source maps so a failure's displayed source always belongs to the failing
subtest.
