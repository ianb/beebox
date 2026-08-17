/**
 * Registering a box with the hub — the write side of `hub.json`.
 *
 * `hub.json` decides which URL prefix routes to which box, and until this
 * module existed the only way to add an entry was to hand-edit the live file
 * on the server (`deploy/add-box.sh` never touched it; `deploy/README.md`
 * documented that as a known gap). Hand-editing a fail-closed config that the
 * hub reads at startup is the wrong shape: a typo is discovered by the hub
 * refusing to boot, after the operator has already replaced the file.
 *
 * So the edit is planned, validated, and only then written:
 *
 *   1. `planAddBoxToHubConfig` reads the current file and builds the config
 *      the file *would* hold.
 *   2. That candidate goes through `parseHubConfig` — the exact validator the
 *      hub applies at startup — so a reserved slug, a malformed slug, or a
 *      second slug resolving to a box another slug already claims fails here,
 *      with nothing on disk changed.
 *   3. `applyAddBoxPlan` writes it atomically (`writeFileAtomic`), so the
 *      live file is either the old one or the new one, never a partial.
 *
 * The plan is also what `--dry-run` prints, which makes the whole operation
 * inspectable against the real production config without mutating it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "../lib/is-record.js";
import { errnoCode } from "../lib/error-guards.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { canonicalBoxKey, parseHubConfig } from "./hub-config.js";

/**
 * A proposed edit could not be made. Distinct from `HubConfigError` (which
 * means the config itself is invalid): this is "the file is unreadable" or
 * "what you asked for conflicts with what is already there".
 */
export class HubConfigEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConfigEditError";
  }
}

export interface AddBoxToHubPlan {
  /** `"unchanged"` when the slug already points at this same box — re-running
   *  a provisioning script must be a no-op, not a conflict. */
  action: "added" | "unchanged";
  slug: string;
  /** Absolute box path as it would be written into the config. */
  boxPath: string;
  configPath: string;
  /** Exact bytes the config file should hold afterwards. Equal to the current
   *  contents when `action` is `"unchanged"`. */
  nextText: string;
}

/** Read the config file, failing with guidance rather than a bare errno. */
async function readConfigText(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      throw new HubConfigEditError(
        `No hub config at ${configPath}. This command registers a box with an existing hub; ` +
          "it deliberately will not invent one, because a config created from scratch would " +
          "silently drop the port/host/lazy settings the running hub depends on. Create the " +
          "file first — see docs/adding-a-box.md — or pass --config to point at the real one.",
      );
    }
    throw new HubConfigEditError(
      `Cannot read hub config at ${configPath}: ` + (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Build (but do not write) the `hub.json` that registers `slug` → `boxPath`.
 *
 * Throws `HubConfigEditError` if the file is unreadable or the slug is already
 * taken by a different box, and `HubConfigError` if the resulting config is
 * one the hub would refuse to load.
 */
export async function planAddBoxToHubConfig(opts: {
  configPath: string;
  slug: string;
  boxPath: string;
}): Promise<AddBoxToHubPlan> {
  const { configPath, slug } = opts;
  const boxPath = path.resolve(opts.boxPath);
  const currentText = await readConfigText(configPath);

  let current: unknown;
  try {
    current = JSON.parse(currentText);
  } catch (e) {
    throw new HubConfigEditError(
      `Hub config at ${configPath} is not valid JSON, so it cannot be edited safely: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  if (!isRecord(current) || !isRecord(current.boxes)) {
    throw new HubConfigEditError(
      `Hub config at ${configPath} does not have the expected shape: ` +
        'it must be an object with a "boxes" object.',
    );
  }

  const existing = current.boxes[slug];
  if (existing !== undefined) {
    if (!isRecord(existing) || typeof existing.path !== "string") {
      throw new HubConfigEditError(
        `Hub config at ${configPath}: slug "${slug}" is already present but its entry has no "path" string. ` +
          "Fix that entry by hand before registering the box.",
      );
    }
    const existingPath = path.resolve(path.dirname(path.resolve(configPath)), existing.path);
    const [existingKey, requestedKey] = await Promise.all([
      canonicalBoxKey(existingPath),
      canonicalBoxKey(boxPath),
    ]);
    if (existingKey === requestedKey) {
      return { action: "unchanged", slug, boxPath: existingPath, configPath, nextText: currentText };
    }
    throw new HubConfigEditError(
      `Hub config at ${configPath}: slug "${slug}" already routes to ${existingPath}, not ${boxPath}. ` +
        "Pick a different slug, or remove the existing entry by hand if the box really moved — " +
        "repointing a live slug is a decision this command will not make for you.",
    );
  }

  const next = { ...current, boxes: { ...current.boxes, [slug]: { path: boxPath } } };
  // The candidate goes through the hub's own validator BEFORE anything is
  // written: reserved slug, malformed slug, and "two slugs, one events.db"
  // all fail here with the live file untouched.
  await parseHubConfig(next, configPath);

  return { action: "added", slug, boxPath, configPath, nextText: JSON.stringify(next, null, 2) + "\n" };
}

/** Write a plan produced by `planAddBoxToHubConfig`. A no-op for `"unchanged"`. */
export async function applyAddBoxPlan(plan: AddBoxToHubPlan): Promise<void> {
  if (plan.action === "unchanged") return;
  await writeFileAtomic(plan.configPath, { content: plan.nextText });
}

/** One line describing what a plan does (or already found done), for CLI output. */
export function describeAddBoxPlan(plan: AddBoxToHubPlan): string {
  if (plan.action === "unchanged") {
    return `Already registered: "${plan.slug}" -> ${plan.boxPath} (${plan.configPath} unchanged)`;
  }
  return `Register "${plan.slug}" -> ${plan.boxPath} in ${plan.configPath}`;
}
