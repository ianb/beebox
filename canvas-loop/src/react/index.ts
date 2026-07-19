// canvas-loop React display component (the "./react" export): mounts the browser
// TEA runner as a React component. This layer is mounting + prop plumbing +
// lifecycle only — the runtime, view, and generated controls are the single
// browser implementation, imported, not re-implemented. `react` is an OPTIONAL
// peer dependency: nothing in the package root or "./eslint" reaches this
// subpath, so a consumer that never imports "./react" never needs React.
export { SketchFigure } from "./SketchFigure.js";
export { SketchFigure as default } from "./SketchFigure.js";
export type { SketchFigureProps, ParamRecord } from "./SketchFigure.js";
