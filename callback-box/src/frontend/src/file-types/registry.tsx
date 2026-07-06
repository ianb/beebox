/**
 * Frontend FileType registry — maps a file (by card type or path pattern) to
 * its presentation bits: icon (required) and an optional ListComponent that
 * renders a custom middle-slot for the list/peek entry.
 *
 * Dispatch rule mirrors the server loader registry: card-type exact match
 * wins, then the first path-pattern match, then the generic fallback.
 *
 * The registration store and dispatch live in `../file-type-registry` (shared
 * with `../renderers`, the other half of a file's type→UI dispatch); this
 * module re-exports the list-UI-facing slice so existing imports don't churn.
 */

export {
  type FileTypeSelector,
  type ListProps,
  type FileTypeUI,
  registerFileType,
  resolveFileTypeUI,
  fallbackFileTypeUI,
  resetFileTypeRegistry,
} from "../file-type-registry";
