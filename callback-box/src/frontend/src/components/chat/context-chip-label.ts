/**
 * Face-label chooser for the chat header's context chip — a pure function so
 * the `landmarkLabel` × `dir` state space is doctestable without React (see
 * test/frontend/context-chip-label.doctest.md).
 *
 * `dir` is a real tri-state, not "string or absent": `null` means the chat
 * has no context (no bound directory) and `""` means the context IS the box
 * root — the empty string must never fall through to the no-context label
 * (see `SessionListButton.tsx:99` for the same distinction elsewhere).
 */

export interface ContextChipLabelInput {
  /** The bound landmark's label, or null when there is none (or it hasn't loaded yet). */
  landmarkLabel: string | null;
  /** Box-relative context dir: `""` for root, `null` for no context. */
  dir: string | null;
}

/**
 * Landmark label wins when present. Otherwise falls back to `dir`'s
 * basename, "Box root" for the root dir (`""`), or "Files" when there's no
 * context at all (`null`). The fallback chain means a slow/failed landmark
 * query never blocks the face from rendering something immediately — the
 * label is an upgrade, not a dependency.
 */
export function contextChipLabel({ landmarkLabel, dir }: ContextChipLabelInput): string {
  // "" is treated as absent, not as a label: a label that renders as
  // nothing would leave the face blank (caret-only pill).
  if (landmarkLabel !== null && landmarkLabel !== "") return landmarkLabel;
  if (dir === null) return "Files";
  if (dir === "") return "Box root";
  return dir.split("/").pop() ?? dir;
}
