// The sketches bundled into the playground. Each is imported as a namespace
// (init/update/draw/params/canvas) and adapted to PlaygroundModule across the
// one variance boundary between a sketch's `DeepReadonly<Model>` signatures and
// the runtime's opaque-model contract — the browser analog of the CLI's
// tea-load. Sketch modules are imported UNCHANGED.
import * as clock from "../gallery/clock/sketch-tea.js";
import * as particles from "../gallery/particles-opus/sketch-tea.js";
import * as pelican from "../gallery/pelican-bicycle/sketch-tea.js";
import * as fjord from "../examples/fjord-tea.js";
import * as orbit from "../examples/orbit-tea.js";
import type { RegistryEntry } from "./sketch-types.js";
import { asPlaygroundModule } from "./sketch-types.js";

export const REGISTRY: readonly RegistryEntry[] = [
  { id: "orbit", label: "Orbit", module: asPlaygroundModule(orbit) },
  { id: "fjord", label: "Fjord", module: asPlaygroundModule(fjord) },
  { id: "particles", label: "Particles", module: asPlaygroundModule(particles) },
  { id: "clock", label: "Clock", module: asPlaygroundModule(clock) },
  { id: "pelican", label: "Pelican", module: asPlaygroundModule(pelican) },
];
