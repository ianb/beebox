// The path of the node being lowered (draft section 10), for render errors:
// `group "room" > place picture "citizen" > circle #4`. Lowering keeps one
// name per open node; an error raised inside a node that does not fit the
// renderer becomes a `GpuRenderError` naming the path (the innermost node,
// where it was raised), with the original as its cause.
import type { SceneNode } from "../scene/nodes.js";
import { GpuRenderError, UnsupportedCallError } from "../scene/errors.js";

/** A node's name in a path: its group name or picture key when it has one, else its call and place among its siblings (1-based). */
export function nodeName(n: SceneNode, index: number): string {
  switch (n.kind) {
    case "group":
      return n.name === undefined ? `group #${index}` : `group ${JSON.stringify(n.name)}`;
    case "place":
      return `place ${n.picture.kind} ${JSON.stringify(n.picture.key)}`;
    case "shape":
      return `${n.call} #${index}`;
    case "background":
    case "at":
    case "clip":
    case "mask":
    case "text":
    case "debug":
    case "light":
      return `${n.kind} #${index}`;
  }
}

/** `error`, raised while lowering the node at `path`, as a render error naming the path; undefined for an error that is not the renderer's or already names one. */
export function atPath(error: unknown, path: readonly string[]): GpuRenderError | undefined {
  if (path.length === 0) return undefined;
  const where = path.join(" > ");
  if (error instanceof GpuRenderError && error.path === undefined) return new GpuRenderError({ detail: error.message.replace(/^GPU renderer: /, ""), path: where, cause: error });
  if (error instanceof UnsupportedCallError) return new GpuRenderError({ detail: `${error.name}: ${error.message}`, path: where, cause: error });
  return undefined;
}

/** The open nodes while lowering; their names are made only for an error. */
export class NodePath {
  readonly #open: { readonly n: SceneNode; readonly index: number }[] = [];

  /** Lower node `n` (sibling `index`, 1-based) with `lower`; an error inside it names the path. */
  inside(n: SceneNode, a: { index: number; lower: () => void }): void {
    this.#open.push({ n, index: a.index });
    try {
      a.lower();
    } catch (error: unknown) {
      const pathed = atPath(error, this.#open.map((o) => nodeName(o.n, o.index)));
      if (pathed !== undefined) throw pathed;
      throw error;
    } finally {
      this.#open.pop();
    }
  }
}
