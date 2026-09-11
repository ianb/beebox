/**
 * The web→native command envelope and the two native→web answers to it.
 *
 * **V1** is the original selection command: `{version:1,id,kind:"add-selection",
 * selection}`, with `selection` at the top level and required. It is still what
 * the web *sends* for a selection, because installed iOS builds decode that
 * shape and nothing else — a version bump there would break the companion
 * selection flow on every phone that has not updated.
 *
 * **V2** is the extensible envelope (`docs/plans/agent-points-at-ui.md`,
 * Track 5): `{version:2,id,kind,payload?}`, where `kind` discriminates a payload
 * union. It exists because V1 cannot carry a command that has no selection —
 * `NativeComposerContract.swift` decodes `selection` unconditionally — and
 * because the acknowledgement has no room for an answer. `scan-controls` is the
 * first V2 member; `point-at-control` is the next, and both the Swift `Kind`
 * enum and the union here are written so adding it is a compile error until
 * every switch handles it.
 *
 * An **old iOS build** receiving a V2 command fails its `version == 1` guard,
 * `receiveComposerCommand`'s `try?` erases the error, and — because the envelope
 * always carries a non-empty `id` — it answers with a *rejection acknowledgement*
 * rather than silence. The web treats that and "no answer at all" identically
 * (see `native-control-scan.ts`), so an old build is reported as
 * `coverage: "dom-native-unavailable"` and never as an empty inventory.
 *
 * The answer travels on its own channel, not on the acknowledgement: the ack
 * stays `accepted`/`rejected` (whether native took the command), and the result
 * says what the command produced, so a rejection carrying a reason and a
 * successful *empty* inventory stay distinguishable. Contract:
 * `docs/mobile-contract.md` §4.7 (V1 command + ack) and §4.8 (V2 + result).
 */

import type { AddSelectionInput } from "../../lib/selection/position";
import { postNativeMessage, type NativeShellWindow } from "./native-post";
import type { ControlAction } from "../../lib/ui-scan/types";

/** Command kinds the envelope carries. V1 has only `add-selection`. */
export type NativeComposerCommandKind = "add-selection" | "scan-controls" | "point-at-control";

/**
 * Which native control to act on, and how. The envelope's own `id` is the
 * command id; this `id` is the `bbx-` address of the control — the same string
 * the DOM half would have passed to `getElementById`.
 */
export interface NativePointTarget {
  id: string;
  action: ControlAction;
}

/**
 * A command the web posts on `beeboxComposerCommand`.
 *
 * The `id` is non-empty by construction in every member: it is what lets an old
 * build's failed decode answer with a rejection instead of returning silently.
 */
export type NativeComposerCommand =
  | { version: 1; id: string; kind: "add-selection"; selection: AddSelectionInput }
  | { version: 2; id: string; kind: "add-selection"; payload: AddSelectionInput }
  | { version: 2; id: string; kind: "scan-controls" }
  | { version: 2; id: string; kind: "point-at-control"; payload: NativePointTarget };

export type NativeComposerCommandAcknowledgement =
  | { version: 1; id: string; accepted: true }
  | { version: 1; id: string; accepted: false; reason: string };

/** One native control the shell's registry reported, as it crosses the wire. */
export interface NativeControlEntry {
  /** The shared `bbx-` address — the same string the web uses for its own copy. */
  id: string;
  /** The ARIA role vocabulary, so native and DOM entries read alike in the dump. */
  role: "button" | "textbox";
  /** The control's accessible label, read live from the registry. */
  label: string;
  /** Author-written "what it does"; Swift omits the key when it is nil. */
  does: string | null;
  /** The native surface this control belongs to — the dump groups by it. */
  container: string;
  /** On screen but not operable right now. */
  disabled: boolean;
  /**
   * What this control can be asked to do. Every registered control can be
   * pointed at; `focus` and `reveal` appear only where the shell has an honest
   * native meaning for them (first responder, and the sheet the control opens).
   *
   * An installed build older than `point-at-control` omits the key entirely and
   * is read as `[]` — it can enumerate a control but cannot act on one, and the
   * dump prints such an entry without a `control:` link rather than handing out
   * a pointer that would break on click.
   */
  actions: ControlAction[];
}

/**
 * What a V2 command produced. `ok` is the discriminant rather than the presence
 * of a field, so an empty successful inventory (`controls: []`) cannot be
 * mistaken for a failure.
 */
export type NativeCommandResult =
  | { version: 2; id: string; kind: "scan-controls"; ok: true; controls: NativeControlEntry[] }
  | { version: 2; id: string; kind: "point-at-control"; ok: true }
  | { version: 2; id: string; kind: NativeComposerCommandKind; ok: false; reason: string };

declare global {
  interface Window {
    beeboxNativePost?: NativeShellWindow["beeboxNativePost"];
    beeboxNativeComposerCommandAckQueue?: unknown[];
    beeboxNativeCommandResultQueue?: unknown[];
    webkit?: NativeShellWindow["webkit"];
  }
}

export function createNativeAddSelectionCommand(
  id: string,
  selection: AddSelectionInput,
): NativeComposerCommand {
  return { version: 1, id, kind: "add-selection", selection };
}

/** The V2 request for the native control inventory. Carries no payload. */
export function createNativeScanControlsCommand(id: string): NativeComposerCommand {
  return { version: 2, id, kind: "scan-controls" };
}

/** The V2 request to act on one native control — the native half of a `control:` link. */
export function createNativePointAtControlCommand(
  id: string,
  target: NativePointTarget,
): NativeComposerCommand {
  return { version: 2, id, kind: "point-at-control", payload: target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * `{ref,text,position}` — the V1 and V2 selection payload. `text`/`position`
 * are required strings; `ref` is a string or null (chat-transcript text).
 */
function selectionFrom(value: unknown): AddSelectionInput | null {
  if (!isRecord(value)) return null;
  const { ref, text, position } = value;
  if (ref !== null && typeof ref !== "string") return null;
  if (typeof text !== "string" || typeof position !== "string") {
    return null;
  }
  return { ref, text, position };
}

/**
 * Parse a command detail the way the native side must: V1 strictly, V2 by kind,
 * anything else rejected. Kept on the web side because the golden fixtures under
 * `test/mobile-contract/fixtures/composer-command/` are checked through it.
 */
export function nativeComposerCommandFromDetail(detail: unknown): NativeComposerCommand | null {
  if (!isRecord(detail)) return null;
  const id = nonEmptyString(detail.id);
  if (id === null) return null;
  if (detail.version === 1) {
    if (detail.kind !== "add-selection") return null;
    const selection = selectionFrom(detail.selection);
    return selection === null ? null : createNativeAddSelectionCommand(id, selection);
  }
  if (detail.version !== 2) return null;
  switch (detail.kind) {
    case "add-selection": {
      const selection = selectionFrom(detail.payload);
      return selection === null ? null : { version: 2, id, kind: "add-selection", payload: selection };
    }
    case "scan-controls":
      return createNativeScanControlsCommand(id);
    case "point-at-control": {
      const target = pointTargetFrom(detail.payload);
      return target === null ? null : createNativePointAtControlCommand(id, target);
    }
    default:
      // An unknown kind is a newer web bundle talking to this parser; refuse it
      // rather than guessing, exactly as the Swift `Kind` decode does.
      return null;
  }
}

export function nativeComposerCommandAcknowledgementFromDetail(
  detail: unknown,
): NativeComposerCommandAcknowledgement | null {
  if (!isRecord(detail) || detail.version !== 1) return null;
  const id = nonEmptyString(detail.id);
  if (id === null || typeof detail.accepted !== "boolean") return null;
  if (detail.accepted) return { version: 1, id, accepted: true };
  const reason = nonEmptyString(detail.reason);
  return reason === null ? null : { version: 1, id, accepted: false, reason };
}

/** `{id,action}` with a known action — the `point-at-control` payload. */
function pointTargetFrom(value: unknown): NativePointTarget | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  if (id === null) return null;
  const action = controlActionFrom(value.action);
  return action === null ? null : { id, action };
}

/**
 * One action name, or null for anything else. Strict on the wire on purpose: an
 * unknown `action=` in a `control:` href degrades to `point` at classification
 * time, so by the time a command is built the value is one of three — a fourth
 * reaching here means a bundle skew, and guessing at it would act on the
 * interface on a guess.
 */
function controlActionFrom(value: unknown): ControlAction | null {
  return value === "point" || value === "focus" || value === "reveal" ? value : null;
}

/** One registry entry, strictly parsed. A malformed entry voids the whole result. */
function nativeControlEntryFrom(value: unknown): NativeControlEntry | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const label = nonEmptyString(value.label);
  const container = nonEmptyString(value.container);
  if (id === null || label === null || container === null) return null;
  if (value.role !== "button" && value.role !== "textbox") return null;
  if (typeof value.disabled !== "boolean") return null;
  // Swift's `JSONEncoder` omits a nil optional rather than writing null, so
  // absent and null both mean "no description".
  const does = value.does === undefined || value.does === null ? null : nonEmptyString(value.does);
  if (value.does !== undefined && value.does !== null && does === null) return null;
  // An older build omits `actions` altogether; that build can enumerate a
  // control but cannot act on one, so absent reads as "none", never as "point".
  const actions = controlActionsFrom(value.actions);
  if (actions === null) return null;
  return { id, role: value.role, label, does, container, disabled: value.disabled, actions };
}

/** The `actions` list, or null when it is present but malformed. */
function controlActionsFrom(value: unknown): ControlAction[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const actions: ControlAction[] = [];
  for (const raw of value) {
    const action = controlActionFrom(raw);
    if (action === null) return null;
    actions.push(action);
  }
  return actions;
}

/** Parse a native→web command result. Never throws; returns null for anything unrecognised. */
export function nativeCommandResultFromDetail(detail: unknown): NativeCommandResult | null {
  if (!isRecord(detail) || detail.version !== 2) return null;
  const id = nonEmptyString(detail.id);
  if (id === null) return null;
  const kind = detail.kind;
  if (kind !== "add-selection" && kind !== "scan-controls" && kind !== "point-at-control") return null;
  if (detail.ok === false) {
    const reason = nonEmptyString(detail.reason);
    return reason === null ? null : { version: 2, id, kind, ok: false, reason };
  }
  if (detail.ok !== true) return null;
  // A successful `point-at-control` carries nothing: the ring is already drawn
  // on the phone, so there is no answer to return beyond "it happened".
  if (kind === "point-at-control") return { version: 2, id, kind, ok: true };
  if (kind !== "scan-controls") return null;
  if (!Array.isArray(detail.controls)) return null;
  const controls: NativeControlEntry[] = [];
  for (const raw of detail.controls) {
    const entry = nativeControlEntryFrom(raw);
    if (entry === null) return null;
    controls.push(entry);
  }
  return { version: 2, id, kind: "scan-controls", ok: true, controls };
}

export function postNativeComposerCommand(
  shell: NativeShellWindow,
  command: NativeComposerCommand,
): void {
  postNativeMessage(shell, { channel: "beeboxComposerCommand", payload: command });
}
