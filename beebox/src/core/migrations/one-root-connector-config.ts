/**
 * Round-8 hardening finding 3: connector config files address OTHER box
 * paths in old v2 form (no underscore fence) that the general move machinery
 * never rewrites — `executeMoves` relocates a config FILE itself
 * (`_config/connectors/*.json`) but never touches string VALUES inside it,
 * and `rewriteRefs` (`one-root-run.ts`) only opens `.card`/`.md` files.
 *
 * Audited every connector config schema (`src/connectors/*-config*.ts`) for a
 * box-path-bearing field; two carry one:
 *  - Gmail's `action.ref` / `rules[].action.ref` (a `type: "procedure"`
 *    action names its procedure card, `gmail-config.ts`'s
 *    `ProcedureActionInputSchema`) — e.g. `"config/procedures/x.procedure.card"`.
 *  - Google Drive's LEGACY `folders[].localPath` (`drive-config.ts`) — a
 *    pre-card folder mount's target directory, box-relative
 *    (`drive-folder-convert.ts`'s `resolveMountTarget`).
 * (`calendar-config.ts`'s fields are external Google calendar IDs, and
 * `telegram-types.ts`'s `TelegramConfig` carries no box path at all — neither
 * needs this treatment.)
 *
 * Both fields move verbatim otherwise, and post-migration the box's own
 * consumer then rejects/misresolves them: `gmail-config.ts`'s regex requires
 * the `_config/` prefix and throws on every subsequent sync (silently
 * stopping it); `resolveMountTarget` would resolve a stale `store/drive/…`
 * `localPath` to a directory that no longer exists.
 *
 * JSON parse/mutate/reserialize (never a text substitution — a substring
 * could collide with something unrelated), same shape as
 * `one-root-chat-bindings.ts`'s history rewrite: snapshot the pre-write bytes
 * into the shared journal for an UNTRACKED config (a tracked one's in-place
 * edit is undone for free by `revertToSnapshot`'s `reset --hard`), then
 * validate the REWRITTEN gmail config with its own parser
 * (`parseGmailConnectorConfig`) before considering the rewrite done — a
 * config the migration itself broke must fail the migration, not surface
 * later as a mysteriously-stopped sync.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { BOX_DIRS } from "../../lib/paths.js";
import { parseGmailConnectorConfig } from "../../connectors/gmail-config.js";
import { DRIVE_CONFIG_REL } from "../../connectors/drive-config.js";
import { mapV2Path } from "./one-root-mapping.js";
import { assertWriteTargetNotSymlink } from "./one-root-write-guard.js";
import { isGitTracked, isGitIgnored, type RenamedEntry } from "./one-root-move-plan.js";
import { OneRootPreflightError } from "./one-root-errors.js";

const GMAIL_CONFIG_REL = path.join(BOX_DIRS.connectors, "gmail.json");

/** Map one box-path field through the v2→v3 table; a non-string, empty, or
 * unmappable value is left as written (same "leave it stale" stance every
 * other ref rewriter in this migration takes). */
function mappedRefValue(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const mapped = mapV2Path(value);
  return mapped.kind === "move" ? mapped.newPath : null;
}

function mutateGmailActionRef(action: unknown): boolean {
  if (!isRecord(action) || action["type"] !== "procedure") return false;
  const mapped = mappedRefValue(action["ref"]);
  if (mapped === null) return false;
  action["ref"] = mapped;
  return true;
}

function mutateGmailConfig(parsed: Record<string, unknown>): boolean {
  let changed = mutateGmailActionRef(parsed["action"]);
  if (Array.isArray(parsed["rules"])) {
    for (const rule of parsed["rules"]) {
      if (isRecord(rule) && mutateGmailActionRef(rule["action"])) changed = true;
    }
  }
  return changed;
}

function mutateDriveConfig(parsed: Record<string, unknown>): boolean {
  if (!Array.isArray(parsed["folders"])) return false;
  let changed = false;
  for (const entry of parsed["folders"]) {
    if (!isRecord(entry)) continue;
    const mapped = mappedRefValue(entry["localPath"]);
    if (mapped === null) continue;
    entry["localPath"] = mapped;
    changed = true;
  }
  return changed;
}

async function rewriteJsonConfig(params: {
  absPath: string;
  configRelForError: string;
  packageRoot: string;
  journal: RenamedEntry[];
  mutate: (parsed: Record<string, unknown>) => boolean;
  validate?: (parsed: unknown) => void;
}): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(params.absPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // Malformed config: not this migration's job to repair — leave it
    // untouched, same stance `rewriteChatBindings` takes on a bad history file.
    return;
  }
  if (!isRecord(parsed) || !params.mutate(parsed)) return;
  if (params.validate) {
    try {
      params.validate(parsed);
    } catch (e) {
      throw new OneRootPreflightError(
        `${params.configRelForError}: rewriting its box-path field(s) through the v2→v3 mapping produced a ` +
          `config the connector's own parser rejects (${errorMessage(e)}) — refusing to commit. Reconcile the ` +
          "file by hand, then re-run.",
      );
    }
  }

  if (!(await isGitTracked(params.packageRoot, params.absPath))) {
    params.journal.push({
      oldAbs: params.absPath,
      newAbs: params.absPath,
      wasIgnored: await isGitIgnored(params.packageRoot, params.absPath),
      originalFileBytes: raw,
    });
  }
  await assertWriteTargetNotSymlink(params.absPath);
  await writeFileAtomic(params.absPath, { content: `${JSON.stringify(parsed, null, 2)}\n` });
}

/** Rewrite every known connector config's box-path field, post-move
 * (`packageRoot`-relative — the configs already moved to their v3 home).
 * Called after the general move plus chat-binding rewrite, before the hard
 * link gate (which never scans connector configs — this is its own
 * validation, via each connector's own parser). */
export async function rewriteConnectorConfigRefs(params: {
  packageRoot: string;
  journal: RenamedEntry[];
}): Promise<void> {
  await rewriteJsonConfig({
    absPath: path.join(params.packageRoot, GMAIL_CONFIG_REL),
    configRelForError: GMAIL_CONFIG_REL,
    packageRoot: params.packageRoot,
    journal: params.journal,
    mutate: mutateGmailConfig,
    validate: (parsed) => {
      parseGmailConnectorConfig(parsed);
    },
  });
  await rewriteJsonConfig({
    absPath: path.join(params.packageRoot, DRIVE_CONFIG_REL),
    configRelForError: DRIVE_CONFIG_REL,
    packageRoot: params.packageRoot,
    journal: params.journal,
    mutate: mutateDriveConfig,
  });
}
