// The shape the browser runtime consumes a sketch through — the same contract
// the CLI's LoadedTeaModule expresses, but for statically-imported (rather than
// dynamically-loaded) modules. A sketch's own `update`/`draw` are typed against
// `DeepReadonly<Model>`; the runtime treats the model as opaque `unknown`, so the
// registry adapts each module across that one variance boundary (see registry.ts).
import type { CanvasSize, Msg, ParamsDecl, ParamValues, Util, View } from "../src/core/tea.js";

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

/**
 * Adapt a statically-imported sketch namespace to `PlaygroundModule`. A sketch's
 * `init`/`update`/`draw` are typed with `DeepReadonly<Model>`, compatible with
 * the runtime's opaque-`unknown` model contract but not variance-assignable — so
 * this is the single blessed boundary cast (registry, demo, and tests reuse it
 * rather than each repeating the disable).
 */
export function asPlaygroundModule(raw: object): PlaygroundModule {
  // eslint-disable-next-line no-restricted-syntax -- contract boundary: a sketch's init/update/draw are typed with DeepReadonly<Model>, compatible with the runtime's opaque-model contract but not variance-assignable
  return raw as unknown as PlaygroundModule;
}
