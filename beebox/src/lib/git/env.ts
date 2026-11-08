/**
 * The environment every Git child process gets.
 *
 * An agent can write its box's `.git/hooks/*` and `.git/config`, and Git runs
 * commands from both: hooks on commit, checkout, and every ref update
 * (`reference-transaction`); `core.fsmonitor` on `status`, `diff`, and `add`;
 * filter drivers on `add` and `checkout`. Each runs with the Git child's
 * environment, so that environment is an allowlist, never a copy of
 * `process.env`. Every `simpleGit` and raw `git` spawn in `src/` goes through
 * this module (enforced by eslint.config.ts and `test/lib/git-env.test.ts`).
 *
 * The base is the agent profile's allowlist (`core/script-env/allowlist.ts`):
 * what a hook runs is box-authored code, and the box's own `bbx validate` hook
 * needs nothing more than an agent's `bbx` does.
 */

import { simpleGit, type SimpleGit } from "simple-git";
import { agentAllowlistEnv } from "../../core/script-env/core.js";
import { boxWorkEnvironment } from "../box-maintenance/admission.js";

/** Git's identity and config variables, kept when the parent has them. None is a credential. */
const GIT_PASS_THROUGH: readonly string[] = [
  // Identity and dates a caller or test sets for the commits it makes. EMAIL is
  // Git's fallback address when no user.email is configured.
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE", "EMAIL",
  "XDG_CONFIG_HOME", // Git's user config at $XDG_CONFIG_HOME/git/config.
  // Git's own tracing, set by a person or test debugging Git (a filter's packet traffic, for one).
  "GIT_TRACE", "GIT_TRACE_PACKET",
];

/**
 * Git sets these for a hook. A Git call made inside the hook must see the same
 * repository and index: `git commit -- <paths>` runs pre-commit against a
 * temporary index named by GIT_INDEX_FILE, and `bbx validate --pre-commit`
 * reads the staged content from it. A caller that points Git at a different
 * repository clears them (`repository: "isolated"`).
 */
const GIT_REPOSITORY: readonly string[] = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
];

/** Transport for a push or fetch only: the user's SSH agent and proxies. */
const GIT_NETWORK: readonly string[] = [
  "SSH_AUTH_SOCK", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy",
];

/**
 * The directories a parent trusts through `safe.directory` entries in its
 * `GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n` list. The deploy runs `bbx host sync`
 * as root with the box's directory trusted this way (deploy/deploy.sh); root
 * keeps no standing `safe.directory`. Other entries are dropped: a config value
 * can carry a credential (`http.extraheader`).
 */
function safeDirectories(): string[] {
  const count = Number(process.env.GIT_CONFIG_COUNT ?? "0");
  const values: string[] = [];
  for (let i = 0; Number.isInteger(count) && i < count; i++) {
    const value = process.env[`GIT_CONFIG_VALUE_${String(i)}`];
    if (process.env[`GIT_CONFIG_KEY_${String(i)}`]?.toLowerCase() === "safe.directory" && value !== undefined) values.push(value);
  }
  return values;
}

/** {@link safeDirectories} as Git's config-entry variables, renumbered, for a raw `git` spawn. */
function safeDirectoryConfig(): Record<string, string> {
  const values = safeDirectories();
  if (values.length === 0) return {};
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(values.length) };
  for (const [i, value] of values.entries()) {
    env[`GIT_CONFIG_KEY_${String(i)}`] = "safe.directory";
    env[`GIT_CONFIG_VALUE_${String(i)}`] = value;
  }
  return env;
}

export interface GitEnvironmentOptions {
  /** Add the transport variables a push or fetch needs. */
  network?: boolean;
  /** `isolated` drops the inherited repository variables, for a caller that sets its own. */
  repository?: "inherit" | "isolated";
  /** Set last; `undefined` removes a name. */
  overrides?: Readonly<Record<string, string | undefined>>;
}

/** The environment for a Git child process. */
export function gitEnvironment(options?: GitEnvironmentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...agentAllowlistEnv(), ...boxWorkEnvironment(), ...safeDirectoryConfig() };
  const names = [
    ...GIT_PASS_THROUGH,
    ...(options?.repository === "isolated" ? [] : GIT_REPOSITORY),
    ...(options?.network === true ? GIT_NETWORK : []),
  ];
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(options?.overrides ?? {})) {
    if (value === undefined) Reflect.deleteProperty(env, name);
    else env[name] = value;
  }
  return env;
}

/**
 * A simple-git instance whose Git children get {@link gitEnvironment}.
 *
 * simple-git refuses a custom environment that holds `GIT_CONFIG_COUNT`
 * (its `allowUnsafeConfigEnvCount` guard), so the trusted directories go on
 * each command as `-c safe.directory=…` instead. A refusal there made
 * `resolveGitDir` return null and admission refuse every box in the
 * 2026-11-08 deploy's `bbx host sync`.
 */
export function boxGit(dir?: string, options?: GitEnvironmentOptions): SimpleGit {
  const config = safeDirectories().map((directory) => `safe.directory=${directory}`);
  const env = gitEnvironment(options);
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_CONFIG_")) Reflect.deleteProperty(env, name);
  }
  return simpleGit({ ...(dir === undefined ? {} : { baseDir: dir }), config }).env(env);
}
