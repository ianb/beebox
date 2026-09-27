import { pubIdSchema } from "../publish/manifest.js";

/** Stable, box-visible reference card path; the publication id is immutable identity. */
export function publicationCardPath(pubId: string): string {
  return `_content/publications/${pubIdSchema.parse(pubId)}.publication.card`;
}

/** Canonical card page path used by links and agent-facing approval output. */
export function publicationCardUrl(boxSlug: string, cardPath: string): string {
  const encodedCardPath = cardPath.split("/").map(encodeURIComponent).join("/");
  return `/${encodeURIComponent(boxSlug)}/views/${encodedCardPath}`;
}
