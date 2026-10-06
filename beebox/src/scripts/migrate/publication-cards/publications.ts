/** Rules a-d: turn one `src/publications/<name>/` into a publication card plus attach folder. */

import * as path from "node:path";
import { z } from "zod";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { pubIdSchema } from "../../../publish/manifest.js";
import {
  publicationConnectionSchema,
  publicationEmailsSchema,
  publicationSlugSchema,
  publicationTierSchema,
  publicationTitleSchema,
} from "../../../publish/publication-definition.js";
import { createPublicationCardTemplate } from "../../../schemas/publication.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { entryKind, move, readOrNull, remove, removeIfEmpty, writeText, type MigrationContext } from "./box-fs.js";

/** The retired `publication.json` shape. */
const OldPublicationSchema = z.object({
  pubId: pubIdSchema,
  connection: publicationConnectionSchema,
  content: z.enum(["static", "project"]),
  title: publicationTitleSchema,
  tier: publicationTierSchema,
  slug: publicationSlugSchema.optional(),
  emails: publicationEmailsSchema.optional(),
});
type OldPublication = z.infer<typeof OldPublicationSchema>;

function optionalFields(def: OldPublication): { slug?: string; emails?: string[] } {
  return { ...(def.slug === undefined ? {} : { slug: def.slug }), ...(def.emails === undefined ? {} : { emails: def.emails }) };
}

const DEFAULT_DIR = "_content/publications";

async function cardBody(ctx: MigrationContext, rel: string): Promise<string> {
  return splitCardContent((await readOrNull(ctx, rel)) ?? "").body.trim();
}

/** Rule b: the card's final path. */
async function targetPath(ctx: MigrationContext, { name, def, kept }: { name: string; def: OldPublication; kept: string | undefined }): Promise<string> {
  const dir = kept === undefined ? DEFAULT_DIR : path.posix.dirname(kept);
  const wanted = `${dir}/${name}.publication.card`;
  if (wanted === kept || (await entryKind(ctx, wanted)) === "missing") return wanted;
  return kept ?? `${dir}/${name}-${def.pubId.slice(0, 6)}.publication.card`;
}

/** Rules a-d for one publication directory. `cards` lists the cards carrying its pubId. */
export async function migratePublication(ctx: MigrationContext, { name, cards }: { name: string; cards: Map<string, string[]> }): Promise<void> {
  const pubDir = `src/publications/${name}`;
  const jsonRel = `${pubDir}/publication.json`;
  const raw = await readOrNull(ctx, jsonRel);
  if (raw === null) {
    ctx.warnings.push(`${pubDir}/ has no publication.json; left in place`);
    return;
  }
  let def: OldPublication;
  try {
    def = OldPublicationSchema.parse(JSON.parse(raw));
  } catch (e) {
    ctx.warnings.push(`${jsonRel} is invalid; left in place: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const found = cards.get(def.pubId) ?? [];
  const defaultCard = `${DEFAULT_DIR}/${def.pubId}.publication.card`;
  const kept = found.includes(defaultCard) ? defaultCard : found[0];
  const aliases = found.filter((rel) => rel !== kept);
  const target = await targetPath(ctx, { name, def, kept });
  const [selected, other, mode] = def.content === "static" ? ["site", "project", "static"] : ["project", "site", "project"];
  const destMode = `${attachDirFor(target)}/${mode}`;
  if ((await entryKind(ctx, destMode)) !== "missing") {
    ctx.warnings.push(`${destMode} already exists; skipped ${pubDir}/ entirely`);
    return;
  }
  const srcRel = `${pubDir}/${selected}`;
  const srcKind = await entryKind(ctx, srcRel);
  if (srcKind === "symlink" || (await entryKind(ctx, pubDir)) === "symlink") {
    ctx.warnings.push(`${srcRel} is a symlink; skipped ${pubDir}/ entirely`);
    return;
  }

  const bodies = [kept === undefined ? "" : await cardBody(ctx, kept)];
  for (const alias of aliases) bodies.push(await cardBody(ctx, alias));
  const body = bodies.filter((b) => b !== "").join("\n\n");
  const content = createPublicationCardTemplate({
    pubId: def.pubId,
    title: def.title,
    connection: def.connection,
    tier: def.tier,
    ...optionalFields(def),
    body: body === "" ? "" : `\n${body}\n`,
  });
  await writeText(ctx, { rel: target, content });
  ctx.actions.push(`write ${target}${kept !== undefined && kept !== target ? ` (from ${kept})` : ""}`);
  if (kept !== undefined && kept !== target) await remove(ctx, kept);
  for (const alias of aliases) {
    await remove(ctx, alias);
    ctx.warnings.push(`${alias} carried the same pubId as ${target}; its notes were merged there and it was deleted`);
  }
  for (const rel of [...found, target]) ctx.handledCards.add(rel);
  ctx.migratedCards.push(target);

  if (srcKind === "dir") {
    if (selected === "project") {
      for (const junk of ["node_modules", "dist"]) {
        if ((await entryKind(ctx, `${srcRel}/${junk}`)) !== "missing") await remove(ctx, `${srcRel}/${junk}`);
      }
    }
    await move(ctx, { fromRel: srcRel, toRel: destMode });
  } else {
    ctx.warnings.push(`${srcRel}/ is missing; ${target} has no source yet`);
  }
  if ((await entryKind(ctx, `${pubDir}/${other}`)) !== "missing") {
    ctx.warnings.push(`${pubDir}/${other}/ is not the selected source (content: ${def.content}); left in place`);
  }
  await remove(ctx, jsonRel);
  await removeIfEmpty(ctx, pubDir);
}
