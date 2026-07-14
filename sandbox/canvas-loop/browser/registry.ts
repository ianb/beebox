// The sketches bundled into the playground. Each is imported as a namespace
// (init/update/draw/params/canvas) and adapted to PlaygroundModule across the
// one variance boundary between a sketch's `DeepReadonly<Model>` signatures and
// the runtime's opaque-model contract — the browser analog of the CLI's
// tea-load. Sketch modules are imported UNCHANGED.
import * as clock from "../experiments/clock-sonnet-tea.js";
import * as particles from "../experiments/particles-opus-tea.js";
import * as pelican from "../experiments/pelican-sonnet-tea.js";
import * as fjord from "../examples/fjord-tea.js";
import * as orbit from "../examples/orbit-tea.js";
import type { PlaygroundModule, RegistryEntry } from "./sketch-types.js";

function toModule(raw: object): PlaygroundModule {
  // eslint-disable-next-line no-restricted-syntax -- contract boundary: a sketch's init/update/draw are typed with DeepReadonly<Model>, compatible with the runtime's opaque-model contract but not variance-assignable
  return raw as unknown as PlaygroundModule;
}

export const REGISTRY: readonly RegistryEntry[] = [
  { id: "orbit", label: "Orbit", module: toModule(orbit) },
  { id: "fjord", label: "Fjord", module: toModule(fjord) },
  { id: "particles", label: "Particles", module: toModule(particles) },
  { id: "clock", label: "Clock", module: toModule(clock) },
  { id: "pelican", label: "Pelican", module: toModule(pelican) },
];
