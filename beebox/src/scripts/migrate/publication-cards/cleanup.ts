/** Rules e-h: leftover pointer cards, retired guidance, and the empty `src/publications/`. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseCardText } from "../../../core/card-io.js";
import { listBoxCardFiles } from "../../../core/list-cards.js";
import { parseFrontmatterObject, splitCardContent } from "../../../cards/frontmatter.js";
import { PublicationSchema } from "../../../schemas/publication.js";
import { isRecord } from "../../../shared/is-record.js";
import { entryKind, move, readOrNull, remove, removeIfEmpty, sha256, writeText, type MigrationContext } from "./box-fs.js";

const SUFFIX = ".publication.card";
const schemas = new Map([[PublicationSchema.type, PublicationSchema]]);
const GUIDE_REL = "src/publications/CLAUDE.md";
const NOTES_REL = "src/publications/NOTES.md";
const TRACKER_REL = "_config/template-versions.json";

/** sha256 of every shipped `src/publications/CLAUDE.md` (template `publications-guide-v1`). */
export const SHIPPED_GUIDE_HASHES: readonly string[] = [
  "05eb76019f668aa2d613aa248faf4687d51ce9e56cd060787a9d35c5a90de372",
  "78255aba6d2484c7ccdd0e1b91982d9c53376da52da2021755aa13b779a098ca",
];
/** sha256 of the seeded `src/publications/NOTES.md`; the seed text never changed. */
export const SHIPPED_NOTES_HASHES: readonly string[] = ["5eaa25292e7092465064fdab6331b0eb3448b42417b9058268c3f6faf13dca95"];

function isValidPublication(text: string, rel: string): boolean {
  try {
    parseCardText(text, { source: rel, schemas });
    return true;
  } catch (_e) {
    return false;
  }
}

/** Rule e: pointer cards that are still not valid publications. */
export async function invalidPublicationCards(ctx: MigrationContext): Promise<void> {
  const files = (await listBoxCardFiles(ctx.boxRoot)).filter((file) => file.endsWith(SUFFIX)).toSorted();
  for (const file of files) {
    const rel = path.relative(ctx.boxRoot, file).split(path.sep).join("/");
    if (ctx.handledCards.has(rel) || (await entryKind(ctx, rel)) !== "file") continue;
    const text = (await readOrNull(ctx, rel)) ?? "";
    if (isValidPublication(text, rel)) continue;
    const body = splitCardContent(text).body.trim();
    if (body === "") {
      await remove(ctx, rel);
      ctx.warnings.push(`${rel} had no publication source and no notes; deleted`);
      continue;
    }
    const title = parseFrontmatterObject(text)?.["title"];
    const base = rel.slice(0, -SUFFIX.length);
    const mdRel = (await entryKind(ctx, `${base}.md`)) === "missing" ? `${base}.md` : `${base}-publication.md`;
    const heading = typeof title === "string" ? title : path.posix.basename(base);
    const content = `This publication has no source in the box. Its notes are kept here.\n\n# ${heading}\n\n${body}\n`;
    await writeText(ctx, { rel: mdRel, content });
    await remove(ctx, rel);
    ctx.warnings.push(`${rel} had no publication source; its notes moved to ${mdRel}`);
  }
}

async function dropTrackerEntry(ctx: MigrationContext): Promise<void> {
  const raw = await readOrNull(ctx, TRACKER_REL);
  if (raw === null) return;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !(GUIDE_REL in parsed)) return;
  const { [GUIDE_REL]: _dropped, ...rest } = parsed;
  await writeText(ctx, { rel: TRACKER_REL, content: `${JSON.stringify(rest, null, 2)}\n` });
  ctx.actions.push(`remove ${GUIDE_REL} from ${TRACKER_REL}`);
}

function markdownLink(fromCard: string, toRel: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromCard), toRel);
  return rel.includes(" ") ? `<${rel}>` : rel;
}

/** Rules f-h. */
export async function retireGuidance(ctx: MigrationContext): Promise<void> {
  const guide = await readOrNull(ctx, GUIDE_REL);
  if (guide !== null && SHIPPED_GUIDE_HASHES.includes(sha256(guide))) await remove(ctx, GUIDE_REL);
  else if (guide !== null) {
    const parked = `_config/_template-updates/${GUIDE_REL}`;
    await move(ctx, { fromRel: GUIDE_REL, toRel: parked });
    ctx.warnings.push(`${GUIDE_REL} was edited; parked at ${parked} for review`);
  }
  await dropTrackerEntry(ctx);

  const notes = await readOrNull(ctx, NOTES_REL);
  if (notes !== null && SHIPPED_NOTES_HASHES.includes(sha256(notes))) await remove(ctx, NOTES_REL);
  else if (notes !== null) {
    const taken = (await entryKind(ctx, "_content/publications/NOTES.md")) !== "missing";
    const dest = taken ? "_content/publications/NOTES-migrated.md" : "_content/publications/NOTES.md";
    await move(ctx, { fromRel: NOTES_REL, toRel: dest });
    for (const card of ctx.migratedCards) {
      if (ctx.apply) await fs.appendFile(path.join(ctx.boxRoot, card), `\nPublication notes: [NOTES](${markdownLink(card, dest)})\n`);
      ctx.actions.push(`link ${card} -> ${dest}`);
    }
  }
  await removeIfEmpty(ctx, "src/publications");
}
