import type { AddSelectionInput } from "../../lib/selection/position";
import { postNativeMessage, type NativeShellWindow } from "./native-post";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function nativeComposerCommandAcknowledgementFromDetail(
  detail: unknown,
): NativeComposerCommandAcknowledgement | null {
  if (
    !isRecord(detail)
    || detail.version !== 1
    || typeof detail.id !== "string"
    || detail.id.trim() === ""
    || typeof detail.accepted !== "boolean"
  ) {
    return null;
  }
  if (detail.accepted) {
    return { version: 1, id: detail.id, accepted: true };
  }
  if (typeof detail.reason !== "string" || detail.reason.trim() === "") {
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
