---
title: "Slug, escape, string-coercion, and hash helpers repeat with small rule differences"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
resolution: implemented
---

Closed 2026-10-23 (worktree-dup-sweep-backend), plan `beebox/docs/implemented-plans/dup-sweep-backend-final.md`, commit 70c0e300a. Optional strings: `beebox/src/shared/optional-string.ts` has one function per rule (`stringOrNull`, `nonEmptyString`, `nonBlankString`), and each site kept its own rule. The courseware and recipe plugin views keep local guards because their headers restrict plugin imports. Slugs: `beebox/src/shared/ascii-slug.ts` `asciiSlug` replaces the five identical copies. These stay separate by decision, because their output differs and is stored or compared: `scripts/user-stories/stable-id.ts` (word-boundary cap; ids persisted in issue frontmatter), `cli/commands/remind/reminder.ts` `textSlug` (NFKD, word-boundary cap; names existing cards), `dev/prompt-report.ts` (GitHub anchor rule), and the three `sanitizeFilename` functions and `\w`-class stems (each keeps `_` or case; stored names depend on each).

Status 2026-10-23 (worktree-dup-sweep-backend): HTML escape and truncation are done (commit eb26250f3), and so is SHA-256. Still open: slugs and string coercion.

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
  [apostrophes lost in slugs](../../bugs/2026-09-02-apostrophes-lost-in-slugs-and-titles.md).
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
- **Full SHA-256 hex.** Done 2026-10-23 (commit 1ffc6f23d): six local helpers
  now call `sha256Hex` in `beebox/src/lib/content-hash.ts`.

Each needs a per-group choice of the rule; for slugs, the result is a
filename that already exists on disk.
