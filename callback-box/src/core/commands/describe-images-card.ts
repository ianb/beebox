/**
 * Card I/O for the describe-images command.
 *
 * Loads / saves image cards, marks unanalyzable images invalid, writes an
 * analysis (plus EXIF) back into a card, and renames a card to its suggested
 * title. All filesystem-mutating logic for cards lives here.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock } from "../../cards/index.js";
import { type CommandContext } from "../command-runner.js";
import { parseCardName } from "../../lib/paths.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type ImageFields } from "../../schemas/image.js";
import type { extractExif, ImageAnalysis } from "./describe-images-helpers.js";

async function loadImageCard(cardPath: string): Promise<ImageFields> {
  const content = await fs.readFile(cardPath, "utf-8");
  const parsed = parseCardText(content, {
    source: cardPath,
    schemas: await createCardSchemaMap(),
  });
  return parsed.fields as unknown as ImageFields;
}

async function saveImageCard(cardPath: string, fields: ImageFields): Promise<void> {
  const parsed = parseCardText(renderFrontmatterBlock(fields), {
    source: cardPath,
    schemas: await createCardSchemaMap(),
  });
  await fs.writeFile(cardPath, serializeCardText({
    schema: parsed.schema,
    fields: fields as unknown as Record<string, unknown>,
  }));
}

export async function markCardInvalid(cardPath: string, description: string): Promise<void> {
  const fields = await loadImageCard(cardPath);
  if (fields.status !== "new") return;
  fields.status = "invalid";
  fields.description = description;
  await saveImageCard(cardPath, fields);
}

type Exif = Awaited<ReturnType<typeof extractExif>>;

/** Map EXIF data into the card's `exif` field, or delete it when absent. */
function applyExifField(fields: ImageFields, exif: Exif): void {
  if (!exif) {
    delete fields.exif;
    return;
  }
  const exifFields: NonNullable<ImageFields["exif"]> = {};
  if (exif.date) exifFields.date = exif.date;
  if (exif.camera) exifFields.camera = exif.camera;
  if (exif.gps) exifFields.gps = exif.gps;
  if (exif.width) exifFields.width = exif.width;
  if (exif.height) exifFields.height = exif.height;
  fields.exif = exifFields;
}

/** Map the analysis's document/bbox/text/rotation onto the card fields. */
function applyAnalysisFields(fields: ImageFields, analysis: ImageAnalysis): void {
  fields.status = analysis.invalid ? "invalid" : "analyzed";
  // Documents always count as has-text, even if the model forgot to set it.
  fields["has-text"] = analysis.has_text || analysis.is_document;
  if (analysis.rotation !== 0) {
    fields.rotation = String(analysis.rotation) as NonNullable<ImageFields["rotation"]>;
  } else {
    delete fields.rotation;
  }

  fields.description = analysis.description;
  if (analysis.contains.trim() !== "") {
    fields.contains = analysis.contains;
  }

  if (analysis.text_blocks.length > 0) {
    fields.text = analysis.text_blocks.map((b) => ({
      source: b.source,
      content: b.text,
    }));
  } else {
    delete fields.text;
  }

  if (analysis.subject_bbox && analysis.subject_bbox.length === 4) {
    fields["subject-bbox"] = {
      y1: String(analysis.subject_bbox[0]),
      x1: String(analysis.subject_bbox[1]),
      y2: String(analysis.subject_bbox[2]),
      x2: String(analysis.subject_bbox[3]),
    };
  } else {
    delete fields["subject-bbox"];
  }

  if (analysis.is_document) {
    const doc: NonNullable<ImageFields["document"]> = {};
    if (analysis.document_kind) doc.kind = analysis.document_kind;
    if (analysis.document_from) doc.from = analysis.document_from;
    if (analysis.document_dates.length > 0) {
      doc.dates = analysis.document_dates.map((d) => ({ label: d.label, value: d.value }));
    }
    fields.document = doc;
  } else {
    delete fields.document;
  }
}

export async function applyAnalysisToCard(input: {
  cardPath: string;
  analysis: ImageAnalysis;
  exif: Exif;
}): Promise<void> {
  const { cardPath, analysis, exif } = input;
  const fields = await loadImageCard(cardPath);

  applyAnalysisFields(fields, analysis);

  // Update captured date from EXIF if the card doesn't already have one.
  if (exif && exif.date && !fields.filename.captured) {
    fields.filename.captured = exif.date;
  }

  applyExifField(fields, exif);

  await saveImageCard(cardPath, fields);
}

export async function renameCard(
  cardPath: string,
  { title, ctx }: { title: string; ctx: CommandContext }
): Promise<void> {
  const currentName = parseCardName(path.basename(cardPath));
  if (!currentName) return;

  const prefixMatch = currentName.name.match(/^(photo-\d+|audio-\d+|img-\d+)/);
  const prefix = prefixMatch ? prefixMatch[1] : null;
  const newName = prefix ? `${prefix}-${title}` : title;
  const newCardName = `${newName}.image.card`;
  const newCardPath = path.join(path.dirname(cardPath), newCardName);

  if (newCardPath === cardPath) return;

  try {
    const { runCommand } = await import("../command-runner.js");
    await runCommand({
      name: "move",
      args: {
        from: path.relative(ctx.boxRoot, cardPath),
        to: path.relative(ctx.boxRoot, newCardPath),
      },
      ctx,
    });
  } catch (err) {
    ctx.writeLine(`  Warning: Failed to rename: ${(err as Error).message}`);
  }
}
