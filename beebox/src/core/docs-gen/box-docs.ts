/**
 * The box-side half of the docs split (`package-docs.ts` is the package side):
 * the card docs a box compiles for its OWN schemas, the removal of engine docs
 * an older engine left in the box, and the call that keeps the package docs
 * current. Split out of `index.ts` for size.
 */

import { join } from "node:path";
import { readdir, unlink, writeFile } from "node:fs/promises";
import { errnoCode } from "../../lib/error-guards.js";
import type { cardSchemas } from "../../schemas/registry.js";
import { getBuiltinTemplates, type TemplateDefinition } from "../../schemas/templates.js";
import { generateCardDoc } from "./content.js";
import { cardDocFilename, cardDocInstructions, engineDocFilenames, ensurePackageDocs } from "./package-docs.js";
import { DOCS_DIR, withDocId } from "./shared.js";

/**
 * `card-<type>.md` for each BOX-LOCAL schema with `instructions` — the only
 * card docs the box holds (built-in types are documented in the package).
 * Templates are the built-in set plus THIS box's own registrations — never the
 * process-wide effective set, which in the multi-box hub could carry another
 * box's template for the same type.
 *
 * Runs the engine-doc prune FIRST, sequentially: a box-local schema that
 * shadows a built-in type (e.g. `memo`) writes `card-memo.md` here, and the
 * prune list also names `card-memo.md` (the built-in an older engine wrote).
 * Prune-then-write makes the shadowing doc survive; interleaved, the prune
 * could win last and the guide would point at a deleted file.
 */
export async function writeBoxCardDocs(params: {
  boxRoot: string;
  debug: boolean;
  boxCardSchemas: typeof cardSchemas;
  boxTemplates: TemplateDefinition[];
}): Promise<void> {
  const { boxRoot, debug, boxCardSchemas, boxTemplates } = params;
  await pruneEngineDocs(boxRoot);
  const templates = [...getBuiltinTemplates(), ...boxTemplates];
  const currentCardDocs = boxCardSchemas
    .map((s) => ({ name: s.type, instructions: cardDocInstructions(s) }))
    .filter((s): s is { name: string; instructions: string } => s.instructions !== undefined);

  await Promise.all(currentCardDocs.map((s) => {
    const filename = cardDocFilename(s.name);
    const content = generateCardDoc({ name: s.name, instructions: s.instructions, templates: templates.filter((t) => t.cardTypes.includes(s.name)) });
    return writeFile(join(boxRoot, DOCS_DIR, filename),
      withDocId({ relativePath: `${DOCS_DIR}/${filename}`, content, debug }));
  }));

  // Prune card-<type>.md docs for schemas that no longer exist (or that were
  // built-in card docs written by an earlier engine), mirroring
  // init-rules.ts's cleanup of stale .claude/rules/card-<type>.md files.
  const currentTypes = new Set(currentCardDocs.map((s) => s.name));
  const isStale = (file: string): boolean =>
    file.startsWith("card-") && file.endsWith(".md") && !currentTypes.has(file.slice(5, -3));
  const stale = (await readdir(join(boxRoot, DOCS_DIR))).filter(isStale);
  await Promise.all(stale.map((file) => unlink(join(boxRoot, DOCS_DIR, file))));
}

/** Remove engine docs an earlier engine wrote into the box; they are in the package now. */
async function pruneEngineDocs(boxRoot: string): Promise<void> {
  await Promise.all(engineDocFilenames().map(async (file) => {
    try {
      await unlink(join(boxRoot, DOCS_DIR, file));
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
  }));
}

/**
 * Keep the package's engine docs current, and make a package that can't hold
 * them visible: the agent guide points there on every turn, so a missing
 * directory is dangling guidance, not a cosmetic gap. The health check
 * `package-docs` reports the same condition on the dashboard.
 */
export async function ensureEngineDocs(): Promise<void> {
  const result = await ensurePackageDocs();
  if (result.status === "unwritable") {
    console.error(
      `[generateDocs] beebox reference docs are missing or stale at ${result.dir} and the package is not writable ` +
      `(${result.reason}). Reinstall beebox — the release tarball ships them — or make the directory writable.`,
    );
  }
}

