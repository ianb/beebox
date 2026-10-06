/** Rules a-d: turn one `src/publications/<name>/` into a publication card plus attach folder. */

import * as path from "node:path";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { publicationDefinitionSchema, type PublicationDefinition } from "../../../publish/publication-definition.js";
import { createPublicationCardTemplate } from "../../../schemas/publication.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { entryKind, move, readOrNull, remove, removeIfEmpty, writeText, type MigrationContext } from "./box-fs.js";

/**
 * The retired `publication.json` shape is the strict definition schema, which
 * the engine still uses for the card's request. A file it rejects cannot become
 * a valid card, so it is reported and left in place.
 */
type OldPublication = PublicationDefinition;

function optionalFields(def: OldPublication): { slug?: string; emails?: string[] } {
  return {
    ...(def.tier === "public" && def.slug !== undefined ? { slug: def.slug } : {}),
    ...(def.tier === "accounts" ? { emails: def.emails } : {}),
  };
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

/** Read one `publication.json`; a missing or rejected file is reported and yields null. */
async function readOldDefinition(ctx: MigrationContext, { pubDir, jsonRel }: { pubDir: string; jsonRel: string }): Promise<OldPublication | null> {
  const raw = await readOrNull(ctx, jsonRel);
  if (raw === null) {
    ctx.warnings.push(`${pubDir}/ has no publication.json; left in place`);
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    ctx.warnings.push(`${jsonRel} is not valid JSON; left in place: ${errorMessage(e)}`);
    return null;
  }
  const parsed = publicationDefinitionSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const detail = issue === undefined ? "rejected" : `${issue.path.join(".") || "definition"}: ${issue.message}`;
  ctx.warnings.push(`${jsonRel} is invalid; left in place: ${detail}`);
  return null;
}

/** Rules a-d for one publication directory. `cards` lists the cards carrying its pubId. */
export async function migratePublication(ctx: MigrationContext, { name, cards }: { name: string; cards: Map<string, string[]> }): Promise<void> {
  const pubDir = `src/publications/${name}`;
  const jsonRel = `${pubDir}/publication.json`;
  const def = await readOldDefinition(ctx, { pubDir, jsonRel });
  if (def === null) return;
  if (ctx.migratedPubIds.has(def.pubId)) {
    ctx.warnings.push(`${jsonRel} repeats the pubId of a publication already migrated; left in place`);
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
  ctx.migratedPubIds.add(def.pubId);

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
