// The View's pure helpers, which compute values and record nothing: curve
// paths, tubes, offsets, gradients, tweens, easing and `toCanvas`, as today's View has them.
// Below them, the members the scene API removed (removed.ts).
import { curveCommands } from "../../core/contours.js";
import { ease, tween, tweenPoint } from "../../core/ease.js";
import type { EaseName, Keyframe } from "../../core/ease.js";
import { ellipseGradient, linearGradient, radialGradient } from "../../core/paint.js";
import type { ColorStop, LinearGradient, PathCommand, RadialGradient, Vec2 } from "../../core/paint.js";
import { offsetPoints, tubePath } from "../../core/shapes.js";
import type { TubeOptions } from "../../core/shapes.js";
import { SketchUsageError } from "../../core/errors.js";
import type { AtOptions } from "../../core/tea.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import { checkAt } from "./checks.js";
import { RemovedCalls } from "./removed.js";

export class PureHelpers extends RemovedCalls {
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[] {
    return curveCommands(points, closed ?? false);
  }
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
    return tubePath(points, options);
  }
  offset(points: readonly Vec2[], distance: number): Vec2[] {
    return offsetPoints(points, distance);
  }
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    return linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return radialGradient(...args);
  }
  ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
    return ellipseGradient(...args);
  }
  tween(...args: [readonly Keyframe<number>[], number, EaseName?]): number {
    return tween(...args);
  }
  tweenPoint(...args: [readonly Keyframe<readonly number[]>[], number, EaseName?]): number[] {
    return tweenPoint(...args);
  }
  ease(name: EaseName, u: number): number {
    return ease(name, u);
  }
  /** `point` under each scope's transform, innermost first, as the walk composes them. */
  toCanvas(point: Vec2, scopes: readonly AtOptions[]): Vec2 {
    if (!Array.isArray(scopes)) throw new SketchUsageError({ detail: "toCanvas(point, scopes): list the at options the point is inside, outermost first, e.g. v.toCanvas([0, 33], [{ translate: [x, y] }, { rotate: a }])" });
    let matrix = IDENTITY;
    for (const options of scopes) {
      checkAt(options);
      matrix = mul(matrix, matrixOf(options));
    }
    return apply(matrix, point);
  }
}
