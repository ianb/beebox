/**
 * The host side of `bbx host`: what is installed, whether this host lets a
 * box install at all, and the sudo call into the root wrapper.
 *
 * The wrapper (`deploy/server-bin/bbx-host-apt`, installed by deploy) is the
 * whole privilege boundary and applies the whole policy. Its absence means the
 * host does not support box installs: a macOS box, or a server deployed before
 * the wrapper existed.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import { errnoCode } from "../lib/error-guards.js";
import { runCollectedChild } from "../lib/run-child.js";

export const HOST_APT_WRAPPER = "/usr/local/sbin/bbx-host-apt";

/** Wrapper exit codes (see the wrapper's header). */
export const HOST_APT_EXIT = { ok: 0, error: 1, refused: 2, usage: 64 } as const;

/** Which packages dpkg reports installed; unsupported where there is no dpkg. */
export type InstalledQuery =
  | { readonly supported: false }
  | { readonly supported: true; readonly installed: ReadonlySet<string> };

/** Reads the installed state of `names`; injected in tests. */
export type InstalledReader = (names: readonly string[]) => Promise<InstalledQuery>;

export const queryInstalledPackages: InstalledReader = async (names) => {
  if (names.length === 0) return { supported: true, installed: new Set() };
  let output: string;
  try {
    // Exit 1 when some name is unknown to dpkg; the known ones still print.
    ({ output } = await runCollectedChild({
      command: "dpkg-query",
      args: ["-W", "-f=${Package}\t${db:Status-Abbrev}\n", "--", ...names],
      cwd: "/",
    }));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { supported: false };
    throw e;
  }
  const installed = new Set<string>();
  for (const line of output.split("\n")) {
    const [name, status] = line.split("\t");
    if (name !== undefined && status?.startsWith("ii") === true) installed.add(name);
  }
  return { supported: true, installed };
};

/** True when this host has the root wrapper. */
export async function hostSupportsInstalls(): Promise<boolean> {
  try {
    await fs.access(HOST_APT_WRAPPER, fsConstants.X_OK);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/**
 * Whether sudo will run the wrapper without a password. `sudo -l` fails the
 * same way the real call would when the sudoers entry is missing or the
 * service forbids privilege changes (systemd `NoNewPrivileges`).
 */
export async function sudoAllowsWrapper(): Promise<{ ok: true } | { ok: false; output: string }> {
  try {
    const { code, output } = await runCollectedChild({
      command: "sudo",
      args: ["-n", "-l", HOST_APT_WRAPPER],
      cwd: "/",
    });
    return code === 0 ? { ok: true } : { ok: false, output: output.trim() };
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { ok: false, output: "sudo is not installed" };
    throw e;
  }
}

/** The wrapper's `--box` label: a log field only, so any slug maps onto its alphabet. */
export function wrapperBoxLabel(slug: string): string {
  const label = slug.toLowerCase().replaceAll(/[^\da-z-]+/g, "-").replace(/^[^\da-z]+/, "").slice(0, 64);
  return label === "" ? "box" : label;
}

/** Run the wrapper for `names`, streaming its output. Resolves to its exit code. */
export async function runHostApt({ box, names }: { box: string; names: readonly string[] }): Promise<number> {
  const { code } = await runCollectedChild({
    command: "sudo",
    args: ["-n", HOST_APT_WRAPPER, "install", "--box", wrapperBoxLabel(box), "--", ...names],
    cwd: "/",
    onChunk: (text) => {
      process.stdout.write(text);
    },
  });
  return code;
}
