/**
 * File renderer plugin system.
 *
 * Every file can have multiple applicable renderers, sorted by priority.
 * The highest-priority renderer is shown by default; the user can toggle between them.
 *
 * The registration store and dispatch live in `../file-type-registry` (shared
 * with `../file-types`, the other half of a file's type→UI dispatch); this
 * module re-exports the renderer-facing slice so existing imports don't churn.
 */

export {
  type FileData,
  type RendererProps,
  type FileRenderer,
  type FileTypeSelector,
  registerFileType,
  getRenderers,
} from "../file-type-registry";
