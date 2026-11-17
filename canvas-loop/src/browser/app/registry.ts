// The examples bundled into the playground, in the order README.md lists them.
// Each is imported as a namespace (init/update/draw/params/canvas) and adapted
// to PlaygroundModule across the one variance boundary between a sketch's
// `DeepReadonly<Model>` signatures and the runtime's opaque-model contract —
// the browser analog of the CLI's tea-load. Sketch modules are imported
// UNCHANGED. test/browser/app/registry.test.ts holds it to src/examples/.
import * as bounce from "../../examples/bounce-tea.js";
import * as orbit from "../../examples/orbit-tea.js";
import * as scale from "../../examples/scale-tea.js";
import * as answerBox from "../../examples/answer-box-tea.js";
import * as sound from "../../examples/sound-tea.js";
import * as brushes from "../../examples/brushes-tea.js";
import * as paintMixing from "../../examples/paint-mixing-tea.js";
import * as looks from "../../examples/looks-tea.js";
import * as effects from "../../examples/effects-tea.js";
import * as nightRoom from "../../examples/night-room-tea.js";
import type { RegistryEntry } from "../sketch-types.js";
import { asPlaygroundModule } from "../sketch-types.js";

export const REGISTRY: readonly RegistryEntry[] = [
  { id: "bounce", label: "Bounce", module: asPlaygroundModule(bounce) },
  { id: "orbit", label: "Orbit", module: asPlaygroundModule(orbit) },
  { id: "scale", label: "Scale", module: asPlaygroundModule(scale) },
  { id: "answer-box", label: "Answer box", module: asPlaygroundModule(answerBox) },
  { id: "sound", label: "Sound", module: asPlaygroundModule(sound) },
  { id: "brushes", label: "Brushes", module: asPlaygroundModule(brushes) },
  { id: "paint-mixing", label: "Paint mixing", module: asPlaygroundModule(paintMixing) },
  { id: "looks", label: "Looks", module: asPlaygroundModule(looks) },
  { id: "effects", label: "Effects", module: asPlaygroundModule(effects) },
  { id: "night-room", label: "Night room", module: asPlaygroundModule(nightRoom) },
];
