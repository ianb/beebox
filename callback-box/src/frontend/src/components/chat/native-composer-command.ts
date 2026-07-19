import type { AddSelectionInput } from "../../lib/selection/position";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface NativeComposerCommand {
  version: 1;
  id: string;
  kind: "add-selection";
  selection: AddSelectionInput;
}

export function createNativeAddSelectionCommand(
  id: string,
  selection: AddSelectionInput,
): NativeComposerCommand {
  return { version: 1, id, kind: "add-selection", selection };
}

export function nativeComposerCommandFromDetail(detail: unknown): NativeComposerCommand | null {
  if (
    !isRecord(detail)
    || detail.version !== 1
    || typeof detail.id !== "string"
    || detail.id.trim() === ""
    || detail.kind !== "add-selection"
    || !isRecord(detail.selection)
  ) {
    return null;
  }
  const { selection } = detail;
  if (
    typeof selection.ref !== "string"
    || typeof selection.text !== "string"
    || typeof selection.position !== "string"
  ) {
    return null;
  }
  return createNativeAddSelectionCommand(detail.id, {
    ref: selection.ref,
    text: selection.text,
    position: selection.position,
  });
}
