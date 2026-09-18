/**
 * bbx host — install distro packages this box needs on its host.
 *
 *   bbx host install <pkg...> --why "<reason>"   record, then install
 *   bbx host sync [--box <path>]                  install recorded, missing ones
 *
 * Every package is recorded in `_config/host-packages.json` first, so the need
 * is visible (and survives a rebuilt host) even when this host cannot install
 * it. Installing goes through the root wrapper `bbx-host-apt` via sudo; the
 * wrapper holds the whole policy: distro sources only, nothing upgraded or
 * removed, no services, root jobs, privilege grants or setuid files.
 *
 * Exit codes: 0 done · 1 error · 2 refused by the host's policy · 3 this host
 * does not support box installs (macOS, or a server without the wrapper).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { boxSlug } from "../../lib/box-slug.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { toError } from "../../lib/error-guards.js";
import {
  HOST_PACKAGES_PATH,
  HostPackagesParseError,
  invalidPackageNames,
  loadHostPackages,
  missingHostPackages,
  recordHostPackages,
} from "../../core/host-packages.js";
import {
  HOST_APT_EXIT,
  HOST_APT_WRAPPER,
  hostSupportsInstalls,
  queryInstalledPackages,
  runHostApt,
  sudoAllowsWrapper,
} from "../../core/host-packages-system.js";

export const HOST_EXIT = { ok: 0, error: 1, refused: 2, unsupported: 3 } as const;

/** The host operations `bbx host` depends on; tests inject fakes. */
export interface HostSystem {
  supportsInstalls: typeof hostSupportsInstalls;
  sudoAllows: typeof sudoAllowsWrapper;
  queryInstalled: typeof queryInstalledPackages;
  install: typeof runHostApt;
}

const realSystem: HostSystem = {
  supportsInstalls: hostSupportsInstalls,
  sudoAllows: sudoAllowsWrapper,
  queryInstalled: queryInstalledPackages,
  install: runHostApt,
};

function unsupportedMessage(names: readonly string[]): string {
  return [
    `This host does not allow box package installs (no ${HOST_APT_WRAPPER}: a macOS host, or a server without it).`,
    `${names.join(" ")} stays recorded in ${HOST_PACKAGES_PATH}. Ask the boxholder to install it on the host.`,
  ].join("\n");
}

/** Checks the host can install; prints why not. */
async function installBlocker(system: HostSystem, names: readonly string[]): Promise<number | null> {
  if (!(await system.supportsInstalls())) {
    console.error(unsupportedMessage(names));
    return HOST_EXIT.unsupported;
  }
  const sudo = await system.sudoAllows();
  if (!sudo.ok) {
    console.error(
      [
        `sudo will not run ${HOST_APT_WRAPPER} for this user without a password. The sudoers entry`,
        "may be missing, or the service may forbid privilege changes (systemd NoNewPrivileges).",
        `Ask the boxholder. sudo said: ${sudo.output}`,
      ].join("\n"),
    );
    return HOST_EXIT.error;
  }
  return null;
}

function reportExit(code: number): number {
  if (code === HOST_APT_EXIT.refused) {
    console.error("The host's package policy refused this. It stays recorded; ask the boxholder whether to install it by hand.");
    return HOST_EXIT.refused;
  }
  return code === HOST_APT_EXIT.ok ? HOST_EXIT.ok : HOST_EXIT.error;
}

/** Print a manifest parse error in full; rethrow anything else. */
function manifestError(e: unknown): number {
  if (!(e instanceof HostPackagesParseError)) throw toError(e);
  console.error(`${e.message}: ${e.detail}. Fix the file by hand; nothing was changed.`);
  return HOST_EXIT.error;
}

export async function runHostInstall(
  { boxRoot, packages, why }: { boxRoot: string; packages: readonly string[]; why: string },
  system: HostSystem,
): Promise<number> {
  const invalid = invalidPackageNames(packages);
  if (invalid.length > 0) {
    console.error(`Not a Debian package name: ${invalid.join(" ")}. Use the exact name, e.g. "glabels".`);
    return HOST_EXIT.error;
  }
  if (why.trim() === "") {
    console.error("--why needs the reason this box needs the package; the boxholder reads it.");
    return HOST_EXIT.error;
  }
  try {
    const recorded = await recordHostPackages(boxRoot, {
      names: packages,
      why,
      added: getBoxTimeISO(boxRoot).slice(0, 10),
    });
    if (recorded.length > 0) {
      console.log(`Recorded ${recorded.join(" ")} in ${HOST_PACKAGES_PATH}; commit it with your other changes.`);
    }
  } catch (e) {
    return manifestError(e);
  }
  const blocked = await installBlocker(system, packages);
  if (blocked !== null) return blocked;
  return reportExit(await system.install({ box: await boxSlug(boxRoot), names: packages }));
}

export async function runHostSync({ boxRoot }: { boxRoot: string }, system: HostSystem): Promise<number> {
  let packages;
  try {
    packages = await loadHostPackages(boxRoot);
  } catch (e) {
    return manifestError(e);
  }
  const names = Object.keys(packages);
  if (names.length === 0) {
    console.log(`No host packages recorded in ${HOST_PACKAGES_PATH}.`);
    return HOST_EXIT.ok;
  }
  const query = await system.queryInstalled(names);
  if (!query.supported) {
    console.error(unsupportedMessage(names));
    return HOST_EXIT.unsupported;
  }
  const missing = missingHostPackages(packages, query.installed);
  if (missing.length === 0) {
    console.log(`All ${names.length} recorded host packages are installed.`);
    return HOST_EXIT.ok;
  }
  const blocked = await installBlocker(system, missing);
  if (blocked !== null) return blocked;
  // One call per package, so one refusal does not block the others.
  const box = await boxSlug(boxRoot);
  let worst: number = HOST_EXIT.ok;
  for (const name of missing) {
    const code = reportExit(await system.install({ box, names: [name] }));
    if (code !== HOST_EXIT.ok && (worst === HOST_EXIT.ok || code === HOST_EXIT.error)) worst = code;
  }
  return worst;
}

export const hostCommand = new Command("host").description(
  "Install distro packages this box needs on its host (Debian/Ubuntu servers only)",
);

hostCommand
  .command("install <packages...>")
  .description("Record the packages in _config/host-packages.json, then install them from the distro repositories")
  .requiredOption("--why <reason>", "Why this box needs the packages; the boxholder reads it")
  .action(async (packages: string[], options: { why: string }) => {
    process.exitCode = await runHostInstall({ boxRoot: await requireBoxRoot(), packages, why: options.why }, realSystem);
  });

hostCommand
  .command("sync")
  .description("Install every recorded host package that is missing (after a host rebuild)")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    process.exitCode = await runHostSync({ boxRoot }, realSystem);
  });
