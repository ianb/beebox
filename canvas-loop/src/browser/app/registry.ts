// The sketches bundled into the playground. Each is imported as a namespace
// (init/update/draw/params/canvas) and adapted to PlaygroundModule across the
// one variance boundary between a sketch's `DeepReadonly<Model>` signatures and
// the runtime's opaque-model contract — the browser analog of the CLI's
// tea-load. Sketch modules are imported UNCHANGED.
import * as fjord from "../../examples/fjord-tea.js";
import * as orbit from "../../examples/orbit-tea.js";
import * as brushes from "../../examples/brushes-tea.js";
import * as paintMixing from "../../examples/paint-mixing-tea.js";
import * as answerBox from "../../examples/answer-box-tea.js";
import * as scale from "../../examples/scale-tea.js";
import type { RegistryEntry } from "../sketch-types.js";
import { asPlaygroundModule } from "../sketch-types.js";

export const REGISTRY: readonly RegistryEntry[] = [
  { id: "brushes", label: "Brushes", module: asPlaygroundModule(brushes) },
  { id: "paint-mixing", label: "Paint mixing", module: asPlaygroundModule(paintMixing) },
  { id: "answer-box", label: "Answer box", module: asPlaygroundModule(answerBox) },
  { id: "scale", label: "Scale", module: asPlaygroundModule(scale) },
  { id: "orbit", label: "Orbit", module: asPlaygroundModule(orbit) },
  { id: "fjord", label: "Fjord", module: asPlaygroundModule(fjord) },
];
