/** Lowercase `text`, turn each run of non `a-z0-9` characters into `-`, and trim `-` from both ends. */
export function asciiSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
