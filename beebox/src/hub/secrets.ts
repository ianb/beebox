/**
 * One hub secret per box per boot (boxholder decision 2026-10-24, per-box-units.md
 * question 4). The first hub start of the boot mints `/run/beebox/<slug>.hub-secret`
 * for each configured slug, 0600, owned by the hub user; a later hub start reads
 * them back, so a hub-only restart does not strand the units already running
 * with the earlier value. Each box unit loads its file as a systemd credential
 * (`LoadCredential=`), so the hub never shares a secret across boxes or gives
 * a file to a box group. `/run` is a tmpfs: a reboot starts over.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";

export const HUB_SECRETS_DIR = "/run/beebox";

export function hubSecretPath(dir: string, slug: string): string {
  return path.join(dir, `${slug}.hub-secret`);
}

/** Read each slug's secret from `dir`, minting the ones that are missing. */
export function loadOrMintHubSecrets(slugs: readonly string[], dir: string): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const slug of slugs) {
    const file = hubSecretPath(dir, slug);
    let existing: string | undefined;
    try {
      existing = fs.readFileSync(file, "utf8").trim();
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
    if (existing !== undefined && existing.length > 0) {
      secrets.set(slug, existing);
      continue;
    }
    const minted = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, `${minted}\n`, { mode: 0o600 });
    secrets.set(slug, minted);
  }
  return secrets;
}
