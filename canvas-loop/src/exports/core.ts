// canvas-loop core (the "." export): the zero-heavy-dependency authoring
// surface — the TEA contract, parameter/message types, the drawing-data types,
// the seeded PRNG, and the scripted input-event types. Nothing here pulls
// @napi-rs/canvas, `webgpu` or any node: builtin at runtime, so a bare Node
// process can import this entry without resolving a native backend. The headless runner lives behind the "./headless"
// subpath; the ESLint plugin behind "./eslint".

export * from "../core/tea.js";
export { isPathShape } from "../core/paint.js";
export { SeededRandom } from "../core/prng.js";
export { formatArgs, formatValue } from "../core/format.js";
export type { LogLevel, SketchHost } from "../core/types.js";
