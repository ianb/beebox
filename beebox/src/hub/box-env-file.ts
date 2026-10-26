/**
 * `/etc/beebox/box.env`: the environment every box unit loads
 * (`EnvironmentFile=` in deploy/systemd/beebox-box@.service and the pass unit).
 *
 * The hub writes it at each start from its own environment through the same
 * allowlist a spawned child gets (`supervisor/child-env.ts`), so there is one
 * source for what a box may see. Three kinds of entry are left out: the OS
 * basics systemd sets per user (`HOME`, `USER`, `PATH`, the temp dirs); the
 * paths the identity subplan derives from the box user's home instead
 * (`BBX_SECRETS_FILE`, `CLAUDE_CONFIG_DIR`, `BBX_AUTH_FILE`,
 * `BBX_GOOGLE_TOKENS_FILE`); and the hub secret, which is a per-box
 * credential. The host-wide paths every box shares are appended.
 */

import * as fs from "node:fs";
import { buildChildEnv } from "./supervisor/core.js";

export const BOX_ENV_FILE = "/etc/beebox/box.env";

/** Set by systemd or derived from the box user's home; never copied from the hub's env. */
const PER_BOX: ReadonlySet<string> = new Set([
  "HOME", "USER", "USERPROFILE", "PATH", "TMPDIR", "TEMP", "TMP",
  "BBX_SECRETS_FILE", "BBX_SECRETS_STORE_ISOLATED", "CLAUDE_CONFIG_DIR", "BBX_AUTH_FILE", "BBX_GOOGLE_TOKENS_FILE",
]);

/** The host-wide paths a box unit uses (deploy/hetzner/cloud-init.yaml makes the directories). */
export const BOX_HOST_ENV: Readonly<Record<string, string>> = {
  /** Tells `bbx host install` to record and stop (cli/commands/host.ts). */
  BBX_UNIT_HOST: "1",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  UV_CACHE_DIR: "/var/cache/beebox/uv",
  HF_HOME: "/var/cache/beebox/hf",
};

/** systemd's EnvironmentFile= quoting: double quotes, backslash escapes. */
function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")}"`;
}

export function renderBoxEnvFile(sourceEnv: NodeJS.ProcessEnv): string {
  const allowed = buildChildEnv({ sourceEnv, hubExtras: {} });
  const lines = [
    "# Written by `bbx engine hub` at each start from the hub's environment,",
    "# through the child env allowlist (src/hub/supervisor/child-env.ts).",
    "# Loaded by every box unit. Edit /home/beebox/.env, not this file.",
  ];
  for (const [name, value] of Object.entries(allowed).toSorted(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined || PER_BOX.has(name)) continue;
    lines.push(`${name}=${quote(value)}`);
  }
  for (const [name, value] of Object.entries(BOX_HOST_ENV)) lines.push(`${name}=${quote(value)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Write the file for the units. `/etc/beebox` is `2755 beebox:beebox-boxes`
 * (cloud-init): the hub user owns and writes it, the file takes the cache
 * group, and a box user can read but not replace it; 0640 keeps it from
 * users outside the fleet.
 */
export function writeBoxEnvFile(filePath: string, sourceEnv: NodeJS.ProcessEnv): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, renderBoxEnvFile(sourceEnv), { mode: 0o640 });
  fs.renameSync(tmp, filePath);
}
