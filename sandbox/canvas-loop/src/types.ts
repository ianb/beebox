import type { Sketch } from "./sketch.js";

/** Console/log channel a line came from. */
export type LogLevel = "log" | "warn" | "error";

/**
 * The runtime object a Sketch talks back to: log lines and snapshot requests
 * are recorded against whatever frame is currently executing.
 */
export interface SketchHost {
  recordLog(entry: { level: LogLevel; message: string }): void;
  requestSnapshot(label: string | undefined): void;
}

/** The five scripted input event kinds. */
export type EventType = "mousedown" | "mouseup" | "mousemove" | "keydown" | "keyup";

/** One entry in the events JSON script. */
export interface SketchEvent {
  frame: number;
  type: EventType;
  x?: number;
  y?: number;
  key?: string;
}

/** The event object handed to a sketch's input handlers. */
export interface SketchInputEvent {
  type: EventType;
  x: number;
  y: number;
  key: string;
}

/** A sketch's input handler (mousePressed, keyReleased, …). */
export type SketchEventHandler = (s: Sketch, e: SketchInputEvent) => void;

/** A loaded sketch module: required setup/draw plus optional input handlers. */
export interface SketchModule {
  setup: (s: Sketch) => void;
  draw: (s: Sketch) => void;
  mousePressed?: SketchEventHandler;
  mouseReleased?: SketchEventHandler;
  mouseMoved?: SketchEventHandler;
  mouseDragged?: SketchEventHandler;
  keyPressed?: SketchEventHandler;
  keyReleased?: SketchEventHandler;
}
