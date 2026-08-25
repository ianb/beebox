// Flat config for monorepo-root files. Only `schedules/**/*.ts` is linted.
//
// bin/ and dev/ stay unlinted, by decision: the PostToolUse vibe-check hook
// runs eslint from the nearest-package.json directory — for bin/ files that's
// this root — and ESLint v9 resolves flat config from the cwd UPWARD, so a
// config inside bin/ was never found (this file used to live there and
// silenced nothing; every bin/ edit got a hard "couldn't find an
// eslint.config" error from the hook). This file existed to answer that hook
// with an empty ruleset. Subprojects are unaffected: their hook cwd is their
// own directory, where their own configs shadow this one. Whether bin/ should
// get real linting is a separate decision (scheduled-workstreams.md, Track E,
// "Subplans"), deliberately not taken here.
//
// The scheduled-jobs directory IS linted, because `bin/schedules lint` (and
// the pre-commit hook behind it) is what stands between a broken schedule and
// a 03:00 failure nobody watches. The global-ignore entry below is what keeps
// that from leaking onto bin/: vibeCheck's underlying eslint-config-agent
// contributes rule entries with no `files` key of their own, which would
// otherwise apply to every root file the hook hands eslint.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  { ignores: ["**/*", "!schedules/**"] },
  ...vibeCheck({ react: false, roots: ["schedules"] }),
];
