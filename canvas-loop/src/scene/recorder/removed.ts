// The View members the scene API removed (CHANGELOG 0.2.0). They are not
// in the `View` type; the recorder answers them so an old compiled figure
// fails with what to use instead, not with `v.cache is not a function`.
import { RemovedCallError } from "../errors.js";

const PICTURES = "use v.picture({ key, width, height, deps }, body) and v.place(picture, x, y) (TEA.md, \"Pictures\")";

/** Each removed member and what replaces it. */
export const REPLACEMENTS = {
  "v.ctx": "draw with the View's calls; a transform with at({ matrix }) or at({ skew }), pixel fields with v.pixels, hand-built lighting with group({ lighting }) (TEA.md, \"Pictures\"; BRUSHES.md, \"Lighting\")",
  "v.cache": PICTURES,
  "v.sprite": PICTURES,
  "v.image": PICTURES,
  "v.paperTexture": "use group({ effects: { paper: amount } }, children), an effect scoped to the group (BRUSHES.md, \"Paper\")",
} as const;

function removed(call: keyof typeof REPLACEMENTS): never {
  throw new RemovedCallError({ call, replacement: REPLACEMENTS[call] });
}

/** The removed members, each throwing `RemovedCallError`. */
export class RemovedCalls {
  get ctx(): never {
    return removed("v.ctx");
  }
  cache(): never {
    return removed("v.cache");
  }
  sprite(): never {
    return removed("v.sprite");
  }
  image(): never {
    return removed("v.image");
  }
  paperTexture(): never {
    return removed("v.paperTexture");
  }
}
