import { EventScriptError } from "./errors.js";
import type { ParamDecl, ParamsDecl } from "../core/tea.js";

/** One entry in a TEA events script: scripted input, a param edit, a trigger, or a snapshot. */
export type TeaScriptEvent =
  | { frame: number; type: "mousedown" | "mouseup" | "mousemove"; x?: number; y?: number }
  | { frame: number; type: "keydown" | "keyup"; key?: string }
  | { frame: number; type: "param"; name: string; value: number | boolean | string }
  | { frame: number; type: "trigger"; name: string }
  | { frame: number; type: "snapshot"; label?: string };

const MOUSE_TYPES: ReadonlySet<string> = new Set(["mousedown", "mouseup", "mousemove"]);
const KEY_TYPES: ReadonlySet<string> = new Set(["keydown", "keyup"]);

function isMouseType(type: string): type is MouseType {
  return MOUSE_TYPES.has(type);
}
function isKeyType(type: string): type is KeyType {
  return KEY_TYPES.has(type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readFrame(record: Record<string, unknown>, where: string): number {
  const frame = record["frame"];
  if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
    throw new EventScriptError({ detail: `${where}: "frame" must be a non-negative integer` });
  }
  return frame;
}

function readOptionalNumber(params: { record: Record<string, unknown>; key: string; where: string }): number | undefined {
  const { record, key, where } = params;
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EventScriptError({ detail: `${where}: "${key}" must be a finite number` });
  }
  return value;
}

function readName(record: Record<string, unknown>, where: string): string {
  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new EventScriptError({ detail: `${where}: "name" must be a non-empty string` });
  }
  return name;
}

function lookupParam(params: { decl: ParamsDecl; name: string; where: string }): ParamDecl {
  const { decl, name, where } = params;
  const found = decl[name];
  if (found === undefined) {
    throw new EventScriptError({ detail: `${where}: no declared param named "${name}"` });
  }
  return found;
}

function validateParamValue(params: { param: ParamDecl; name: string; value: unknown; where: string }): number | boolean | string {
  const { param, name, value, where } = params;
  switch (param.type) {
    case "trigger":
      throw new EventScriptError({
        detail: `${where}: "${name}" is a trigger — use { "type": "trigger", "name": "${name}" }, not a param value`,
      });
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new EventScriptError({ detail: `${where}: param "${name}" expects a finite number` });
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new EventScriptError({ detail: `${where}: param "${name}" expects a boolean` });
      }
      return value;
    case "select":
      if (typeof value !== "string" || !param.options.includes(value)) {
        throw new EventScriptError({
          detail: `${where}: param "${name}" expects one of ${param.options.map((o) => `"${o}"`).join(", ")}`,
        });
      }
      return value;
  }
}

function parseParamEvent(params: { record: Record<string, unknown>; frame: number; decl: ParamsDecl; where: string }): TeaScriptEvent {
  const { record, frame, decl, where } = params;
  const name = readName(record, where);
  const param = lookupParam({ decl, name, where });
  const value = validateParamValue({ param, name, value: record["value"], where });
  return { frame, type: "param", name, value };
}

function parseTriggerEvent(params: { record: Record<string, unknown>; frame: number; decl: ParamsDecl; where: string }): TeaScriptEvent {
  const { record, frame, decl, where } = params;
  const name = readName(record, where);
  const param = lookupParam({ decl, name, where });
  if (param.type !== "trigger") {
    throw new EventScriptError({ detail: `${where}: param "${name}" is a ${param.type}, not a trigger` });
  }
  return { frame, type: "trigger", name };
}

type MouseType = "mousedown" | "mouseup" | "mousemove";
type KeyType = "keydown" | "keyup";

function parseKeyEvent(params: { record: Record<string, unknown>; frame: number; type: KeyType; where: string }): TeaScriptEvent {
  const { record, frame, type, where } = params;
  const key = record["key"];
  if (key !== undefined && typeof key !== "string") {
    throw new EventScriptError({ detail: `${where}: "key" must be a string` });
  }
  const event: TeaScriptEvent = { frame, type };
  if (key !== undefined) event.key = key;
  return event;
}

function parseMouseEvent(params: { record: Record<string, unknown>; frame: number; type: MouseType; where: string }): TeaScriptEvent {
  const { record, frame, type, where } = params;
  const x = readOptionalNumber({ record, key: "x", where });
  const y = readOptionalNumber({ record, key: "y", where });
  const event: TeaScriptEvent = { frame, type };
  if (x !== undefined) event.x = x;
  if (y !== undefined) event.y = y;
  return event;
}

function parseSnapshotEvent(params: { record: Record<string, unknown>; frame: number; where: string }): TeaScriptEvent {
  const { record, frame, where } = params;
  const label = record["label"];
  if (label !== undefined && typeof label !== "string") {
    throw new EventScriptError({ detail: `${where}: "label" must be a string` });
  }
  const event: TeaScriptEvent = { frame, type: "snapshot" };
  if (label !== undefined) event.label = label;
  return event;
}

function parseOne(params: { raw: unknown; index: number; decl: ParamsDecl }): TeaScriptEvent {
  const { raw, index, decl } = params;
  const where = `event[${index}]`;
  if (!isRecord(raw)) {
    throw new EventScriptError({ detail: `${where} must be an object` });
  }
  const frame = readFrame(raw, where);
  const type = raw["type"];
  if (typeof type !== "string") {
    throw new EventScriptError({ detail: `${where}: "type" must be a string` });
  }
  if (type === "param") return parseParamEvent({ record: raw, frame, decl, where });
  if (type === "trigger") return parseTriggerEvent({ record: raw, frame, decl, where });
  if (type === "snapshot") return parseSnapshotEvent({ record: raw, frame, where });
  if (isMouseType(type)) return parseMouseEvent({ record: raw, frame, type, where });
  if (isKeyType(type)) return parseKeyEvent({ record: raw, frame, type, where });
  throw new EventScriptError({
    detail: `${where}: "type" must be one of mousedown|mouseup|mousemove|keydown|keyup|param|trigger|snapshot`,
  });
}

/** Validate and normalize a TEA events JSON array against the sketch's param declaration. */
export function parseTeaEvents(raw: unknown, decl: ParamsDecl): TeaScriptEvent[] {
  if (!Array.isArray(raw)) {
    throw new EventScriptError({ detail: "top level must be a JSON array of events" });
  }
  return raw.map((entry, index) => parseOne({ raw: entry, index, decl }));
}

/** Group events by frame, preserving file order within each frame. */
export function bucketTeaByFrame(events: readonly TeaScriptEvent[]): Map<number, TeaScriptEvent[]> {
  const byFrame = new Map<number, TeaScriptEvent[]>();
  for (const event of events) {
    const list = byFrame.get(event.frame);
    if (list === undefined) byFrame.set(event.frame, [event]);
    else list.push(event);
  }
  return byFrame;
}
