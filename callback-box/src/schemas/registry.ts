/**
 * Central schema registration with cardworks.
 *
 * All card schemas are registered here and exported for use
 * by the CardLoader factory. Box-local schemas from config/schemas/
 * are loaded dynamically at runtime.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
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
import { CalendarReviewJobSchema } from "./calendar-review-job.js";
import { GuideSchema } from "./guide.js";
import { ScheduledScriptSchema } from "./scheduled-script.js";
import { TelegramMessageSchema } from "./telegram-message.js";
import { ChatThreadSchema } from "./chat-thread.js";
import { ChatJobSchema } from "./chat-job.js";
import { PersonalitySchema } from "./personality.js";
import { QuestionFollowupJobSchema } from "./question-followup-job.js";
import { TodoListSchema } from "./todo-list.js";
import { BriefingSchema } from "./briefing.js";
import { PersonSchema } from "./person.js";
import { SheetSchema } from "./sheet.js";
import { DocSchema } from "./doc.js";
import { GdocSchema } from "./gdoc.js";
import { CommentarySchema } from "./commentary.js";
import { WebpageSchema } from "./webpage.js";
import { LandmarkSchema } from "./landmark.js";
import { registerTemplate, type TemplateDefinition } from "./templates.js";

/**
 * All built-in card schemas.
 */
export const schemas: ElementSchema[] = [
  ProcedureSchema,
  ProcedureRunSchema,
  CaptureSessionSchema,
  GuideSchema,
  LandmarkSchema,
];

/**
 * Phase-2 markdown-frontmatter card schemas. Loaded into a separate
 * Map<type, CardSchema> by createCardSchemaMap below. As schemas migrate
 * from XML to frontmatter, they move from the array above to this one.
 */
export const cardSchemas: CardSchema[] = [
  RecipeSchema,
  EmailThreadSchema,
  EmailMessageSchema,
  EmailOutboundSchema,
  BriefingSchema,
  DocSchema,
  GdocSchema,
  CommentarySchema,
  WebpageSchema,
  SheetSchema,
  FileSchema,
  ImageSchema,
  AudioSchema,
  RecordSchema,
  PersonSchema,
  MemoSchema,
  TodoListSchema,
  TelegramMessageSchema,
  FeedbackSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
  ChatJobSchema,
  QuestionFollowupJobSchema,
  PersonalitySchema,
  ScheduledScriptSchema,
  QuestionSchema,
  ChatThreadSchema,
];

/** Packages that box-local schemas can import from callback-box's tree. */
const SCHEMA_DEPS = new Set(["cardworks", "zod"]);

/**
 * Virtual parent URL inside callback-box's node_modules.
 * When we rewrite parentURL to this, Node resolves bare specifiers
 * by searching callback-box's node_modules.
 */
const CB_VIRTUAL_PARENT = pathToFileURL(
  join(PACKAGE_ROOT, "node_modules", "_virtual.js")
).href;

/**
 * Register module resolution hooks so that box-local schema files
 * (under config/schemas/) can import "cardworks" and "zod" even though
 * those packages live in callback-box's node_modules, not the box's.
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
 * files may default-export either a frontmatter `cardSchema()` (the default
 * for new card types) or a legacy XML `element()` schema; we branch on the
 * discriminator (`.type` vs `.tagName`) and keep the two kinds apart so each
 * flows into the right runtime map.
 */
export interface BoxSchemas {
  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
  cardSchemas: CardSchema[];
  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
  elementSchemas: ElementSchema[];
}

/**
 * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
 * that builds a card-schema map); without this, each would re-readdir and
 * re-import. Node already permanently caches the dynamic `import()` by URL,
 * so a process never sees on-disk schema edits anyway — caching the readdir
 * + branch result alongside it changes nothing observable and avoids the
 * repeated I/O. `cb` commands are fresh processes, so edits are picked up on
 * the next invocation; long-lived dev servers already required a restart to
 * see schema changes (the import cache), and still do.
 */
const boxSchemaCache = new Map<string, BoxSchemas>();

/**
 * Load box-local schemas from config/schemas/*.ts.
 *
 * Each file should default-export either a frontmatter `cardSchema()` or a
 * legacy XML `element()` schema. Optionally it can also export a `template`
 * (TemplateDefinition) for `cb create` — registered the same way regardless
 * of schema kind.
 *
 * Errors in individual files are logged as warnings, not fatal.
 */
export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
  const cached = boxSchemaCache.get(boxRoot);
  if (cached) return cached;

  const result = await loadBoxSchemasUncached(boxRoot);
  boxSchemaCache.set(boxRoot, result);
  return result;
}

async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
  const schemasDir = join(boxRoot, "config/schemas");
  let files: string[];
  try {
    files = await readdir(schemasDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
    }
    return empty;
  }

  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
  if (tsFiles.length === 0) return empty;

  const loadedCard: CardSchema[] = [];
  const loadedElement: ElementSchema[] = [];

  // Ensure package.json with "type": "module" so .ts files load as ESM,
  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
  // from callback-box's node_modules.
  await ensureEsmPackageJson(schemasDir);
  ensureResolveHooks();

  for (const file of tsFiles) {
    try {
      const filePath = join(schemasDir, file);
      const mod = await import(pathToFileURL(filePath).href);
      const def: unknown = mod.default;

      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
      // Zod type carrying `.tagName`; check it first, because ElementSchema also
      // inherits a string `.type` from ZodType, so a `.type`-only check would
      // misclassify it. CardSchema (frontmatter) is a plain object identified by
      // its `.frontmatterSchema`.
      if (isElementSchema(def)) {
        loadedElement.push(def);
      } else if (isCardSchema(def)) {
        loadedCard.push(def);
      } else {
        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
        continue;
      }

      if (mod.template) {
        registerTemplate(mod.template as TemplateDefinition);
      }
    } catch (err) {
      console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
    }
  }

  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
}

function isElementSchema(def: unknown): def is ElementSchema {
  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
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
 * Create a SchemaRegistry populated with all known schemas.
 *
 * If boxRoot is provided, also loads box-local schemas from config/schemas/.
 */
export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
  const registry = new SchemaRegistry();
  for (const schema of schemas) {
    registry.register(schema);
  }
  if (boxRoot) {
    const { elementSchemas } = await loadBoxSchemas(boxRoot);
    for (const schema of elementSchemas) {
      registry.register(schema);
    }
  }
  return registry;
}

/**
 * Get all schemas (built-in + box-local).
 *
 * If boxRoot is provided, includes box-local schemas.
 */
export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
  if (!boxRoot) return schemas;
  const { elementSchemas } = await loadBoxSchemas(boxRoot);
  return [...schemas, ...elementSchemas];
}

/**
 * Get the list of known card types.
 */
export function getCardTypes(): string[] {
  return [
    ...schemas.map(s => s.tagName),
    ...cardSchemas.map(s => s.type),
  ];
}

/**
 * Get the card types that belong in content search indexes — every type
 * whose schema doesn't set `searchable: false`. Includes box-local schemas
 * when a boxRoot is given (they default to searchable).
 */
export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
  const elementSchemas = await getAllSchemas(boxRoot);
  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
  return [
    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
    ...allCardSchemas.filter(s => s.searchable).map(s => s.type),
  ];
}

/**
 * Check if a card type is known.
 */
export function isKnownCardType(type: string): boolean {
  return (
    schemas.some(s => s.tagName === type)
    || cardSchemas.some(s => s.type === type)
  );
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

// Re-export individual schemas for direct access
export { MemoSchema } from "./memo.js";
export { QuestionSchema } from "./question.js";
export { FeedbackSchema } from "./feedback.js";
export { ProcedureSchema } from "./procedure.js";
export { ProcedureRunSchema } from "./procedure-run.js";
export { ImageSchema } from "./image.js";
export { AudioSchema } from "./audio.js";
export { FileSchema } from "./file.js";
export { CaptureSessionSchema } from "./capture-session.js";
export { RecordSchema } from "./record.js";
export { RecipeSchema } from "./recipe.js";
export { EmailThreadSchema } from "./email-thread.js";
export { EmailMessageSchema } from "./email-message.js";
export { EmailOutboundSchema } from "./email-outbound.js";
export { IntakeJobSchema } from "./intake-job.js";
export { CalendarReviewJobSchema } from "./calendar-review-job.js";
export { GuideSchema } from "./guide.js";
export { ScheduledScriptSchema } from "./scheduled-script.js";
export { TelegramMessageSchema } from "./telegram-message.js";
export { ChatThreadSchema } from "./chat-thread.js";
export { ChatJobSchema } from "./chat-job.js";
export { PersonalitySchema } from "./personality.js";
export { QuestionFollowupJobSchema } from "./question-followup-job.js";
export { TodoListSchema } from "./todo-list.js";
export { BriefingSchema } from "./briefing.js";
export { PersonSchema } from "./person.js";
export { SheetSchema } from "./sheet.js";
export { DocSchema } from "./doc.js";
export { GdocSchema } from "./gdoc.js";
export { LandmarkSchema } from "./landmark.js";
