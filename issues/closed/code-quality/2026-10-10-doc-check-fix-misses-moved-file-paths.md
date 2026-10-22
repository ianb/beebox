---
title: "doc-check --fix leaves backticked paths and moved files' own links broken after a plan or issue move"
workstream: unattached
area: docs
labels: [doc-check]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: implemented
---

`beebox/src/dev/doc-check/link-repair.ts` rewrites Markdown links to `.md`
targets by unique basename, and `file-paths.ts` rewrites backticked
`issues/<category>/<name>.md` paths when the issue moved to `closed/`. It does
not rewrite backticked plan paths in prose, source comments, schedule prompts, or `knowledge-audits.yaml`, and it
does not re-depth a moved issue's own `../` links to non-`.md` targets. Each
plan move or issue close then needs a hand grep.

Coding feedback: hq-always/20261010T163515Z-landed.md,
agents-md/20261009T225436Z-landed.md, journey-walks-oct/20261009T042211Z-landed.md,
journey-walks-oct/20261009T001800Z-review-adjudicated.md,
user-facing-language/20261009T124943Z-landed.md. The finish agent now says to
grep (`.claude/agents/finish.md` step 5); a move-aware rewrite would remove
that step.

## Resolution

2026-10-19, bug-burndown-3. `doc-check` now follows plan and issue moves.

- A backticked plan or issue path is relocated when exactly one plan or issue
  file has its basename. The rewrite keeps the token's form and any `:line`
  suffix. Two or more matches are reported (`file-paths.ts`).
- Code and YAML files (`.ts`, `.tsx`, `.mts`, `.yaml`, `.yml`, not
  `*.test.ts`) are scanned for bare or backticked plan and issue mentions.
  This covers source comments, schedule configs, and `knowledge-audits.yaml`.
- A broken link to a non-`.md` file is matched against tracked files by its
  path below the leading `../`, keeping only candidates reached by changing
  the number of `../`. This re-depths a moved file's own links.
- Frontmatter `design:`, `superseded-by:`, and `issues:` were already
  repaired by `repairFrontmatterPaths`.

The default check reports the backticked and code/YAML findings, and `--fix`
rewrites them. Broken non-`.md` links are repaired by `--fix` only; the
default check still does not report them, as before this change. The
finish agent's grep step (`.claude/agents/finish.md` step 5) now covers test
fixtures only.
