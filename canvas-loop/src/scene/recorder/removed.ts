// The View members the scene API removed (CHANGELOG 0.2.0). They are not
// in the `View` type; the recorder answers them so an old compiled figure
// fails with what to use instead, not with `v.cache is not a function`.
import { RemovedCallError, REPLACEMENTS } from "../errors.js";

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
