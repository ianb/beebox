---
title: "Slug, escape, string-coercion, and hash helpers repeat with small rule differences"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

The duplication sweep merged the exact copies of `plural`, the XML attribute
escape, and tap-check's regex escape. These groups remain because the copies
differ in output:

- **Truncate with an ellipsis.** `truncateTitle` (`beebox/src/core/file-summary.ts:81`)
  trims trailing space before the `…`; three copies do not
  (`beebox/src/core/notification/log.ts:70` `clip`,
  `beebox/src/core/agent/invoke/render.ts:16`, `bin/issues-output.ts:11`), and
  others add the `…` after N characters, so the result is N+1 long
  (for example `beebox/src/core/scan/validate.ts:85`, `beebox/src/services/docling/core.ts:118`,
  `beebox/src/webapp/routes/api-csp-report.ts:63`).
- **ASCII slug.** `[^a-z0-9]+` to `-` is written at least five times with
  different length caps and word-boundary rules:
  `bin/lib/schedules-filing.ts:32`, `beebox/src/scripts/user-stories/stable-id.ts:28`,
  `beebox/src/dev/lib/prompt-viewer-data/naming.ts:17`,
  `beebox/src/shared/markdoc-config/tags/core.ts:82`,
  `beebox/src/cli/commands/remind/reminder.ts:48` (adds NFKD). Three
  functions named `sanitizeFilename` give different results
  (`beebox/src/shared/filename.ts:44`, `beebox/src/core/bulk-upload/batch-format.ts:16`,
  `beebox/src/webapp/routes/chat/uploads.ts:45`). See also
  [apostrophes lost in slugs](../bugs/2026-09-02-apostrophes-lost-in-slugs-and-titles.md).
- **HTML escape.** `escapeHtml` (`beebox/src/lib/escape-html.ts`) escapes five
  characters. Copies escape four or three: `workstreams-app/src/server/exhibits/app/pages.ts:27`
  (no `'`), `beebox/src/dev/csp-report/report.ts:221`, `beebox/src/shared/favicon.ts:22`,
  `workstreams-app/src/router/server/markdown.ts:12`. A copy without `'` is
  unsafe in a single-quoted attribute.
- **Optional string from unknown.** At least eight local helpers, with four
  rules: any string, non-empty, non-blank, and `""` instead of null
  (`beebox/src/connectors/google-drive/tracking.ts:234`,
  `beebox/src/core/search/extract/core.ts:273`,
  `beebox/src/plugins/courseware/view/concept-data.ts:55`, `bin/lib/transcripts.ts:28`).
- **Full SHA-256 hex.** `contentHash` (`beebox/src/lib/content-hash.ts`)
  truncates to 16 characters. About 10 named helpers and 25 inline calls
  produce the full hex (`beebox/src/core/install-template-file.ts:189`,
  `bin/test-git.ts:110`, `beebox/src/core/triage/decisions/apply.ts:168`,
  `beebox/src/google/oauth-state.ts:63`). A shared `sha256Hex` would have
  many callers, but it is a new helper, not a merge onto an existing one.

Each needs a per-group choice of the rule; for slugs, the result is a
filename that already exists on disk.
