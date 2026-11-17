// The scene the browser runtime hit-tests a pointer message against
// (plan:canvas-loop-layout-text-hits.subplan, Track B), the same as headless:
// for a message at frame N, the scene of the state at the end of frame N−1;
// none at frame 0. The last draw's scene counts when it was drawn from that
// state, so a still figure keeps its constructor's draw. Otherwise (a paused
// draw shows a newer state; several frames ran before one draw) the state is
// recorded again, once, without being shown.
import type { Vec2 } from "../../core/paint.js";
import type { ParamsDecl, ParamValues } from "../../core/tea.js";
import { hitTest } from "../../scene/hit.js";
import type { Hit } from "../../scene/hit.js";
import type { Scene } from "../../scene/nodes.js";

/** The state a scene is drawn from. Both are replaced, never changed, so states compare by reference. */
export interface DrawState {
  readonly model: unknown;
  readonly params: ParamValues<ParamsDecl>;
}

type StateScene = DrawState & { readonly scene: Scene };

const NO_HIT: Hit = { target: undefined, targets: [] };

export class HitScenes {
  readonly #record: (state: DrawState) => Scene;
  #end: DrawState | undefined;
  #drawn: StateScene | undefined;
  #again: StateScene | undefined;

  /** `record` draws a state's scene without showing it. */
  constructor(record: (state: DrawState) => Scene) {
    this.#record = record;
  }

  /** A frame ended in this state; messages of the next frame hit its scene. */
  frameEnded(state: DrawState): void {
    this.#end = state;
  }

  /** A `draw` recorded this scene of this state. */
  drew(drawn: StateScene): void {
    this.#drawn = drawn;
  }

  /** Back to frame 0: no scene until a frame ends. */
  restart(): void {
    this.#end = undefined;
    this.#again = undefined;
  }

  /** The named drawings under `point` (canvas pixels). */
  at(point: Vec2): Hit {
    const scene = this.#scene();
    return scene === undefined ? NO_HIT : hitTest(scene, point);
  }

  #scene(): Scene | undefined {
    const end = this.#end;
    if (end === undefined) return undefined;
    const same = (d: DrawState): boolean => d.model === end.model && d.params === end.params;
    const drawn = this.#drawn;
    if (drawn !== undefined && same(drawn)) return drawn.scene;
    const again = this.#again !== undefined && same(this.#again) ? this.#again : { ...end, scene: this.#record(end) };
    this.#again = again;
    return again.scene;
  }
}
