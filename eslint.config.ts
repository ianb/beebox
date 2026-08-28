// Flat config for monorepo-root files: `schedules/**` and `bin/**`, both held
// to the same reviewed personal-vibe-check ruleset every package uses.
//
// Neither is a workspace package, so root `pnpm lint`'s `-r` fan-out cannot
// reach them. Each has its own root-level command instead: `bin/schedules lint`
// (eslint plus the schedule-specific checks) and `pnpm lint:bin` (plain eslint),
// and `pnpm lint` runs the latter before fanning out. `bin/lint-changed.ts`
// dispatches both.
//
// The scheduled-jobs directory is linted because `bin/schedules lint` (and the
// pre-commit hook behind it) is what stands between a broken schedule and a
// 03:00 failure nobody watches. `bin/` is linted because it is the dev router,
// the worktree tooling and the test selector — real TypeScript that used to
// pass pre-commit on typecheck alone (issues/code-quality/2026-08-26-bin-typescript-is-not-linted.md).
//
// The global-ignore entry below still matters: vibeCheck's underlying
// eslint-config-agent contributes rule entries with no `files` key of their
// own, which would otherwise apply to every root file the PostToolUse hook
// hands eslint — including `dev/`, which stays unlinted by decision (its pages
// are deliberately casual; see workstreams-app/docs/exhibits.md). Subprojects
// are unaffected: their hook cwd is their own directory, where their own
// configs shadow this one.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  { ignores: ["**/*", "!schedules/**", "!bin/**"] },
  ...vibeCheck({ react: false, roots: ["schedules", "bin"] }),
];
