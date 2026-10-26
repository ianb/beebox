/** Explicit restic selection and per-box external state staging locations. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { slugOfBoxRoot } from "../../../lib/box-slug.js";
import { onUnitHost } from "../../../lib/unit-host.js";
import { BBX_STATE_DIR } from "../../../lib/state-dir.js";
import { loadHistoryEntries, listSessionRoots } from "../../chat/session/history.js";
import { findCodexRollout, codexHomeDir } from "../../../services/codex-rollout-model.js";
import { secretsFilePath } from "../../secrets/store.js";
import { authFilePath } from "../../../webapp/local-users.js";
import { centralTokenPath } from "../../../google/token-store.js";
import { backupConfigPath } from "../config.js";

export type BackupExternalKind = "box-secrets" | "auth" | "session-secret" | "google-tokens" | "origin-id" | "claude-auth" | "codex-auth" | "claude-transcripts" | "codex-transcript";
export interface BackupExternalSource { kind: BackupExternalKind; source: string; target: string; required: boolean }
export interface BackupInventory { boxRoot: string; stagingRoot: string; excludes: string[]; external: BackupExternalSource[]; skipped: Array<{ kind: BackupExternalKind; reason: string }> }

export async function backupInventory({ boxRoot, backupId }: { boxRoot: string; backupId: string }): Promise<BackupInventory> {
  const slug = slugOfBoxRoot(boxRoot);
  const stagingRoot = path.join(path.dirname(backupConfigPath(boxRoot)), "staging", backupId);
  const external: BackupInventory["external"] = [
    { kind: "box-secrets", source: secretsFilePath(), target: path.join(stagingRoot, "secrets", `${slug}.json`), required: onUnitHost() },
  ];
  const skipped: BackupInventory["skipped"] = [];
  const unitHost = onUnitHost();
  const dedicatedHome = process.env.BBX_BACKUP_DEDICATED_HOME === "1";
  if (dedicatedHome && !unitHost) {
    external.push({ kind: "auth", source: authFilePath(), target: path.join(stagingRoot, "auth", "bbx-auth.json"), required: true });
    external.push({ kind: "session-secret", source: path.join(os.homedir(), ".bbx-session-secret"), target: path.join(stagingRoot, "auth", "session-secret"), required: true });
    const tokens = centralTokenPath();
    if (tokens) external.push({ kind: "google-tokens", source: tokens, target: path.join(stagingRoot, "auth", "google-tokens.json"), required: false });
    else skipped.push({ kind: "google-tokens", reason: "no central token path configured" });
    external.push({ kind: "origin-id", source: process.env.BBX_ORIGIN_ID_FILE ?? path.join(BBX_STATE_DIR, "origin-id"), target: path.join(stagingRoot, "origin", "origin-id"), required: false });
    external.push({ kind: "claude-auth", source: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), ".credentials.json"), target: path.join(stagingRoot, "claude-auth", "credentials.json"), required: false });
    external.push({ kind: "codex-auth", source: path.join(codexHomeDir(undefined), "auth.json"), target: path.join(stagingRoot, "codex-auth", "auth.json"), required: false });
  } else if (unitHost) {
    skipped.push({ kind: "auth", reason: "hub-owned account store is outside the per-box backup" });
    skipped.push({ kind: "session-secret", reason: "hub-owned session secret is outside the per-box backup" });
    skipped.push({ kind: "google-tokens", reason: "server token grant is stored in the box tree or managed by the hub" });
    external.push({ kind: "origin-id", source: process.env.BBX_ORIGIN_ID_FILE ?? path.join(BBX_STATE_DIR, "origin-id"), target: path.join(stagingRoot, "origin", "origin-id"), required: false });
    const claudeConfig = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
    external.push({ kind: "claude-auth", source: path.join(claudeConfig, ".credentials.json"), target: path.join(stagingRoot, "claude-auth", "credentials.json"), required: false });
    external.push({ kind: "codex-auth", source: path.join(codexHomeDir(undefined), "auth.json"), target: path.join(stagingRoot, "codex-auth", "auth.json"), required: false });
  } else {
    skipped.push({ kind: "auth", reason: "shared home omitted to avoid other boxes' accounts" });
    skipped.push({ kind: "session-secret", reason: "shared home omitted to avoid other boxes' credentials" });
    skipped.push({ kind: "google-tokens", reason: "shared home omitted to avoid other boxes' tokens" });
    skipped.push({ kind: "origin-id", reason: "shared machine state omitted" });
    skipped.push({ kind: "claude-auth", reason: "shared home omitted to avoid other boxes' Claude credentials" });
    skipped.push({ kind: "codex-auth", reason: "shared home omitted to avoid other boxes' Codex credentials" });
  }
  const roots = await listSessionRoots(boxRoot);
  for (const root of roots) {
    try { await fs.access(root.dir); }
    catch (error) {
      if (isMissing(error)) { skipped.push({ kind: "claude-transcripts", reason: "no transcript directory" }); continue; }
      throw error;
    }
    external.push({ kind: "claude-transcripts", source: root.dir, target: path.join(stagingRoot, "claude-projects", path.basename(root.dir)), required: false });
  }
  const codexHome = codexHomeDir(undefined);
  for (const entry of await loadHistoryEntries(boxRoot)) {
    if (entry.engine !== "codex") continue;
    const rollout = await findCodexRollout(codexHome, entry.id);
    if (rollout) external.push({ kind: "codex-transcript", source: rollout, target: path.join(stagingRoot, "codex-rollouts", path.basename(rollout)), required: false });
    else skipped.push({ kind: "codex-transcript", reason: "no rollout file for box session history" });
  }
  return {
    boxRoot, stagingRoot, skipped,
    excludes: [
      "node_modules", "_tmp", ".beebox/events.db*", ".beebox/usage.db*", ".beebox/search*", ".beebox/logs", ".beebox/*.log", ".beebox/*.pid", ".beebox/engine",
      ".git/bbx-maintenance/**", ".git/annex/**/*.lck", ".git/annex/tmp/**", ".git/annex/keysdb/db-wal", ".git/annex/keysdb/db-shm", ".git/annex/fsckdb/db-wal", ".git/annex/fsckdb/db-shm",
      "**/node_modules", "**/.cache",
    ],
    external,
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
