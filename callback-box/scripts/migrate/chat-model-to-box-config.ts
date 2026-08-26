#!/usr/bin/env tsx

/**
 * `chat-model-to-box-config` — fold the legacy box-wide chat model pointer into
 * the box's model policy.
 *
 * `.callback-box/chat-model.json` was the model a chat inherited when it had no
 * id of its own yet. That is not a marginal path: a client that does not coin
 * an id — an older build, the iOS app, and **every chat on a Codex box** — took
 * it, so on those boxes the file was the model every conversation started on.
 *
 * The box model policy (`agentModel` in `config/box.json`) replaces it, and is
 * read by chat and the reactor alike. This migration moves the value across so
 * a box that had picked a model keeps starting chats on it, then deletes the
 * file nothing reads any more.
 *
 * Idempotent by construction: after one run the file is gone, and a box that
 * already has an `agentModel` keeps it rather than being overwritten by a
 * staler pointer. A box that never had the file is untouched.
 *
 * Usage (invoked by `cb migrate`):
 *   pnpm exec tsx scripts/migrate/chat-model-to-box-config.ts <boxRoot> --apply
 */

import * as path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../../src/lib/atomic-write.js";
import { isRecord } from "../../src/lib/is-record.js";
import { errnoCode } from "../../src/lib/error-guards.js";
import { normalizeModelId } from "../../src/shared/model-ids.js";
import { modelTier } from "../../src/shared/agent-models.js";

const LEGACY_FILE = ".callback-box/chat-model.json";
const CONFIG_FILE = "config/box.json";

/** A file this migration must read but could not. */
class UnreadableFileError extends Error {
  constructor(readonly filePath: string, cause: unknown) {
    super("Migration input file could not be read", { cause });
    this.name = "UnreadableFileError";
  }
}

/** Parse a JSON file, or null when it is absent. Unreadable is an error. */
async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw new UnreadableFileError(filePath, e);
  }
}

async function main(): Promise<number> {
  const target = process.argv[2];
  if (target === undefined || target === "") {
    process.stderr.write("usage: chat-model-to-box-config <boxRoot> [--apply]\n");
    return 1;
  }
  const apply = process.argv.includes("--apply");
  const boxRoot = path.resolve(target);
  const legacyPath = path.join(boxRoot, LEGACY_FILE);
  const configPath = path.join(boxRoot, CONFIG_FILE);

  const legacy = await readJson(legacyPath);
  if (legacy === null) {
    process.stdout.write("[chat-model-to-box-config] no legacy chat-model.json — nothing to do\n");
    return 0;
  }

  const model = isRecord(legacy) && typeof legacy.model === "string" ? normalizeModelId(legacy.model) : null;
  const config = await readJson(configPath);
  const fields = isRecord(config) ? config : {};
  const alreadyPinned = typeof fields.agentModel === "string";

  // A model no engine offers is not worth carrying forward — it would be
  // rejected on every read. Say so rather than migrating a value that cannot work.
  if (model !== null && modelTier(model) === null) {
    process.stdout.write(`[chat-model-to-box-config] legacy model ${model} is unknown to every engine — dropping it\n`);
  }

  const carry = model !== null && modelTier(model) !== null && !alreadyPinned;
  if (!apply) {
    process.stdout.write(
      carry
        ? `[chat-model-to-box-config] would set agentModel=${model} and delete ${LEGACY_FILE}\n`
        : `[chat-model-to-box-config] would delete ${LEGACY_FILE} (${alreadyPinned ? "box already pins a model" : "nothing to carry"})\n`,
    );
    return 0;
  }

  if (carry) {
    await writeFileAtomic(configPath, { content: `${JSON.stringify({ ...fields, agentModel: model }, null, 2)}\n` });
    process.stdout.write(`[chat-model-to-box-config] set agentModel=${model}\n`);
  }
  await rm(legacyPath, { force: true });
  process.stdout.write(`[chat-model-to-box-config] removed ${LEGACY_FILE}\n`);
  return 0;
}

process.exit(await main());
