/**
 * The machine-level secret store: one 0600 JSON file per machine, outside every
 * box tree (`docs/plans/secret-custody.md`, Track 2).
 *
 * Shape: `secrets` maps a flat name to one entry (the single copy of a value,
 * plus its metadata); `grants` maps a BOX SLUG to the names that box may
 * resolve, each carrying its access level. Adding a secret and granting it are
 * separate acts — adding makes a name *grantable* machine-wide, granting is the
 * per-box opt-in. Nothing here reads a box tree.
 *
 * File discipline follows the codebase's other credential stores
 * (`webapp/local-users.ts`, `connectors/google-token-store.ts`): every mutation
 * runs under a cross-process `file-lock.ts` guard and lands through
 * `writeFileAtomic` with `mode: 0o600`. Reads are lock-free — a stale-by-one
 * read is harmless, and the resolver's hot path must not take a lock.
 *
 * Fail-closed on load: a missing file is an EMPTY store (the first-run case,
 * not an error), but a file that exists and does not parse or does not validate
 * is the `store-unreadable` condition — the whole machine reads as "no grants"
 * rather than the store silently degrading to a partial parse.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { withFileLock } from "../../lib/file-lock.js";
import { err, ok, type Result } from "../../lib/result.js";
import { SecretStoreAccessError } from "./errors.js";

/** How long a mutation waits for a contending writer before giving up. */
const LOCK_WAIT_MS = 10_000;

/** `agent` includes server access; `server` is the strict default. */
export const secretAccessLevelSchema = z.enum(["server", "agent"]);
export type SecretAccessLevel = z.infer<typeof secretAccessLevelSchema>;

const verifiedSchema = z.object({
  status: z.enum(["ok", "failed", "unchecked"]),
  at: z.string(),
  reason: z.string().optional(),
});

const secretEntrySchema = z.object({
  /** Absent for a DECLARED slot whose value has not been supplied yet. */
  value: z.string().optional(),
  note: z.string().optional(),
  updated: z.string(),
  /** Probe result. The probe machinery itself is a later chunk; the field is
   *  read here (a `failed` status makes a successful resolve `suspect`). */
  verified: verifiedSchema.optional(),
  formatHint: z.string().optional(),
  /** Box slug → last resolve time, summarized from the access log (hourly). */
  lastUsed: z.record(z.string(), z.string()).optional(),
  /** Set for structurally per-box secrets (a Telegram bot token binds to one
   *  webhook URL), together with `shareable: false`. */
  owningBox: z.string().optional(),
  shareable: z.boolean().optional(),
});
export type SecretEntry = z.infer<typeof secretEntrySchema>;

const secretStoreSchema = z.object({
  secrets: z.record(z.string(), secretEntrySchema),
  grants: z.record(z.string(), z.record(z.string(), secretAccessLevelSchema)),
});
export type SecretStoreData = z.infer<typeof secretStoreSchema>;

/** The empty store — what a machine with no secrets file has. */
export function emptySecretStore(): SecretStoreData {
  return { secrets: {}, grants: {} };
}

/**
 * Where the store lives. `CB_SECRETS_FILE` overrides (tests and any operator
 * running a second machine profile); the default joins the existing
 * machine-level credential neighbourhood rather than inventing a location class.
 */
export function secretsFilePath(): string {
  const override = process.env.CB_SECRETS_FILE;
  if (override !== undefined && override !== "") return override;
  return path.join(os.homedir(), ".config", "cb", "secrets.json");
}

/** The access log's directory: a `secrets-log/` sibling of the store file. */
export function secretsLogDir(): string {
  const file = secretsFilePath();
  return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-log`);
}

function lockPath(): string {
  return `${secretsFilePath()}.lock`;
}

/**
 * Read the store. A missing file is `ok(emptyStore)`; anything else that
 * prevents a valid read — an IO error, malformed JSON, a hand-edit that fails
 * the schema — is a failure carrying a one-line detail for the refusal message.
 */
export async function loadSecretStore(): Promise<Result<SecretStoreData, string>> {
  const file = secretsFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return ok(emptySecretStore());
    return err(errorMessage(e));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return err(`invalid JSON (${errorMessage(e)})`);
  }
  const parsed = secretStoreSchema.safeParse(json);
  if (!parsed.success) {
    return err(`does not match the store schema (${parsed.error.issues[0]?.message ?? "unknown issue"})`);
  }
  return ok(parsed.data);
}

/** Load, or throw the lifecycle error a mutating caller reports to its operator. */
async function loadForMutation(): Promise<SecretStoreData> {
  const loaded = await loadSecretStore();
  if (loaded.ok) return loaded.value;
  throw new SecretStoreAccessError({ storePath: secretsFilePath(), detail: loaded.error, refusingWrite: true });
}

/** Serialize and replace the store file, 0600, atomically. */
async function writeSecretStore(store: SecretStoreData): Promise<void> {
  const validated = secretStoreSchema.parse(store);
  await writeFileAtomic(secretsFilePath(), {
    content: `${JSON.stringify(validated, null, 2)}\n`,
    mode: 0o600,
  });
}

/**
 * Read-modify-write the store under the cross-process lock. `mutate` receives
 * the freshly-read store and mutates it in place; its return value is passed
 * back to the caller, and the mutated store is always written. A caller that
 * may not need to write at all (the hourly `lastUsed` stamp) decides that from
 * a lock-free `loadSecretStore` first, so the common path never takes the lock.
 */
export async function mutateSecretStore<T>(
  opts: { purpose: string },
  mutate: (store: SecretStoreData) => Promise<T> | T,
): Promise<T> {
  return withFileLock(
    { lockPath: lockPath(), metadata: { purpose: `secrets-${opts.purpose}` }, waitMs: LOCK_WAIT_MS },
    async () => {
      const store = await loadForMutation();
      const result = await mutate(store);
      await writeSecretStore(store);
      return result;
    },
  );
}
