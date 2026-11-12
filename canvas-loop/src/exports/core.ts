// canvas-loop core (the "." export): the zero-heavy-dependency authoring and
// drawing surface — the TEA contract, parameter/message types, the context-
// generic Painter, the drawing-data types, the seeded PRNG, and the scripted
// input-event types. Nothing here pulls @napi-rs/canvas or any node: builtin at
// runtime (the one @napi-rs reference, `View.ctx`'s type, is type-only and
// erased), so a bare Node process can import this entry without resolving the
// native canvas backend. The headless runner lives behind the "./headless"
// subpath; the ESLint plugin behind "./eslint".

export * from "../core/tea.js";
export { isPathShape, resolveGradient, tracePath, tracePolygon } from "../core/paint.js";
export type { Ctx2D, Ctx2DGradient, CtxTextAlign, CtxTextBaseline, TextBounds, TextBox, TextOptions } from "../core/paint.js";
export { Painter } from "../core/painter/engine.js";
export { SeededRandom } from "../core/prng.js";
export { formatArgs, formatValue } from "../core/format.js";
export type { LogLevel, SketchHost } from "../core/types.js";

