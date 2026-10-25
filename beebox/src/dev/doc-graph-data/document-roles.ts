/** @public Imported by `workstreams-app/src/shared/documents.ts`, outside this package. */
/**
 * The roles a document can have. Kept apart from `document-lifecycle.ts`,
 * which imports Node-only card code, so the workstreams dashboard can bundle
 * this list for the browser.
 */

export const DOCUMENT_ROLES = [
  "reference",
  "proposal",
  "shipped-history",
  "past-proposal",
  "report",
  "design-rationale",
] as const;

export type DocumentRole = (typeof DOCUMENT_ROLES)[number];
