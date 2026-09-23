/**
 * Health check for the box's **host packages** — the distro packages it
 * recorded in `_config/host-packages.json` (`bbx host install`).
 *
 * Why it is a health check: a rebuilt server or a recreated container drops
 * every package a box installed, and the first sign would otherwise be a
 * trick failing weeks later. Severity `warning`: a missing tool degrades one
 * job, it does not stop the box.
 *
 * No row when nothing is recorded. On a host without dpkg (macOS) the row is
 * `ok` and lists the packages: that host cannot install them, so a warning
 * there could never clear.
 */

import { HOST_PACKAGES_PATH, HostPackagesParseError, loadHostPackages, missingHostPackages } from "../../../core/host-packages.js";
import type { InstalledReader } from "../../../core/host-packages-system.js";
import type { HealthCheck } from "./health.js";

const NAME = "host-packages";

export async function hostPackagesCheck(
  boxRoot: string,
  { queryInstalled }: { queryInstalled: InstalledReader },
): Promise<HealthCheck | null> {
  let packages;
  try {
    packages = await loadHostPackages(boxRoot);
  } catch (e) {
    if (!(e instanceof HostPackagesParseError)) throw e;
    return { name: NAME, ok: false, message: `${e.message}: ${e.detail}`, severity: "warning" };
  }
  const names = Object.keys(packages).toSorted();
  if (names.length === 0) return null;
  const query = await queryInstalled(names);
  if (!query.supported) {
    return {
      name: NAME,
      ok: true,
      message: `${HOST_PACKAGES_PATH} records ${names.join(" ")}; this host has no dpkg, so they cannot be checked here`,
      severity: "warning",
    };
  }
  const missing = missingHostPackages(packages, query.installed);
  if (missing.length === 0) {
    return { name: NAME, ok: true, message: `${names.length} recorded host packages installed`, severity: "warning" };
  }
  return {
    name: NAME,
    ok: false,
    message:
      `Recorded host packages not installed: ${missing.join(" ")}. ` +
      "`bbx host sync` installs them; one the host's policy refuses needs the boxholder.",
    severity: "warning",
  };
}
