import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { probePointer } from "../lib/asset-content.js";
import { containWithinBox } from "../lib/box-containment.js";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";

export const BOX_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".svg"]);

export class BoxImageError extends Error {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;

  constructor(statusCode: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Image request failed");
    this.name = "BoxImageError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function resolveImageCard(cardAbs: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(cardAbs, "utf-8");
  } catch (_error) {
    return null;
  }
  let ref: string | null = null;
  if (text.startsWith("---")) {
    const match = /^---\r?\n([\S\s]*?)\r?\n---/.exec(text);
    if (match) {
      let fields: unknown;
      try {
        fields = parseYaml(match[1] ?? "");
      } catch (_error) {
        fields = null;
      }
      if (isRecord(fields) && isRecord(fields.filename) && typeof fields.filename.ref === "string") {
        ref = fields.filename.ref.startsWith("attach/") ? fields.filename.ref : null;
      }
    }
  } else {
    ref = /<filename\b[^>]*\bref="(attach\/[^"]+)"/.exec(text)?.[1] ?? null;
  }
  if (ref === null) return null;
  const cardBaseName = path.basename(cardAbs);
  const stem = cardBaseName.replace(/(\.[^.]+)*\.card$/, "");
  return path.join(path.dirname(cardAbs), `${stem}.attach`, ref.slice("attach/".length));
}

export interface ResolvedBoxImage {
  absolutePath: string;
  relativePath: string;
  stat: Stats;
}

export async function resolveBoxImage(boxRoot: string, requestedPath: string): Promise<ResolvedBoxImage> {
  if (requestedPath === "") throw new BoxImageError(400, { error: "Path required" });
  const requested = path.resolve(path.join(boxRoot, requestedPath));
  const relativeSegments = path.relative(boxRoot, requested).split(path.sep);
  if (containWithinBox(boxRoot, requested) === null || relativeSegments.some((segment) => segment.startsWith("."))) {
    throw new BoxImageError(403, { error: "Access denied" });
  }
  let absolutePath = requested;
  if (requested.endsWith(".image.card")) {
    absolutePath = await resolveImageCard(requested) ?? "";
    if (absolutePath === "") throw new BoxImageError(404, { error: "Image not found in card" });
  } else if (!BOX_IMAGE_EXTENSIONS.has(path.extname(requested).toLowerCase())) {
    throw new BoxImageError(400, { error: "Not an image path" });
  }
  if (containWithinBox(boxRoot, absolutePath) === null) throw new BoxImageError(403, { error: "Access denied" });
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new BoxImageError(404, { error: "Not found" });
    const pointer = await probePointer(absolutePath, { knownSize: stat.size });
    if (pointer !== null) {
      throw new BoxImageError(409, {
        error: "Content not present locally",
        key: pointer.key,
        size: pointer.size,
        sha256: pointer.sha256,
      });
    }
    return { absolutePath, relativePath: path.relative(boxRoot, absolutePath), stat };
  } catch (error) {
    if (error instanceof BoxImageError) throw error;
    if (errnoCode(error) === "ENOENT") throw new BoxImageError(404, { error: "Not found" });
    throw error;
  }
}
