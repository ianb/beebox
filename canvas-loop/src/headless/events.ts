import { EventScriptError } from "./errors.js";
import type { Sketch } from "./sketch.js";
import type { EventType, SketchEvent, SketchInputEvent, SketchModule } from "./types.js";

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "mousedown",
  "mouseup",
  "mousemove",
  "keydown",
  "keyup",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.has(value);
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

function parseEvent(raw: unknown, index: number): SketchEvent {
  const where = `event[${index}]`;
  if (!isRecord(raw)) {
    throw new EventScriptError({ detail: `${where} must be an object` });
  }
  const frame = raw["frame"];
  if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
    throw new EventScriptError({ detail: `${where}: "frame" must be a non-negative integer` });
  }
  const type = raw["type"];
  if (typeof type !== "string" || !isEventType(type)) {
    throw new EventScriptError({
      detail: `${where}: "type" must be one of mousedown|mouseup|mousemove|keydown|keyup`,
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
export function parseEvents(raw: unknown): SketchEvent[] {
  if (!Array.isArray(raw)) {
    throw new EventScriptError({ detail: "top level must be a JSON array of events" });
  }
  return raw.map((entry, index) => parseEvent(entry, index));
}

/** Group events by frame, preserving file order within each frame. */
export function bucketByFrame(events: readonly SketchEvent[]): Map<number, SketchEvent[]> {
  const byFrame = new Map<number, SketchEvent[]>();
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
