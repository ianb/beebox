/**
 * A card's `FileSummary` built from text already in hand.
 *
 * `loader-registry.ts`'s `summarize` is the rule — the base summary, then the
 * card type's `summarize` hook. What differs between callers is only how the
 * `LoaderInput` gets filled: `files.summarize` loads the card from disk after
 * resolving and fencing a caller-supplied path, while a collection has
 * already read every card it scanned and must not read them twice.
 *
 * A card that will not parse keeps the base summary from its filename — the
 * existing fallback rule. The collection reports such a card through its
 * issues channel; a summary is not the place to raise it again.
 */

import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
import { summarize } from "./loader-registry.js";
import type { FileSummary } from "./file-summary.js";

export function summarizeCardText(input: {
  relPath: string;
  content: string;
  ctx: LoadCardContext;
}): FileSummary<unknown> {
  const { relPath, content, ctx } = input;
  const type = typeFromFilename(relPath);
  if (type === undefined || !ctx.cardSchemas.has(type)) return summarize({ path: relPath }, ctx.cardSchemas);
  try {
    const parsed = parseCardText(content, { source: relPath, schemas: ctx.cardSchemas, type });
    return summarize({ path: relPath, fields: parsed.fields, type: parsed.schema.type }, ctx.cardSchemas);
  } catch (_e) {
    /* ignore: an unparseable card keeps its filename summary; the caller's issues channel reports the parse failure itself */
    return summarize({ path: relPath }, ctx.cardSchemas);
  }
}
