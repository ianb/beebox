// Empty flat config — silences the monorepo-wide PostToolUse vibe-check
// hook when it lints files in this directory. router.mjs and the bin/
// helpers are monorepo-root infrastructure; no package.json here, so
// wiring up the full vibeCheck preset isn't worth it. If these scripts
// grow enough to want real linting, set up a proper config.
export default [];
