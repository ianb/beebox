// Empty flat config for monorepo-root files (bin/, dev/). The PostToolUse
// vibe-check hook runs eslint from the nearest-package.json directory — for
// bin/ files that's this root — and ESLint v9 resolves flat config from the
// cwd UPWARD, so a config inside bin/ was never found (this file used to
// live there and silenced nothing; every bin/ edit got a hard "couldn't
// find an eslint.config" error from the hook). Subprojects are unaffected:
// their hook cwd is their own directory, where their own configs shadow
// this one. If the bin/ scripts grow enough to want real linting, wire up
// the vibeCheck preset here instead.
export default [];
