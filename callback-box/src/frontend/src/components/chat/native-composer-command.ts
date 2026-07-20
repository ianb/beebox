import type { AddSelectionInput } from "../../lib/selection/position";
import { postNativeMessage, type NativeShellWindow } from "./native-post";

export interface NativeComposerCommand {
  version: 1;
  id: string;
  kind: "add-selection";
  selection: AddSelectionInput;
}

export type NativeComposerCommandAcknowledgement =
  | { version: 1; id: string; accepted: true }
  | { version: 1; id: string; accepted: false; reason: string };

declare global {
  interface Window {
    callbackboxNativePost?: NativeShellWindow["callbackboxNativePost"];
    callbackboxNativeComposerCommandAckQueue?: unknown[];
    webkit?: NativeShellWindow["webkit"];
  }
}

export function createNativeAddSelectionCommand(
  id: string,
  selection: AddSelectionInput,
): NativeComposerCommand {
  return { version: 1, id, kind: "add-selection", selection };
}

export function nativeComposerCommandFromDetail(detail: unknown): NativeComposerCommand | null {
  if (
    typeof detail !== "object"
    || detail === null
    || Array.isArray(detail)
    || !("version" in detail)
    || detail.version !== 1
    || !("id" in detail)
    || typeof detail.id !== "string"
    || detail.id.trim() === ""
    || !("kind" in detail)
    || detail.kind !== "add-selection"
    || !("selection" in detail)
    || typeof detail.selection !== "object"
    || detail.selection === null
    || Array.isArray(detail.selection)
  ) {
    return null;
  }
  const { selection } = detail;
  if (
    !("ref" in selection)
    || typeof selection.ref !== "string"
    || !("text" in selection)
    || typeof selection.text !== "string"
    || !("position" in selection)
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

export function nativeComposerCommandAcknowledgementFromDetail(
  detail: unknown,
): NativeComposerCommandAcknowledgement | null {
  if (
    typeof detail !== "object"
    || detail === null
    || Array.isArray(detail)
    || !("version" in detail)
    || detail.version !== 1
    || !("id" in detail)
    || typeof detail.id !== "string"
    || detail.id.trim() === ""
    || !("accepted" in detail)
    || typeof detail.accepted !== "boolean"
  ) {
    return null;
  }
  if (detail.accepted) {
    return { version: 1, id: detail.id, accepted: true };
  }
  if (!("reason" in detail) || typeof detail.reason !== "string" || detail.reason.trim() === "") {
    return null;
  }
  return { version: 1, id: detail.id, accepted: false, reason: detail.reason };
}

export function postNativeComposerCommand(
  shell: NativeShellWindow,
  command: NativeComposerCommand,
): void {
  postNativeMessage(shell, { channel: "callbackboxComposerCommand", payload: command });
}
