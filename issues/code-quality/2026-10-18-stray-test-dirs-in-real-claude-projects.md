---
title: "Test and probe runs leave thousands of directories in the real Claude projects store"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-flaky-tests — while fixing the transcript durability gate's symlinked-path bug
---

On 2026-10-18 the developer's real `~/.claude/projects` held 5,344
`-var-folders-*` and 556 `-private-var-folders-*` directories. Each one is
named after a macOS temp directory (a test box, a field-test box, or a probe
directory). Nothing removes them.

## What made them

Directory birth times by month (`-var-folders-*` / `-private-var-folders-*`):
July 173 / 9, August 4,862 / 340, September 138 / 124, October 167 / 80.

- **Ordinary test runs before 2026-09-02.** Most of the August peak has the
  retired `cb-doctest-*`, `cb-field-*`, and `bbx-doctest-*` box prefixes.
  Since 2026-09-02, `beebox/test/helpers/isolate-user-home.ts` (preloaded by
  `beebox/.taprc`) gives every test process a temporary `HOME`. A full run of
  733 related tests on 2026-10-18 at 21:40 made no new directory.
- **The manual tier, by design.** `pnpm test:manual` sets
  `BBX_TEST_REAL_HOME=1`, because the real `claude` CLI must see the
  developer's login. The real CLI writes its transcripts under
  `-private-var-folders-...-bbx-test-*`. The field-test box's `bbx init` also
  linked `memory` under the unresolved `-var-folders-...` name until the
  2026-10-18 fix in `symlinkClaudeMemory`. Example: the weekly run of
  2026-10-14 06:47 made one directory of each kind.
- **Probe and spike scripts outside tap.** `sdk-steering-probe-*`,
  `at-probe-*`, `or-spike-*`, `scan-vision-int-*`, and `smoke-box` run the
  real CLI with a temp cwd and the real `HOME`.
- **Doctest-conversion runs on 2026-10-18.** About 150 `bbx-doctest-*`
  directories were made between 01:45 and 14:01. They hold small fixture
  transcripts (for example the "Plan the week" fixture of the quick-chat
  submit tests), so some runner used then did not apply the `HOME` swap. The
  doctest runner is now removed. No such directory appeared after 14:01.

## Open questions

- Can the manual tier and the probes point the CLI at a throwaway projects
  directory without losing the login? The `HOME` swap breaks `claude auth
  status` (see the comment in `isolate-user-home.ts`). `CLAUDE_CONFIG_DIR` is
  not tested for this. beebox would then need `BBX_CLAUDE_PROJECTS_DIR` set to
  the same directory, so that it reads transcripts where the CLI writes them.
- Should a sweep remove the existing directories? Their names identify them as
  temp-directory runs, but nothing was deleted while filing.
