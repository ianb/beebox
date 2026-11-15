// What one `draw` produces (draft section 8): the scene and the kept outputs
// beside it, with the events and testing-mode warnings.
import type { CursorKind } from "../../core/tea.js";
import type { Scene, SceneNode } from "../scene.js";
import type { ControlPlacement } from "./controls.js";
import type { DebugBox } from "./debug.js";

/** Everything one `draw` produced (draft section 8), and testing-mode warnings. */
export interface FrameRecord {
  readonly scene: Scene;
  readonly logs: readonly string[];
  /** One entry per `snapshot` call, with its label. */
  readonly snapshots: readonly (string | undefined)[];
  readonly debugBoxes: readonly DebugBox[];
  readonly cursor: CursorKind | undefined;
  /** `v.control` calls in call order (section 8): DOM inputs in the browser. */
  readonly controls: readonly ControlPlacement[];
  /** Headless stand-ins for `controls`, in canvas coordinates, to draw above the scene (decision 9). */
  readonly standIns: readonly SceneNode[];
  readonly warnings: readonly string[];
}
