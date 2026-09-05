import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { probePointer } from "../lib/asset-content.js";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import { isInBoxNamespace } from "../lib/box-namespace.js";
import { resolveBoxNamespacePathOnDisk, verifyBoxNamespaceOnDisk } from "../lib/box-namespace-resolve.js";

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

  // Box containment + namespace fence, checked on the RESOLVED path
  // (`docs/plans/one-root-box-layout.md` Track B).
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: requestedPath, mode: "read" });
  if (ns === null) throw new BoxImageError(403, { error: "Access denied" });
  const { resolved: requested } = ns;
  if (path.basename(requested).startsWith(".")) throw new BoxImageError(403, { error: "Access denied" });

  let absolutePath = requested;
  if (requested.endsWith(".image.card")) {
    absolutePath = await resolveImageCard(requested) ?? "";
    if (absolutePath === "") throw new BoxImageError(404, { error: "Image not found in card" });
  } else if (!BOX_IMAGE_EXTENSIONS.has(path.extname(requested).toLowerCase())) {
    throw new BoxImageError(400, { error: "Not an image path" });
  }

  // `absolutePath` may be derived from the card's `filename.ref` (the
  // `.image.card` branch above), not the raw request path — re-fence it the
  // same way: lexical containment + namespace, then the on-disk symlink
  // check, so a card whose ref was crafted/rewritten to point outside the
  // namespace can't be used to walk the fence either.
  const imageRoot = path.resolve(boxRoot);
  const imageRelativePath = path.relative(imageRoot, absolutePath).split(path.sep).join("/");
  const imageContained = absolutePath === imageRoot || absolutePath.startsWith(imageRoot + path.sep);
  if (!imageContained || !isInBoxNamespace(imageRelativePath)) {
    throw new BoxImageError(403, { error: "Access denied" });
  }
  const imageOnDisk = await verifyBoxNamespaceOnDisk({
    boxRoot,
    ns: { resolved: absolutePath, relativePath: imageRelativePath },
    mode: "read",
  });
  if (!imageOnDisk) throw new BoxImageError(403, { error: "Access denied" });

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
    return { absolutePath, relativePath: imageRelativePath, stat };
  } catch (error) {
    if (error instanceof BoxImageError) throw error;
    if (errnoCode(error) === "ENOENT") throw new BoxImageError(404, { error: "Not found" });
    throw error;
  }
}
