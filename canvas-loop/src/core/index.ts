// canvas-loop core (the "." export): the zero-heavy-dependency authoring and
// drawing surface — the TEA contract, parameter/message types, the context-
// generic Painter, the drawing-data types, the seeded PRNG, and the scripted
// input-event types. Nothing here pulls @napi-rs/canvas or any node: builtin at
// runtime (the one @napi-rs reference, `View.ctx`'s type, is type-only and
// erased), so a bare Node process can import this entry without resolving the
// native canvas backend. The headless runner lives behind the "./headless"
// subpath; the ESLint plugin behind "./eslint".

export * from "./tea.js";
export { isPathShape, resolveGradient, tracePath, tracePolygon } from "./paint.js";
export type { Ctx2D, Ctx2DGradient, CtxTextAlign, CtxTextBaseline } from "./paint.js";
export { Painter } from "./painter.js";
export { SeededRandom } from "./prng.js";
export { formatArgs, formatValue } from "./format.js";
export type { EventType, LogLevel, SketchEvent, SketchHost, SketchInputEvent } from "./types.js";

// Mutable-tier authoring types. Re-exported type-only so a mutable sketch can
// name `Sketch`/`SketchInputEvent` from the single "@ianbicking/canvas-loop"
// specifier its lint discipline allows. `Sketch` is a headless, @napi-rs-backed
// class, but a type-only re-export is fully erased at runtime — importing "."
// still never loads the headless module or the native backend.
export type { Sketch, SketchEventHandler, SketchModule } from "../headless/sketch.js";
