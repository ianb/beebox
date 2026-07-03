/**
 * Central schema registration with cardworks.
 *
 * All card schemas are registered here and exported for use
 * by the CardLoader factory. Box-local schemas from config/schemas/
 * are loaded dynamically at runtime.
 */

import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { type CardSchema } from "../cards/index.js";
import { MemoSchema } from "./memo.js";
import { QuestionSchema } from "./question.js";
import { FeedbackSchema } from "./feedback.js";
import { ProcedureSchema } from "./procedure.js";
import { ProcedureRunSchema } from "./procedure-run.js";
import { ImageSchema } from "./image.js";
import { AudioSchema } from "./audio.js";
import { FileSchema } from "./file.js";
import { CaptureSessionSchema } from "./capture-session.js";
import { RecordSchema } from "./record.js";
import { RecipeSchema } from "./recipe.js";
import { EmailThreadSchema } from "./email-thread.js";
import { EmailMessageSchema } from "./email-message.js";
import { EmailOutboundSchema } from "./email-outbound.js";
import { IntakeJobSchema } from "./intake-job.js";
import { GuideSchema } from "./guide.js";
import { ScheduledScriptSchema } from "./scheduled-script.js";
import { TelegramMessageSchema } from "./telegram-message.js";
import { ChatThreadSchema } from "./chat-thread.js";
import { ChatJobSchema } from "./chat-job.js";
import { ContainsBackfillJobSchema } from "./contains-backfill-job.js";
import { PersonalitySchema } from "./personality.js";
import { QuestionFollowupJobSchema } from "./question-followup-job.js";
import { TodoListSchema } from "./todo-list.js";
import { BriefingSchema } from "./briefing.js";
import { PersonSchema } from "./person.js";
import { PlaceSchema } from "./place.js";
import { GsheetSchema } from "./gsheet.js";
import { DocSchema } from "./doc.js";
import { GdocSchema } from "./gdoc.js";
import { CommentarySchema } from "./commentary.js";
import { WebpageSchema } from "./webpage.js";
import { ExtfileSchema } from "./extfile.js";
import { LandmarkSchema } from "./landmark.js";
import { NavSchema } from "./nav.js";
import { ViewSchema } from "./view.js";
import { FigureSchema } from "./figure.js";
import { ConceptMapSchema } from "./concept-map.js";
import { CourseSchema } from "./course.js";
import { ExpositionPlanSchema } from "./exposition-plan.js";
import { LessonPlanSchema } from "./lesson-plan.js";
import { ProgressSchema } from "./progress.js";
import { registerBoxTemplate, unregisterBoxTemplates, type TemplateDefinition } from "./templates.js";

/**
 * Markdown-frontmatter card schemas. Loaded into a Map<type, CardSchema> by
 * createCardSchemaMap below.
 *
 * Order is presentational: the agent guide's CARD_TYPES catalogue renders
 * groups (by each schema's `category`) in this order, so within each category
 * the everyday, most-reached-for types come first.
 */
export const cardSchemas: CardSchema[] = [
  // authored — everyday recording types first
  DocSchema,
  RecordSchema,
  MemoSchema,
  PersonSchema,
  PlaceSchema,
  TodoListSchema,
  QuestionSchema,
  RecipeSchema,
  CommentarySchema,
  BriefingSchema,
  GuideSchema,
  PersonalitySchema,
  LandmarkSchema,
  NavSchema,
  ViewSchema,
  ProcedureSchema,
  ScheduledScriptSchema,
  EmailOutboundSchema,
  // authored — the course family
  CourseSchema,
  ConceptMapSchema,
  ExpositionPlanSchema,
  LessonPlanSchema,
  ProgressSchema,
  FigureSchema,
  // synced & captured
  EmailThreadSchema,
  EmailMessageSchema,
  TelegramMessageSchema,
  GdocSchema,
  GsheetSchema,
  WebpageSchema,
  ExtfileSchema,
  CaptureSessionSchema,
  ImageSchema,
  AudioSchema,
  FileSchema,
  // system bookkeeping
  IntakeJobSchema,
  ChatJobSchema,
  ContainsBackfillJobSchema,
  QuestionFollowupJobSchema,
  ProcedureRunSchema,
  ChatThreadSchema,
  FeedbackSchema,
];

/**
 * Specifiers a box-local schema file may import from callback-box's tree:
 * - `callback-box/cards` — the public card-primitive surface (cardSchema,
 *   body, splitCardContent, …); the specifier new box schemas should use.
 * - `zod` — peer dependency every schema needs.
 * - `yaml` — frontmatter card templates `stringify` their fields with it (the
 *   scaffolding in box-templates.ts shows exactly this).
 */
const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml"]);

/**
 * Virtual parent URL at callback-box's package root (NOT inside
 * node_modules). Rewriting a box schema's parentURL to this makes Node
 * resolve bare deps (`zod`, `yaml`) from callback-box's node_modules
 * AND self-references (`callback-box/cards`) via callback-box's own
 * `exports` map. Pointing it *inside* node_modules would break the
 * self-reference: Node's LOOKUP_PACKAGE_SCOPE returns null at a
 * node_modules boundary, so the package's own exports never match. The
 * file need not exist — only the directory's package.json scope is read.
 */
const CB_VIRTUAL_PARENT = pathToFileURL(join(PACKAGE_ROOT, "_virtual.js")).href;

/**
 * Register module resolution hooks so that box-local schema files
 * (under config/schemas/) can import `callback-box/cards`, `zod`, and
 * `yaml` even though none of those resolve from the box's own
 * node_modules.
 *
 * Uses Node's synchronous registerHooks API which chains correctly
 * with tsx's async loader hooks.
 */
let hooksRegistered = false;
function ensureResolveHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  registerHooks({
    // eslint-disable-next-line max-params -- Node's registerHooks API requires 3 params
    resolve(specifier, context, nextResolve) {
      // Check if a box schema file is importing a known package
      const bare = specifier.split("/")[0] ?? "";
      if (
        SCHEMA_DEPS.has(bare) &&
        context.parentURL?.includes("/config/schemas/")
      ) {
        // Resolve as if imported from callback-box's node_modules
        return nextResolve(specifier, {
          ...context,
          parentURL: CB_VIRTUAL_PARENT,
        });
      }
      return nextResolve(specifier, context);
    },
  });
}

/**
 * Ensure config/schemas/ has a package.json with "type": "module"
 * so Node treats .ts files as ESM (needed for registerHooks to apply).
 */
async function ensureEsmPackageJson(schemasDir: string): Promise<void> {
  const pkgJsonPath = join(schemasDir, "package.json");
  try {
    const { stat } = await import("node:fs/promises");
    await stat(pkgJsonPath);
  } catch (_e) {
    // package.json is absent (stat throws ENOENT) — that's the expected
    // trigger to create it; the error carries no other actionable info.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(pkgJsonPath, '{"type":"module"}\n');
  }
}

/**
 * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
 * files default-export a frontmatter `cardSchema()`.
 */
export interface BoxSchemas {
  /** Frontmatter card schemas (CardSchema, keyed by `.type`). */
  cardSchemas: CardSchema[];
}

/**
 * Per-file load bookkeeping, keyed by absolute path within a boxRoot's record
 * map. The `hash` lets a rebuild detect that an existing file changed (and so
 * must be re-imported under a fresh `?v=` URL — Node permanently caches
 * `import()` by URL); `card`/`template` are the last *good* load, reused both
 * for unchanged files (no re-import) and as keep-last-good when a re-import
 * fails (a broken mid-edit save never blanks a working type).
 */
interface SchemaFileRecord {
  hash: string;
  card: CardSchema;
  template: TemplateDefinition | undefined;
}

/**
 * Two-layer state:
 * - `boxSchemaCache`: the assembled snapshot the ~24 callers read. Dropped by
 *   `invalidateBoxSchemas` (e.g. on a watcher event); rebuilt on next call.
 * - `boxFileRecords`: persistent per-file bookkeeping that survives
 *   invalidation. Clearing it would make every edited file look never-seen and
 *   re-import the bare (stale) URL — so invalidation MUST NOT touch it.
 * - `inFlightRebuild`: single-flight, so N concurrent callers after an
 *   invalidation share one rebuild instead of racing N imports.
 */
const boxSchemaCache = new Map<string, BoxSchemas>();
const boxFileRecords = new Map<string, Map<string, SchemaFileRecord>>();
const inFlightRebuild = new Map<string, Promise<BoxSchemas>>();
/**
 * Bumped on every invalidation. A rebuild captures the epoch before it starts
 * and only caches its result if the epoch is unchanged when it finishes —
 * otherwise an edit that landed mid-rebuild would be lost (the rebuild would
 * cache a snapshot predating it, and with no later event hot-reload stays
 * stale). On a mismatch the rebuild simply runs again.
 */
const dirtyEpoch = new Map<string, number>();

/**
 * Drop a box's assembled schema snapshot so the next `loadBoxSchemas` rebuilds
 * it from disk. Deliberately preserves `boxFileRecords` (the hash/last-good
 * state the cache-bust relies on). Call this when `config/schemas/` changes.
 */
export function invalidateBoxSchemas(boxRoot: string): void {
  boxSchemaCache.delete(boxRoot);
  dirtyEpoch.set(boxRoot, (dirtyEpoch.get(boxRoot) ?? 0) + 1);
}

/**
 * Load box-local schemas from config/schemas/*.ts.
 *
 * Each file should default-export a frontmatter `cardSchema()`. Optionally it
 * can also export a `template` (TemplateDefinition) for `cb create`.
 *
 * Errors in individual files are logged as warnings, not fatal.
 */
export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
  const cached = boxSchemaCache.get(boxRoot);
  if (cached) return cached;

  const pending = inFlightRebuild.get(boxRoot);
  if (pending) return pending;

  const promise = rebuildUntilStable(boxRoot);
  inFlightRebuild.set(boxRoot, promise);
  try {
    return await promise;
  } finally {
    inFlightRebuild.delete(boxRoot);
  }
}

/**
 * Rebuild, re-running if an invalidation landed mid-rebuild (see `dirtyEpoch`).
 * The epoch check and the cache write are synchronous (no await between them),
 * so an invalidation can't interleave to leave a stale snapshot cached.
 */
async function rebuildUntilStable(boxRoot: string): Promise<BoxSchemas> {
  for (;;) {
    const epoch = dirtyEpoch.get(boxRoot) ?? 0;
    const result = await rebuildBoxSchemas(boxRoot);
    if ((dirtyEpoch.get(boxRoot) ?? 0) === epoch) {
      boxSchemaCache.set(boxRoot, result);
      return result;
    }
  }
}

async function rebuildBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
  const empty: BoxSchemas = { cardSchemas: [] };

  // Drop this box's prior template registrations up front; the file scan below
  // re-registers whatever still exists. Doing it here (not after the scan) means
  // a removed last schema / deleted dir also drops the box's templates, not just
  // its card types.
  unregisterBoxTemplates(boxRoot);

  const schemasDir = join(boxRoot, "config/schemas");
  let files: string[];
  try {
    files = await readdir(schemasDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
    }
    boxFileRecords.delete(boxRoot);
    return empty;
  }

  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
  if (tsFiles.length === 0) {
    boxFileRecords.delete(boxRoot);
    return empty;
  }

  // Ensure package.json with "type": "module" so .ts files load as ESM,
  // and register resolve hooks so bare specifiers (callback-box/cards, zod,
  // yaml) resolve from callback-box's node_modules.
  await ensureEsmPackageJson(schemasDir);
  ensureResolveHooks();

  const records = boxFileRecords.get(boxRoot) ?? new Map<string, SchemaFileRecord>();
  const seen = new Set<string>();
  const loadedCard: CardSchema[] = [];

  for (const file of tsFiles) {
    const filePath = join(schemasDir, file);
    seen.add(filePath);
    const card = await loadOneSchemaFile({ filePath, file, boxRoot, records });
    if (card) loadedCard.push(card);
  }

  // Files that vanished since the last rebuild drop their type (and bookkeeping).
  for (const key of [...records.keys()]) {
    if (!seen.has(key)) records.delete(key);
  }
  boxFileRecords.set(boxRoot, records);

  return { cardSchemas: loadedCard };
}

interface LoadOneOptions {
  filePath: string;
  file: string;
  boxRoot: string;
  records: Map<string, SchemaFileRecord>;
}

/**
 * Load (or reuse) a single box schema file, maintaining its `SchemaFileRecord`.
 * Returns the CardSchema to include, or undefined to contribute nothing. Any
 * per-file failure (unreadable, throwing import, or no valid default export)
 * falls back to the file's last-good card when one exists — keep-last-good — so
 * an incomplete save never regresses a working type to "unknown".
 */
async function loadOneSchemaFile({ filePath, file, boxRoot, records }: LoadOneOptions): Promise<CardSchema | undefined> {
  const prior = records.get(filePath);

  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    if (prior) return reuse(prior, boxRoot);
    console.warn(`Warning: failed to read box schema ${file}: ${(err as Error).message}`);
    return undefined;
  }

  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  if (prior && prior.hash === hash) return reuse(prior, boxRoot);

  try {
    // Cache-bust by content hash: Node permanently caches `import()` by URL, so
    // an edited file needs a fresh URL to be re-read. Identical content yields
    // the same hash → same URL → the existing module is reused (no leak).
    const mod = await import(pathToFileURL(filePath).href + `?v=${hash}`);
    const def: unknown = mod.default;
    if (!isCardSchema(def)) {
      console.warn(`Warning: ${file} does not export a default cardSchema(), skipping`);
      return prior ? reuse(prior, boxRoot) : undefined;
    }
    const template = mod.template as TemplateDefinition | undefined;
    if (template) registerBoxTemplate(template, boxRoot);
    records.set(filePath, { hash, card: def, template });
    return def;
  } catch (err) {
    console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
    // Keep `prior` (its old hash) so a later fixed save is detected and retried.
    return prior ? reuse(prior, boxRoot) : undefined;
  }
}

/** Re-include a file's last-good load, re-registering its template for this box. */
function reuse(record: SchemaFileRecord, boxRoot: string): CardSchema {
  if (record.template) registerBoxTemplate(record.template, boxRoot);
  return record.card;
}

function isCardSchema(def: unknown): def is CardSchema {
  return (
    typeof def === "object"
    && def !== null
    && typeof (def as CardSchema).type === "string"
    && "frontmatterSchema" in def
  );
}

/**
 * Get the list of known card types (built-in frontmatter schemas).
 */
export function getCardTypes(): string[] {
  return cardSchemas.map(s => s.type);
}

/**
 * Get the card types that belong in content search indexes — every type
 * whose schema doesn't set `searchable: false`. Includes box-local schemas
 * when a boxRoot is given (they default to searchable).
 */
export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
  return allCardSchemas.filter(s => s.searchable).map(s => s.type);
}

/**
 * Check if a card type is known.
 */
export function isKnownCardType(type: string): boolean {
  return cardSchemas.some(s => s.type === type);
}

/**
 * Build a Map<type, CardSchema> for the markdown-frontmatter loader path.
 *
 * When boxRoot is given, box-local frontmatter schemas (from
 * config/schemas/*.ts) are merged in on top of the built-in ones, so box
 * card types parse and validate as first-class. A box schema whose type
 * collides with a built-in wins (last write) — boxes can override.
 */
export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
  const map = new Map<string, CardSchema>();
  for (const schema of cardSchemas) {
    map.set(schema.type, schema);
  }
  if (boxRoot) {
    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
    for (const schema of boxCardSchemas) {
      map.set(schema.type, schema);
    }
  }
  return map;
}
