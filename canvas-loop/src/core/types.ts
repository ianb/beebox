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

// `SketchEventHandler` and `SketchModule` reference the mutable-tier `Sketch`
// class (a headless, @napi-rs/canvas-backed type), so they live in
// headless/sketch.ts — core stays free of any headless/native dependency edge.
