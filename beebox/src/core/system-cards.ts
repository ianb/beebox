/** Host invariants for the three canonical interface cards. */
import { systemCardTemplate } from "../schemas/system-card-templates.js";

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import { isTrashedCard } from "../lib/paths.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, isSystemCardType, systemCardLocationError } from "../shared/system-card-paths.js";
import { DashboardSchema } from "../schemas/dashboard.js";
import { SettingsSchema } from "../schemas/settings.js";
import { BrowseSchema } from "../schemas/browse.js";
import { parseCardText, typeFromFilename } from "./card-io.js";
import { glob } from "glob";
import { MANIFEST_PATH } from "./migrations.js";

export class SystemCardInvariantError extends Error {
  constructor(problems: string[]) {
    super(`Cannot complete canonical-interface-cards. Install or repair the canonical cards first:\n${problems.join("\n")}`);
    this.name = "SystemCardInvariantError";
  }
}

const schemas = new Map([DashboardSchema, SettingsSchema, BrowseSchema].map((schema) => [schema.type, schema]));

async function readOptional(file: string): Promise<string | null> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}

function enrolled(text: string | null): boolean {
  if (text === null) return false;
  return text.split("\n").filter((line) => line.trim() !== "").some((line) => {
    const entry: unknown = JSON.parse(line);
    return isRecord(entry) && entry["name"] === SYSTEM_CARD_MIGRATION && typeof entry["applied-at"] === "string";
  });
}

function contentError(relativePath: string, content: string): string | null {
  const type = typeFromFilename(relativePath);
  if (type === undefined || !isSystemCardType(type)) return null;
  const location = systemCardLocationError(type, relativePath);
  if (location !== null) return location;
  try { parseCardText(content, { source: relativePath, schemas, type }); return null; }
  catch (error) { return `Invalid required system card ${relativePath}: ${errorMessage(error)}`; }
}

async function checkState(input: {
  paths: string[];
  read: (relativePath: string) => Promise<string | null>;
  required: Set<string>;
  context: string;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const required of input.required) {
    if (!input.paths.includes(required)) errors.push(`Required system card missing from ${input.context}: ${required}. Restore it from Git or run the declared canonical-interface-cards migration.`);
  }
  for (const relativePath of input.paths) {
    const type = typeFromFilename(relativePath);
    if (type === undefined || !isSystemCardType(type)) continue;
    const content = await input.read(relativePath);
    if (content === null) { errors.push(`System card disappeared during validation: ${relativePath}`); continue; }
    const error = contentError(relativePath, content);
    if (error !== null) errors.push(error);
  }
  return errors;
}

/** Full validation uses filesystem data; bootstrap may demand the final set explicitly. */
export async function checkSystemCards(boxRoot: string, requireComplete?: boolean): Promise<string[]> {
  const required = requireComplete || enrolled(await readOptional(path.join(boxRoot, MANIFEST_PATH)))
    ? new Set<string>(Object.values(SYSTEM_CARD_PATHS)) : new Set<string>();
  return checkWorkingState(boxRoot, required);
}

async function checkWorkingState(boxRoot: string, required: Set<string>): Promise<string[]> {
  const paths = (await glob("**/*.card", { cwd: boxRoot, nodir: true, ignore: ["node_modules/**", ".git/**", ".beebox/**"] })).filter((file) => !isTrashedCard(file));
  return checkState({ paths, read: (file) => readOptional(path.join(boxRoot, file)), required, context: "working tree" });
}

/** The index and HEAD alone decide enrollment and presence; working files cannot mask deletions. */
export async function checkStagedSystemCards(boxRoot: string): Promise<string[]> {
  const git = simpleGit(boxRoot);
  const paths = (await git.raw(["ls-files", "-z"])).split("\0").filter((file) => file !== "" && !isTrashedCard(file));
  const hasHead = await git.raw(["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
  const headPaths = hasHead ? (await git.raw(["ls-tree", "-r", "--name-only", "-z", "HEAD"])).split("\0").filter(Boolean) : [];
  const indexManifest = paths.includes(MANIFEST_PATH) ? await git.show([`:${MANIFEST_PATH}`]) : null;
  const headManifest = headPaths.includes(MANIFEST_PATH) ? await git.show([`HEAD:${MANIFEST_PATH}`]) : null;
  const complete = enrolled(indexManifest) || enrolled(headManifest);
  const required = new Set(Object.values(SYSTEM_CARD_PATHS).filter((file) => complete || headPaths.includes(file)));
  return checkState({ paths, read: (file) => git.show([`:${file}`]), required, context: "proposed commit" });
}

/** Missing-only bootstrap. Conflicts are never overwritten, including copies elsewhere. */
export async function seedSystemCards(boxRoot: string): Promise<void> {
  const conflicts = await checkWorkingState(boxRoot, new Set());
  if (conflicts.length > 0) throw new SystemCardInvariantError(conflicts);
  for (const type of Object.keys(SYSTEM_CARD_PATHS)) {
    if (!isSystemCardType(type)) continue;
    const file = path.join(boxRoot, SYSTEM_CARD_PATHS[type]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, systemCardTemplate(type), { flag: "wx" }); }
    catch (error) { if (errnoCode(error) !== "EEXIST") throw error; }
  }
  await assertSystemCardsComplete(boxRoot);
}

export async function assertSystemCardsComplete(boxRoot: string): Promise<void> {
  const errors = await checkSystemCards(boxRoot, true);
  if (errors.length > 0) throw new SystemCardInvariantError(errors);
}
