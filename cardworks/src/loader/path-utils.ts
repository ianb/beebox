/**
 * Internal path manipulation helpers for the card loader.
 *
 * These operate on POSIX-style "/"-separated paths (the canonical form used
 * throughout cardworks), independent of the host platform's path separator.
 */

/**
 * Get the directory portion of a path.
 */
export function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
}

/**
 * Get the filename portion of a path.
 */
export function basename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Get the extension of a filename (including the dot).
 */
export function extname(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot);
}

/**
 * Get the shared basename of a card/attachment pair.
 *
 * Cards are named `Name.type.card` and their sibling attachments are named
 * `Name.ext` (e.g. `photo-001.image.card` + `photo-001.jpg`). To detect the
 * pair we need to treat "Name" as the shared stem — which means stripping
 * BOTH `.type` and `.card` for card files, but only the single extension for
 * non-card files.
 */
export function sharedStem(filename: string): string {
  if (filename.endsWith(".card")) {
    const withoutCard = filename.slice(0, -".card".length);
    const lastDot = withoutCard.lastIndexOf(".");
    return lastDot === -1 ? withoutCard : withoutCard.slice(0, lastDot);
  }
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

/**
 * Compute relative path from a directory to a file.
 * Unlike relativePath, this takes a directory, not a file path.
 */
export function relative(from: string, to: string): string {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const parts: string[] = [];
  for (let i = 0; i < upCount; i++) {
    parts.push("..");
  }
  parts.push(...downParts);

  return parts.join("/") || ".";
}

/**
 * Compute relative path from one file to another.
 */
export function relativePath(from: string, to: string): string {
  const fromParts = dirname(from).split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  const toFilename = toParts.pop() ?? "";

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const parts: string[] = [];
  for (let i = 0; i < upCount; i++) {
    parts.push("..");
  }
  parts.push(...downParts, toFilename);

  const result = parts.join("/");
  return result.startsWith(".") ? result : "./" + result;
}
