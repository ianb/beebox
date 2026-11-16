// A scope's children (draft 2.11): what a sketch passes is flattened into a
// list the node owns, so changing the sketch's array afterwards changes
// nothing. Nested lists are walked; `null`, `undefined` and `false` are
// skipped, as React skips them. Anything else is refused at the call, so the
// stack names the sketch's line: a number (`count && v.rect(…)` with count 0),
// a string, `true`, a plain object, a node from an earlier frame, and a
// function (the retired body form).
import { SketchUsageError } from "../../core/errors.js";
import { MADE_IN } from "../../core/paint.js";
import { RemovedCallError } from "../errors.js";
import type { SceneNode } from "../nodes.js";

/** A node a drawing call made: only the recorder stamps `MADE_IN`. */
function isNode(x: object): x is SceneNode & { readonly [MADE_IN]: object } {
  return MADE_IN in x;
}

/** The scope calls, whose retired form took a body function. */
const SCOPES = new Set(["at", "group", "clip", "mask", "paper"]);

function described(x: unknown): string {
  if (typeof x === "number") return `the number ${String(x)} (a condition like \`count && v.rect(…)\` gives 0 when count is 0; write \`count > 0 && …\`)`;
  if (typeof x === "string") return `the string ${JSON.stringify(x.slice(0, 24))} (draw text with v.text)`;
  if (x === true) return "true (a condition like `ok || v.rect(…)` gives true; use `ok ? null : v.rect(…)`)";
  if (typeof x === "object") return "an object that is not a drawing (a drawing is what a v call returns)";
  return `a ${typeof x}`;
}

/** What the recorder lends: the current frame, and a note that a node has been put somewhere (testing mode's made-but-not-returned count). */
export interface ChildrenDeps {
  readonly frame: () => object;
  readonly taken: (node: SceneNode) => void;
}

export class Children {
  readonly #d: ChildrenDeps;

  constructor(deps: ChildrenDeps) {
    this.#d = deps;
  }

  /** `children` of `call` flattened into a new list of this frame's nodes. */
  list(call: string, children: unknown): SceneNode[] {
    const out: SceneNode[] = [];
    this.#add(children, { call, out, frame: this.#d.frame() });
    return out;
  }

  #add(x: unknown, a: { call: string; out: SceneNode[]; frame: object }): void {
    if (x === null || x === undefined || x === false) return;
    if (Array.isArray(x)) {
      for (const child of x) this.#add(child, a);
      return;
    }
    if (typeof x === "function") {
      if (SCOPES.has(a.call)) throw new RemovedCallError({ call: `${a.call}(${a.call === "mask" ? "mask art" : "options"}, body function)`, replacement: `${a.call} takes its children as a list: v.${a.call}(…, [v.rect(…), …])` });
      throw new SketchUsageError({ detail: `${a.call}: a function is not a drawing; call it and use what it returns` });
    }
    if (typeof x === "object" && isNode(x)) {
      if (x[MADE_IN] !== a.frame) throw new SketchUsageError({ detail: `${a.call}: this drawing was made in an earlier frame; make it again in draw, or record it once as a picture` });
      this.#d.taken(x);
      a.out.push(x);
      return;
    }
    throw new SketchUsageError({ detail: `${a.call}: a child must be a drawing (what a v call returns), a list of them, or null, undefined or false for nothing; got ${described(x)}` });
  }
}
