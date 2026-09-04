import { createHash } from "node:crypto";

export type ImageFit = "scale-down" | "contain" | "cover" | "crop" | "pad";
export type ImageFormat = "avif" | "webp" | "jpeg";

export interface ImageTransformOptions {
  width?: number | undefined;
  height?: number | undefined;
  fit: ImageFit;
  quality: number;
  format: ImageFormat;
  dpr: number;
}

export class ImageOptionError extends Error {
  readonly option: string;

  constructor({ option, detail }: { option: string; detail: string }) {
    super(`Invalid image option "${option}": ${detail}`);
    this.name = "ImageOptionError";
    this.option = option;
  }
}

const ALIASES = {
  width: ["width", "w"],
  height: ["height", "h"],
  quality: ["quality", "q"],
  format: ["format", "f"],
} as const;

// `v` is the file-watcher cache buster; `imageRetry` is the bounded chat
// retry token. Neither changes the derived representation's identity.
const KNOWN_KEYS = new Set(["width", "w", "height", "h", "fit", "quality", "q", "format", "f", "dpr", "v", "imageRetry"]);
function singleValue({ query, name, aliases }: {
  query: Record<string, unknown>;
  name: string;
  aliases: readonly string[];
}): string | undefined {
  const present = aliases.filter((alias) => query[alias] !== undefined);
  if (present.length > 1) throw new ImageOptionError({ option: name, detail: `use only one of ${aliases.join(" or ")}` });
  const raw = present.length === 1 ? query[present[0] ?? ""] : undefined;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new ImageOptionError({ option: name, detail: "must occur exactly once" });
  return raw;
}

function integerOption(raw: string | undefined, bounds: { name: string; min: number; max: number }): number | undefined {
  if (raw === undefined) return undefined;
  const { name, min, max } = bounds;
  if (!/^\d+$/.test(raw)) throw new ImageOptionError({ option: name, detail: `must be an integer from ${String(min)} to ${String(max)}` });
  const value = Number(raw);
  if (value < min || value > max) throw new ImageOptionError({ option: name, detail: `must be from ${String(min)} to ${String(max)}` });
  return value;
}

function numberOption(raw: string | undefined, bounds: { name: string; minExclusive: number; max: number }): number | undefined {
  if (raw === undefined) return undefined;
  const { name, minExclusive, max } = bounds;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= minExclusive || value > max) {
    throw new ImageOptionError({ option: name, detail: `must be greater than ${String(minExclusive)} and at most ${String(max)}` });
  }
  return value;
}

function accepts(accept: string, mime: string): boolean {
  return accept.split(",").some((part) => {
    const [media = "", ...params] = part.trim().toLowerCase().split(";");
    // A wildcard means "some image", not proof that the client decodes this
    // particular modern format. Only explicit AVIF/WebP tokens negotiate up.
    if (media !== mime) return false;
    return !params.some((param) => /^q=0(?:\.0*)?$/.test(param.trim()));
  });
}

export function negotiateImageFormat(accept: string | undefined): ImageFormat {
  const value = accept ?? "";
  if (accepts(value, "image/avif")) return "avif";
  if (accepts(value, "image/webp")) return "webp";
  return "jpeg";
}

function imageFit(value: string): ImageFit | null {
  if (value === "scale-down" || value === "contain" || value === "cover" || value === "crop" || value === "pad") return value;
  return null;
}

function requestedFormat(value: string): ImageFormat | "auto" | null {
  if (value === "auto" || value === "avif" || value === "webp" || value === "jpeg") return value;
  return null;
}

export function parseImageTransformOptions(
  query: Record<string, unknown>,
  accept?: string,
): { options: ImageTransformOptions; negotiated: boolean } {
  for (const key of Object.keys(query)) {
    if (!KNOWN_KEYS.has(key)) throw new ImageOptionError({ option: key, detail: "unknown option" });
  }

  const width = integerOption(singleValue({ query, name: "width", aliases: ALIASES.width }), { name: "width", min: 1, max: 4096 });
  const height = integerOption(singleValue({ query, name: "height", aliases: ALIASES.height }), { name: "height", min: 1, max: 4096 });
  if (width === undefined && height === undefined) {
    throw new ImageOptionError({ option: "width/height", detail: "at least one dimension is required" });
  }
  const quality = integerOption(singleValue({ query, name: "quality", aliases: ALIASES.quality }), { name: "quality", min: 1, max: 100 }) ?? 85;
  const dpr = numberOption(singleValue({ query, name: "dpr", aliases: ["dpr"] }), { name: "dpr", minExclusive: 0, max: 2 }) ?? 1;
  if ((width !== undefined && width * dpr > 4096) || (height !== undefined && height * dpr > 4096)) {
    throw new ImageOptionError({ option: "dpr", detail: "physical width and height must not exceed 4096 pixels" });
  }

  const fitRaw = singleValue({ query, name: "fit", aliases: ["fit"] }) ?? "scale-down";
  const fit = imageFit(fitRaw);
  if (fit === null) throw new ImageOptionError({ option: "fit", detail: "must be scale-down, contain, cover, crop, or pad" });
  const rawFormat = singleValue({ query, name: "format", aliases: ALIASES.format }) ?? "auto";
  const formatRequest = requestedFormat(rawFormat);
  if (formatRequest === null) throw new ImageOptionError({ option: "format", detail: "must be auto, avif, webp, or jpeg" });
  const negotiated = formatRequest === "auto";
  const format = negotiated ? negotiateImageFormat(accept) : formatRequest;

  return {
    options: { width, height, fit, quality, format, dpr },
    negotiated,
  };
}

export function imageTransformCacheKey({ sourcePath, sourceVersion, options }: {
  sourcePath: string;
  sourceVersion: string;
  options: ImageTransformOptions;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ schema: 1, sourcePath, sourceVersion, options }))
    .digest("hex");
}
