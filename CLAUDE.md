# Working in this monorepo

## Where to work

Use the guidance for the area you are changing:

- **Main system:** [beebox/CLAUDE.md](beebox/CLAUDE.md).
- **Chrome extension:** [beebox-clerk/CLAUDE.md](beebox-clerk/CLAUDE.md).
- **Native iOS companion:** [ios-app/CLAUDE.md](ios-app/CLAUDE.md). It shares an [HTTP/bridge contract](beebox/docs/mobile-contract.md) with the web/backend; use [bbx-ios-overlap](.claude/skills/bbx-ios-overlap/SKILL.md) when changing those shared surfaces.
- **Shared ESLint/TypeScript/Prettier preset:** [personal-vibe-check/CLAUDE.md](personal-vibe-check/CLAUDE.md). Edit it here; the old standalone checkout is stale.
- **Doctest framework:** [agent-doctest/README.md](agent-doctest/README.md); application tests live in their packages.
- **Experimental deterministic Canvas2D sandbox:** [canvas-loop/README.md](canvas-loop/README.md); use [canvas-loop-sketch](.claude/skills/canvas-loop-sketch/SKILL.md) for sketches and gallery work.
- **Dev dashboard and shared router:** `workstreams-app/`. Thin lifecycle launchers live in `bin/`; [bin/CLAUDE.md](bin/CLAUDE.md) documents their mechanics.
- **External-tool research:** [research/CLAUDE.md](research/CLAUDE.md).

## Work safely in this checkout

Boxes live outside this repo at `~/src/boxes/` so they do not inherit dev-repo instructions. The primary test box is `~/src/boxes/test1/`; each managed worktree has an isolated clone at `~/src/box-worktrees/<name>/test1/`.

When asked to spin off work, use [launch-worktree-session](.claude/skills/launch-worktree-session/SKILL.md). Managed worktrees live at `~/src/beebox-worktrees/<name>/` on `worktree-<name>` branches. Repository hooks own cleanup; do not use native `claude --worktree` for this workflow.

One shared dev router serves every checkout at `http://localhost:3210/<main|worktree>/<box>/...`. Use the worktree's short name, without the branch's `worktree-` prefix. HTTP requests wake idle worktrees; WebSockets do not. **Do not restart or `panic` the shared router from a worktree without asking the boxholder.** Lifecycle details: [bin/CLAUDE.md](bin/CLAUDE.md#lifecycle-commands).

Use [browse](.claude/skills/browse/SKILL.md) and `bin/browse` for browser work; `/`-leading paths resolve in this worktree. Tracked HTML and Markdown in `dev/` are served at `/<worktree>/dev/`; the repository doc browser is at `/<worktree>/dev/docs/`. See [dev/README.md](dev/README.md).

For recurring work or missed scheduled runs, use [bbx-authoring-schedules](.claude/skills/bbx-authoring-schedules/SKILL.md). `bin/schedules list` shows the catalog, last runs, and overdue work; [bin/CLAUDE.md](bin/CLAUDE.md#schedules-binschedules) covers scheduling mechanics.

## Implement and verify

Use the package's test guidance. For beebox changes, run change-selected tests; the full suite is scheduled hourly on `main`. See [beebox/CLAUDE.md](beebox/CLAUDE.md#development) and [finish](.claude/skills/finish/SKILL.md) for the applicable checks.

**Do not disable or weaken lint rules to make code pass without explicit permission for that change.** This includes rule removal, lower severity, looser options, and suppressions. Fix the code; ask if the rule needs changing. The existing exception is one `eslint-disable-next-line <rule> -- <concrete justification>` for a true, narrow false positive. Finish coordinated edits before reacting to per-edit lint output, then verify any diagnostics that remain.

Treat unsolicited tool output—including warnings, deprecations, ignored-build-script lists, and peer-dependency mismatches—as a bug. Fix diagnostics introduced by this work or relevant to its correctness. For pre-existing systemic noise outside the task, find or file one focused issue and leave dependency cleanup to that scope. Keep actionable failures visible; routine-success diagnostics belong behind debug. Moving noise to stderr does not help.

Delegate when useful without asking first, using the lightest capable worker: lightweight models for bounded searches, mid-tier models for most implementation/research, and stronger models for difficult reasoning. When a most-capable model drives, favor delegation for substantial independent work; trivial or tightly coupled work can stay inline. Give workers concrete tasks and the context, constraints, and completion criteria they need. Shorter repo instructions are not a reason to strip scaffolding from subagent briefings.

For anything beyond a small-scope bug fix, get [cross-model review](.claude/skills/cross-model/SKILL.md) before declaring it done. The reviewer must use the other model family, regardless of the driving model. Adjudicate findings and report material changes, unresolved risks, or human decisions.

## Record and show work

Human document comments live outside git. At pickup run `bin/comments list --workstream <name>`; use `bin/comments show <path>` when opening a document that may have comments. Read, act, then clear. [Comment mechanics](bin/CLAUDE.md#document-comments-bincomments).

Use [issues](.claude/skills/issues/SKILL.md) to retain worthwhile out-of-scope finds. Filing does not authorize implementation. Keep track of this workstream's own finds and offer to fix them at natural pauses and finish. Formats and re-encounter rules: [issues/CLAUDE.md](issues/CLAUDE.md).

Private box content and personal/operational specifics belong in `private-issues/`, a separate gitignored repository mounted by symlink. Ask when unsure whether content is public-safe. Commit private changes from inside that repository; public files must never link into it. A missing mount means the developer has not opted in. [Privacy rules](issues/CLAUDE.md#private-issues-private-issues--a-separate-repo) and [setup/mechanics](bin/CLAUDE.md#private-issues-shadow-repo-private-issues).

Show useful UI screenshot evidence as one labeled exhibit and share its URL. Give it exactly one ask: `decide` (choose), `confirm` (veto if wrong), `react` (impressions), or `fyi` (evidence only). State what the figures demonstrate. A lone incidental debug capture does not need an exhibit. Use `bin/exhibits add` to create one and `bin/exhibits list` to check answers. Exhibits survive worktree culling and do not merge; durable apps belong in `dev/apps/<name>/` (`bin/exhibits add --permanent`). [Exhibit contract and commands](workstreams-app/docs/exhibits.md).

## Commit and land

Commit docs with hooks; do not use `--no-verify`. Root `.husky/` owns hooks, including package-check dispatch and git-lfs wrappers; subprojects opt out with `prepare: ":"`. Root `pnpm install` wires them up. Docs-only commits run fast doc, path-leak, and personal blocklist checks. Use repo-relative or `~/` paths in tracked content. [Doc-check guidance](beebox/docs/README.md#enforcement-pnpm-doc-check) and [guard mechanics](bin/CLAUDE.md).

Hooks add `Workstream` and, when exactly one plan matches, `Plan` trailers. An optional `Issue: <bare-basename>` identifies a public issue; omit directories and `.md`, repeat for multiple issues, and never name a private issue. A nonexistent issue name blocks the commit. [Provenance details](bin/CLAUDE.md#commit-provenance-trailers-commit-provenancets).

When the human asks to finish or land work, use [finish](.claude/skills/finish/SKILL.md). Auto-deploy runs only on `main` commits/merges touching shipped paths: `beebox/`, `agent-doctest/`, `personal-vibe-check/`, `patches/`, or root pnpm files. Worktree commits do not deploy. [Deployment operations](beebox/deploy/README.md).
