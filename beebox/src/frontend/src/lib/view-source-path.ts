/**
 * Return the authored-view slug named by a box-relative watcher path.
 *
 * Package-layout boxes keep views in `src/views/`. The historical `views/`
 * spelling remains accepted so older event producers cannot silently strand a
 * mounted frontend during a rolling upgrade.
 */
export function viewSlugFromSourcePath(filePath: string): string | null {
  const match = /^(?:views|src\/views)\/([^/]+)\.tsx$/.exec(filePath);
  return match?.[1] ?? null;
}
