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
import { SchemaRegistry, type ElementSchema } from "cardworks";
import { MemoSchema } from "./memo.js";
import { QuestionSchema } from "./question.js";
import { NewsItemSchema } from "./news-item.js";
import { NewsSummarySchema } from "./news-summary.js";
import { NewsBriefSchema } from "./news-brief.js";
import { NewsGuideSchema } from "./news-guide.js";
import { FeedbackSchema } from "./feedback.js";
import { WorkflowSchema } from "./workflow.js";
import { WorkflowRunSchema } from "./workflow-run.js";
import { BookmarkSchema } from "./bookmark.js";
import { ImageSchema } from "./image.js";
import { AudioSchema } from "./audio.js";
import { CaptureSessionSchema } from "./capture-session.js";
import { RecordSchema } from "./record.js";
import { RecipeSchema } from "./recipe.js";
import { EmailThreadSchema } from "./email-thread.js";
import { EmailMessageSchema } from "./email-message.js";
import { NewsJobSchema } from "./news-job.js";
import { GuideRevisionJobSchema } from "./guide-revision-job.js";
import { IntakeJobSchema } from "./intake-job.js";
import { CalendarReviewJobSchema } from "./calendar-review-job.js";
import { GuideSchema } from "./guide.js";
import { ScheduledScriptSchema } from "./scheduled-script.js";
import { PushoverMessageSchema } from "./pushover-message.js";
import { PersonalitySchema } from "./personality.js";
import { registerTemplate, type TemplateDefinition } from "./templates.js";

/**
 * All built-in card schemas.
 */
export const schemas: ElementSchema[] = [
  MemoSchema,
  QuestionSchema,
  NewsItemSchema,
  NewsSummarySchema,
  NewsBriefSchema,
  NewsGuideSchema,
  FeedbackSchema,
  WorkflowSchema,
  WorkflowRunSchema,
  BookmarkSchema,
  ImageSchema,
  AudioSchema,
  CaptureSessionSchema,
  RecordSchema,
  RecipeSchema,
  EmailThreadSchema,
  EmailMessageSchema,
  NewsJobSchema,
  GuideRevisionJobSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
  GuideSchema,
  ScheduledScriptSchema,
  PushoverMessageSchema,
  PersonalitySchema,
];

/** Packages that box-local schemas can import from callback-box's tree. */
const SCHEMA_DEPS = new Set(["cardworks", "zod"]);

/**
 * Virtual parent URL inside callback-box's node_modules.
 * When we rewrite parentURL to this, Node resolves bare specifiers
 * by searching callback-box's node_modules.
 */
const CB_VIRTUAL_PARENT = pathToFileURL(
  join(import.meta.dirname, "..", "..", "node_modules", "_virtual.js")
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
  } catch {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(pkgJsonPath, '{"type":"module"}\n');
  }
}

/**
 * Load box-local schemas from config/schemas/*.ts.
 *
 * Each file should export default an ElementSchema (from cardworks `element()`).
 * Optionally, it can also export a `template` (TemplateDefinition) for `cb create`.
 *
 * Errors in individual files are logged as warnings, not fatal.
 */
export async function loadBoxSchemas(boxRoot: string): Promise<ElementSchema[]> {
  const schemasDir = join(boxRoot, "config/schemas");
  let files: string[];
  try {
    files = await readdir(schemasDir);
  } catch {
    return [];
  }

  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
  if (tsFiles.length === 0) return [];

  const loaded: ElementSchema[] = [];

  // Ensure package.json with "type": "module" so .ts files load as ESM,
  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
  // from callback-box's node_modules.
  await ensureEsmPackageJson(schemasDir);
  ensureResolveHooks();

  for (const file of tsFiles) {
    try {
      const filePath = join(schemasDir, file);
      const mod = await import(pathToFileURL(filePath).href);

      if (!mod.default || !mod.default.tagName) {
        console.warn(`Warning: ${file} does not export a default ElementSchema, skipping`);
        continue;
      }

      loaded.push(mod.default as ElementSchema);

      if (mod.template) {
        registerTemplate(mod.template as TemplateDefinition);
      }
    } catch (err) {
      console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
    }
  }

  return loaded;
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
    const boxSchemas = await loadBoxSchemas(boxRoot);
    for (const schema of boxSchemas) {
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
  const boxSchemas = await loadBoxSchemas(boxRoot);
  return [...schemas, ...boxSchemas];
}

/**
 * Get the list of known card types.
 */
export function getCardTypes(): string[] {
  return schemas.map(s => s.tagName);
}

/**
 * Check if a card type is known.
 */
export function isKnownCardType(type: string): boolean {
  return schemas.some(s => s.tagName === type);
}

// Re-export individual schemas for direct access
export { MemoSchema } from "./memo.js";
export { QuestionSchema } from "./question.js";
export { NewsItemSchema } from "./news-item.js";
export { NewsSummarySchema } from "./news-summary.js";
export { NewsBriefSchema } from "./news-brief.js";
export { NewsGuideSchema } from "./news-guide.js";
export { FeedbackSchema } from "./feedback.js";
export { WorkflowSchema } from "./workflow.js";
export { WorkflowRunSchema } from "./workflow-run.js";
export { BookmarkSchema } from "./bookmark.js";
export { ImageSchema } from "./image.js";
export { AudioSchema } from "./audio.js";
export { CaptureSessionSchema } from "./capture-session.js";
export { RecordSchema } from "./record.js";
export { RecipeSchema } from "./recipe.js";
export { EmailThreadSchema } from "./email-thread.js";
export { EmailMessageSchema } from "./email-message.js";
export { NewsJobSchema } from "./news-job.js";
export { GuideRevisionJobSchema } from "./guide-revision-job.js";
export { IntakeJobSchema } from "./intake-job.js";
export { CalendarReviewJobSchema } from "./calendar-review-job.js";
export { GuideSchema } from "./guide.js";
export { ScheduledScriptSchema } from "./scheduled-script.js";
export { PushoverMessageSchema } from "./pushover-message.js";
export { PersonalitySchema } from "./personality.js";
