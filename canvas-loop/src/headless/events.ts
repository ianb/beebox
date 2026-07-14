import { EventScriptError } from "./errors.js";
import type { Sketch, SketchModule } from "./sketch.js";
import type { EventType, SketchEvent, SketchInputEvent } from "../core/types.js";

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "mousedown",
  "mouseup",
  "mousemove",
  "keydown",
  "keyup",
]);

/**
 * A scripted snapshot: force a capture of `frame` without dispatching to any
 * handler or touching input state. `label` (if present) flows to the transcript
 * frame heading. Same shape in both tiers.
 */
export interface SnapshotDirective {
  frame: number;
  type: "snapshot";
  label?: string;
}

/** One entry in a mutable-tier events script: a scripted input or a snapshot. */
export type ScriptEvent = SketchEvent | SnapshotDirective;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.has(value);
}

function readOptionalLabel(record: Record<string, unknown>, where: string): string | undefined {
  const label = record["label"];
  if (label !== undefined && typeof label !== "string") {
    throw new EventScriptError({ detail: `${where}: "label" must be a string` });
  }
  return label;
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

function parseEvent(raw: unknown, index: number): ScriptEvent {
  const where = `event[${index}]`;
  if (!isRecord(raw)) {
    throw new EventScriptError({ detail: `${where} must be an object` });
  }
  const frame = raw["frame"];
  if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
    throw new EventScriptError({ detail: `${where}: "frame" must be a non-negative integer` });
  }
  const type = raw["type"];
  if (type === "snapshot") {
    const directive: SnapshotDirective = { frame, type: "snapshot" };
    const label = readOptionalLabel(raw, where);
    if (label !== undefined) directive.label = label;
    return directive;
  }
  if (typeof type !== "string" || !isEventType(type)) {
    throw new EventScriptError({
      detail: `${where}: "type" must be one of mousedown|mouseup|mousemove|keydown|keyup|snapshot`,
    });
  }
  const key = raw["key"];
  if (key !== undefined && typeof key !== "string") {
    throw new EventScriptError({ detail: `${where}: "key" must be a string` });
  }
  const event: SketchEvent = { frame, type };
  const x = readOptionalNumber({ record: raw, key: "x", where });
  const y = readOptionalNumber({ record: raw, key: "y", where });
  if (x !== undefined) event.x = x;
  if (y !== undefined) event.y = y;
  if (key !== undefined) event.key = key;
  return event;
}

/** Validate and normalize the parsed events JSON into an ordered event list. */
export function parseEvents(raw: unknown): ScriptEvent[] {
  if (!Array.isArray(raw)) {
    throw new EventScriptError({ detail: "top level must be a JSON array of events" });
  }
  return raw.map((entry, index) => parseEvent(entry, index));
}

/** Group events by frame, preserving file order within each frame. */
export function bucketByFrame(events: readonly ScriptEvent[]): Map<number, ScriptEvent[]> {
  const byFrame = new Map<number, ScriptEvent[]>();
  for (const event of events) {
    const list = byFrame.get(event.frame);
    if (list === undefined) byFrame.set(event.frame, [event]);
    else list.push(event);
  }
  return byFrame;
}

function inputArg(sketch: Sketch, event: SketchEvent): SketchInputEvent {
  return { type: event.type, x: sketch.mouseX, y: sketch.mouseY, key: event.key ?? "" };
}

function applyCoords(sketch: Sketch, event: SketchEvent): void {
  if (event.x !== undefined) sketch.mouseX = event.x;
  if (event.y !== undefined) sketch.mouseY = event.y;
}

/**
 * Apply one scripted event to the sketch's input state and dispatch it through
 * the same handler path a real UI would use. A move while the mouse is pressed
 * fires mouseDragged; otherwise mouseMoved.
 */
export function dispatchEvent(params: { sketch: Sketch; module: SketchModule; event: SketchEvent }): void {
  const { sketch, module, event } = params;
  switch (event.type) {
    case "mousemove": {
      applyCoords(sketch, event);
      const arg = inputArg(sketch, event);
      if (sketch.mouseIsPressed) module.mouseDragged?.(sketch, arg);
      else module.mouseMoved?.(sketch, arg);
      return;
    }
    case "mousedown": {
      applyCoords(sketch, event);
      sketch.mouseIsPressed = true;
      module.mousePressed?.(sketch, inputArg(sketch, event));
      return;
    }
    case "mouseup": {
      applyCoords(sketch, event);
      sketch.mouseIsPressed = false;
      module.mouseReleased?.(sketch, inputArg(sketch, event));
      return;
    }
    case "keydown": {
      if (event.key !== undefined) sketch.keysDown.add(event.key);
      module.keyPressed?.(sketch, inputArg(sketch, event));
      return;
    }
    case "keyup": {
      if (event.key !== undefined) sketch.keysDown.delete(event.key);
      module.keyReleased?.(sketch, inputArg(sketch, event));
      return;
    }
  }
}
