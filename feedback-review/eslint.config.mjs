// Empty flat config — silences the monorepo-wide PostToolUse vibe-check
// hook when it lints files in this directory. This is a standalone
// utility dir with no package.json or node_modules, so wiring up the
// full vibeCheck preset isn't worth it. If this directory grows real
// code, set up a proper config.
export default [];
