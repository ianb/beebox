// The shape the browser runtime consumes a sketch through — the same contract
// the CLI's LoadedTeaModule expresses, but for statically-imported (rather than
// dynamically-loaded) modules. A sketch's own `update`/`draw` are typed against
// `DeepReadonly<Model>`; the runtime treats the model as opaque `unknown`, so the
// registry adapts each module across that one variance boundary (see registry.ts).
import type { CanvasSize, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

/** A sketch module as the runtime folds it: params/canvas optional, model opaque. */
export interface PlaygroundModule {
  params?: ParamsDecl;
  canvas?: CanvasSize;
  init(u: Util<ParamsDecl>): unknown;
  update(model: unknown, msg: Msg, u: Util<ParamsDecl>): unknown;
  draw(v: View, model: unknown, p: ParamValues<ParamsDecl>): void;
}

/** One selectable sketch in the playground's tab bar. */
export interface RegistryEntry {
  id: string;
  label: string;
  module: PlaygroundModule;
}
