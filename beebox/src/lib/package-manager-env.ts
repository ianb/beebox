/**
 * The environment for a `pnpm install` or `npx` child.
 *
 * An install runs the installed packages' lifecycle scripts, and a box
 * package's dependencies are box-chosen, so the child gets an allowlist rather
 * than a copy of `process.env`. The real HOME stays, so pnpm finds its store and
 * `~/.npmrc`. `npm_config_*` names are left out: they can carry registry tokens,
 * and an outer pnpm script's config would leak into the box install
 * (`scripts/smoke-external-box.ts` strips them for the same reason).
 */

const PACKAGE_MANAGER_ENV: readonly string[] = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "TZ",
  "LANG", "LC_ALL", "LC_CTYPE", "NO_COLOR", "TERM",
  // pnpm's store, cache, and config directories on Linux.
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
  "PNPM_HOME", "COREPACK_HOME",
  // The deploy sets CI=true so pnpm does not stop at a prompt with no TTY
  // (deploy/deploy.sh, deploy/server-bin/bbx-box-install).
  "CI",
  "npm_config_update_notifier",
];

/** The allowlisted names from `process.env`, plus `additions`. */
export function packageManagerEnvironment(additions?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of PACKAGE_MANAGER_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...additions };
}
