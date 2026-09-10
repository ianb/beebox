/** Host invariants for the canonical interface cards. */
import { systemCardTemplate } from "../schemas/system-card-templates.js";

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import { isTrashedCard } from "../lib/paths.js";
import { SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, isSystemCardMigration, isSystemCardType, systemCardLocationError, type SystemCardMigration, type SystemCardType } from "../shared/system-card-paths.js";
import { DashboardSchema } from "../schemas/dashboard.js";
import { SettingsSchema } from "../schemas/settings.js";
import { BrowseSchema } from "../schemas/browse.js";
import { QuestionsSchema } from "../schemas/questions.js";
import { LandmarksSchema } from "../schemas/landmarks.js";
import { HistorySchema } from "../schemas/history.js";
import { InventorySchema } from "../schemas/inventory.js";
import { AdminSchema } from "../schemas/admin.js";
import { parseCardText, typeFromFilename } from "./card-io.js";
import { glob } from "glob";
import { MANIFEST_PATH } from "./migrations.js";

export class SystemCardInvariantError extends Error {
  constructor(problems: string[], migration: SystemCardMigration) {
    super(`Cannot complete ${migration}. Install or repair the canonical cards first:\n${problems.join("\n")}`);
    this.name = "SystemCardInvariantError";
  }
}

const schemas = new Map([DashboardSchema, SettingsSchema, BrowseSchema, QuestionsSchema, LandmarksSchema, HistorySchema, InventorySchema, AdminSchema].map((schema) => [schema.type, schema]));

async function readOptional(file: string): Promise<string | null> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}

function enrolledMigrations(text: string | null): Set<SystemCardMigration> {
  const result = new Set<SystemCardMigration>();
  if (text === null) return result;
  for (const line of text.split("\n").filter((candidate) => candidate.trim() !== "")) {
    const entry: unknown = JSON.parse(line);
    if (isRecord(entry) && typeof entry["name"] === "string" && isSystemCardMigration(entry["name"]) && typeof entry["applied-at"] === "string") result.add(entry["name"]);
  }
  return result;
}

function cohortPaths(migration: SystemCardMigration): string[] {
  return SYSTEM_CARD_COHORTS[migration].map((type) => SYSTEM_CARD_PATHS[type]);
}

function repairMigrationForPath(relativePath: string): SystemCardMigration {
  return cohortPaths(SYSTEM_CARD_MIGRATION).includes(relativePath) ? SYSTEM_CARD_MIGRATION : REMAINING_SYSTEM_CARD_MIGRATION;
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
  validateTypes: Set<SystemCardType>;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const required of input.required) {
    if (!input.paths.includes(required)) errors.push(`Required system card missing from ${input.context}: ${required}. Restore it from Git or run the declared ${repairMigrationForPath(required)} migration.`);
  }
  for (const relativePath of input.paths) {
    const type = typeFromFilename(relativePath);
    if (type === undefined || !isSystemCardType(type) || !input.validateTypes.has(type)) continue;
    const content = await input.read(relativePath);
    if (content === null) { errors.push(`System card disappeared during validation: ${relativePath}`); continue; }
    const error = contentError(relativePath, content);
    if (error !== null) errors.push(error);
  }
  return errors;
}

/** Full validation uses filesystem data; bootstrap may demand the final set explicitly. */
export async function checkSystemCards(boxRoot: string, requireCohort?: SystemCardMigration): Promise<string[]> {
  const enrolled = requireCohort === undefined
    ? enrolledMigrations(await readOptional(path.join(boxRoot, MANIFEST_PATH)))
    : new Set<SystemCardMigration>([requireCohort]);
  const required = new Set([...enrolled].flatMap(cohortPaths));
  const validateTypes = new Set(requireCohort === undefined ? Object.keys(SYSTEM_CARD_PATHS).filter(isSystemCardType) : SYSTEM_CARD_COHORTS[requireCohort]);
  return checkWorkingState({ boxRoot, required, validateTypes });
}

async function checkWorkingState(input: { boxRoot: string; required: Set<string>; validateTypes: Set<SystemCardType> }): Promise<string[]> {
  const paths = (await glob("**/*.card", { cwd: input.boxRoot, nodir: true, ignore: ["node_modules/**", ".git/**", ".beebox/**"] })).filter((file) => !isTrashedCard(file));
  return checkState({ paths, read: (file) => readOptional(path.join(input.boxRoot, file)), required: input.required, context: "working tree", validateTypes: input.validateTypes });
}

/** The index and HEAD alone decide enrollment and presence; working files cannot mask deletions. */
export async function checkStagedSystemCards(boxRoot: string): Promise<string[]> {
  const git = simpleGit(boxRoot);
  const paths = (await git.raw(["ls-files", "-z"])).split("\0").filter((file) => file !== "" && !isTrashedCard(file));
  const hasHead = await git.raw(["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
  const headPaths = hasHead ? (await git.raw(["ls-tree", "-r", "--name-only", "-z", "HEAD"])).split("\0").filter(Boolean) : [];
  const indexManifest = paths.includes(MANIFEST_PATH) ? await git.show([`:${MANIFEST_PATH}`]) : null;
  const headManifest = headPaths.includes(MANIFEST_PATH) ? await git.show([`HEAD:${MANIFEST_PATH}`]) : null;
  const enrolled = new Set([...enrolledMigrations(indexManifest), ...enrolledMigrations(headManifest)]);
  const required = new Set([...enrolled].flatMap(cohortPaths));
  for (const file of Object.values(SYSTEM_CARD_PATHS)) if (headPaths.includes(file)) required.add(file);
  return checkState({ paths, read: (file) => git.show([`:${file}`]), required, context: "proposed commit", validateTypes: new Set(Object.keys(SYSTEM_CARD_PATHS).filter(isSystemCardType)) });
}

/** Missing-only bootstrap. Conflicts are never overwritten, including copies elsewhere. */
export async function seedSystemCards(boxRoot: string, migration: SystemCardMigration): Promise<void> {
  const conflicts = await checkWorkingState({ boxRoot, required: new Set(), validateTypes: new Set(SYSTEM_CARD_COHORTS[migration]) });
  if (conflicts.length > 0) throw new SystemCardInvariantError(conflicts, migration);
  for (const type of SYSTEM_CARD_COHORTS[migration]) {
    const file = path.join(boxRoot, SYSTEM_CARD_PATHS[type]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, systemCardTemplate(type), { flag: "wx" }); }
    catch (error) { if (errnoCode(error) !== "EEXIST") throw error; }
  }
  await assertSystemCardsComplete(boxRoot, migration);
}

export async function assertSystemCardsComplete(boxRoot: string, migration: SystemCardMigration): Promise<void> {
  const errors = await checkSystemCards(boxRoot, migration);
  if (errors.length > 0) throw new SystemCardInvariantError(errors, migration);
}
