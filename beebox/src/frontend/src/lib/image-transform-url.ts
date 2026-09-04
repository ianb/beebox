import type { ImageTransformUrlOptions } from "../api-core";

const PHOTO_EXT = /\.(?:avif|jpe?g|png|webp)$/i;
const IMAGE_MARKERS = ["/api/image/", "/api/files/"] as const;
const HAS_AUTHORITY = /^(?:[a-z][\d+.a-z-]*:|\/\/)/i;

export function isTransformablePhotoPath(path: string): boolean {
  return PHOTO_EXT.test(path.replace(/[#?].*$/, ""));
}

export function transformedResolvedImageUrl(
  source: string,
  options: ImageTransformUrlOptions,
): string | null {
  if (HAS_AUTHORITY.test(source)) return null;
  const marker = IMAGE_MARKERS.find((candidate) => source.includes(candidate));
  if (marker === undefined || !isTransformablePhotoPath(source)) return null;
  const markerIndex = source.indexOf(marker);
  const prefix = source.slice(0, markerIndex);
  const remainder = source.slice(markerIndex + marker.length);
  const [pathAndQuery, hash = ""] = remainder.split("#", 2);
  const [encodedPath = "", existingQuery = ""] = pathAndQuery?.split("?", 2) ?? [];
  const query = new URLSearchParams(existingQuery);
  if (options.width !== undefined) query.set("width", String(options.width));
  if (options.height !== undefined) query.set("height", String(options.height));
  if (options.fit !== undefined) query.set("fit", options.fit);
  if (options.quality !== undefined) query.set("quality", String(options.quality));
  if (options.format !== undefined) query.set("format", options.format);
  if (options.dpr !== undefined) query.set("dpr", String(options.dpr));
  const suffix = hash === "" ? "" : `#${hash}`;
  return `${prefix}/api/images/${encodedPath}?${query.toString()}${suffix}`;
}
