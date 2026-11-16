// The resolve walk: one pass over a recorded tree, after `draw` returns (or a
// picture body records), for the checks that need a node's ancestors: the
// transform, the lit groups around it, mask artwork, and the canvas or
// picture box. It runs the effects-scale check, the light warnings, testing
// mode's off-canvas and text checks, the faint-mark sites and the
// placement-scale hint, and lays `keepInside` text out under its transform.
// A node comes back as it was unless its layout changed; a container whose
// children changed comes back as a copy. Warnings name the line each node's
// call kept (testing mode); an error names the node path too.
import type { TextBounds, TextBox, TextOptions } from "../../core/paint.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { CallSite } from "../call-site.js";
import { UnsupportedCallError } from "../errors.js";
import { axisScales, mul } from "../mat.js";
import type { Mat, SceneNode, TextNode } from "../nodes.js";
import { nodeName, versionName } from "../outline.js";
import type { Audit } from "./audit.js";
import { hasOpenLight, lightWarning, noLightWarning } from "./light.js";
import type { RecorderNotes } from "./notes.js";
import { recordText } from "./text.js";

/** Where the walk is: the transform to canvas (or body) coordinates, the box text keeps inside, the picture body's name for messages, lit groups open around it, and mask artwork. */
export interface ResolveContext {
  readonly matrix: Mat;
  readonly size: { readonly width: number; readonly height: number };
  readonly picture: string | undefined;
  readonly lit: number;
  readonly inMask: boolean;
}

/** What a text call kept for the walk: its bounds as laid out at the call, whether it is unboxed, and for `keepInside` its inputs, copied. */
export interface TextFacts {
  readonly bounds: TextBounds;
  readonly unboxed: boolean;
  readonly keep: { readonly box: TextBox; readonly options: TextOptions } | undefined;
}

/** What the recorder lends the walk. `sites` and `audit` are present in testing mode only. */
export interface ResolveDeps {
  readonly notes: RecorderNotes;
  readonly audit: Audit | undefined;
  readonly text: TextMeasurer | undefined;
  readonly texts: WeakMap<TextNode, TextFacts>;
  readonly sites: () => WeakMap<SceneNode, CallSite> | undefined;
}

const NO_SITE: CallSite = { line: undefined };

export class Resolver {
  readonly #d: ResolveDeps;
  /** The containers open around the current node, for an error's node path. */
  readonly #open: { readonly n: SceneNode; readonly index: number }[] = [];

  constructor(deps: ResolveDeps) {
    this.#d = deps;
  }

  /** `nodes` resolved under `ctx`: the same array when no node changed. */
  resolve(nodes: readonly SceneNode[], ctx: ResolveContext): readonly SceneNode[] {
    let out: SceneNode[] | undefined;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n === undefined) continue;
      const r = this.#node(n, { index: i + 1, ctx });
      if (r !== n && out === undefined) out = nodes.slice(0, i);
      out?.push(r);
    }
    return out ?? nodes;
  }

  #site(n: SceneNode): CallSite | undefined {
    return this.#d.sites()?.get(n);
  }

  /** The children of container `n` (sibling `index`) resolved under `ctx`, with `n` on the node path. */
  #inside(n: SceneNode, a: { index: number; nodes: readonly SceneNode[]; ctx: ResolveContext }): readonly SceneNode[] {
    this.#open.push({ n, index: a.index });
    try {
      return this.resolve(a.nodes, a.ctx);
    } finally {
      this.#open.pop();
    }
  }

  /**
   * The effects-scale check for `n`'s effects under `matrix`. Its error names
   * the node path; in testing mode it carries the stack of the call that made
   * `n`, so the transcript lists the sketch's lines as for an error at the call.
   */
  #axes(n: SceneNode, a: { index: number; matrix: Mat; call: string }): void {
    try {
      axisScales(a.matrix, a.call);
    } catch (error: unknown) {
      if (!(error instanceof UnsupportedCallError)) throw error;
      const path = [...this.#open, { n, index: a.index }].map((o) => nodeName(o.n, o.index)).join(" > ");
      const pathed = new UnsupportedCallError({ call: error.call, ...(error.detail === undefined ? {} : { detail: error.detail }), at: path });
      const stack = this.#site(n)?.stack;
      if (stack !== undefined) pathed.stack = [`${pathed.name}: ${pathed.message}`, ...stack.split("\n").slice(1)].join("\n");
      throw pathed;
    }
  }

  /** Where a light here does nothing (R8): mask artwork, or outside any lit group outside a picture body (a body may be placed lit). */
  #unlit(ctx: ResolveContext): "mask" | "unlit" | undefined {
    return ctx.inMask ? "mask" : ctx.lit === 0 && ctx.picture === undefined ? "unlit" : undefined;
  }

  #node(n: SceneNode, a: { index: number; ctx: ResolveContext }): SceneNode {
    const { index, ctx } = a;
    const audit = this.#d.audit;
    switch (n.kind) {
      case "shape":
        if (n.style.effects !== undefined) this.#axes(n, { index, matrix: ctx.matrix, call: n.call });
        if (audit !== undefined) {
          const site = this.#site(n);
          audit.shape(n, { seen: !ctx.inMask, site: site ?? NO_SITE });
          // Checked against the canvas, except in a picture body (placed anywhere) or a mask's artwork.
          if (ctx.picture === undefined && !ctx.inMask) audit.offCanvas.shape(n.call, { geom: n.geom, style: n.style, matrix: ctx.matrix, lit: ctx.lit > 0, site });
        }
        return n;
      case "at": {
        const children = this.#inside(n, { index, nodes: n.children, ctx: { ...ctx, matrix: mul(ctx.matrix, n.matrix) } });
        return children === n.children ? n : { ...n, children };
      }
      case "group":
        return this.#group(n, a);
      case "clip": {
        const children = this.#inside(n, { index, nodes: n.children, ctx });
        return children === n.children ? n : { ...n, children };
      }
      case "mask": {
        const mask = this.#inside(n, { index, nodes: n.mask, ctx: { ...ctx, inMask: true } });
        const body = this.#inside(n, { index, nodes: n.body, ctx });
        return mask === n.mask && body === n.body ? n : { ...n, mask, body };
      }
      case "text":
        return this.#text(n, ctx);
      case "place":
        this.#place(n, ctx);
        return n;
      case "light": {
        const unlit = this.#unlit(ctx);
        const rec = n.light;
        if (unlit !== undefined) this.#d.notes.warnAt(`${unlit} light`, { message: lightWarning(unlit, `light ${rec.kind} at (${rec.at.join(",")})`), line: this.#site(n)?.line });
        return n;
      }
      case "background":
      case "debug":
        return n;
    }
  }

  #group(n: Extract<SceneNode, { kind: "group" }>, a: { index: number; ctx: ResolveContext }): SceneNode {
    const { index, ctx } = a;
    if (n.effects !== undefined) this.#axes(n, { index, matrix: ctx.matrix, call: "group" });
    const offCanvas = this.#d.audit?.offCanvas;
    const outer = offCanvas?.enter(n.effects, ctx.matrix) ?? 0;
    try {
      const children = this.#inside(n, { index, nodes: n.children, ctx: n.lighting === undefined ? ctx : { ...ctx, lit: ctx.lit + 1 } });
      if (n.lighting !== undefined && !hasOpenLight(children)) this.#d.notes.warnAt(`unlit ${n.name ?? ""}`, { message: noLightWarning(n.name, n.lighting), line: this.#site(n)?.line });
      return children === n.children ? n : { ...n, children };
    } finally {
      offCanvas?.leave(outer);
    }
  }

  /** Text: a `keepInside` node is laid out again under its transform and box; testing mode checks it where it lands. */
  #text(n: TextNode, ctx: ResolveContext): TextNode {
    const facts = this.#d.texts.get(n);
    if (facts === undefined) return n;
    let node = n;
    let bounds = facts.bounds;
    const keep = facts.keep;
    if (keep !== undefined && this.#d.text !== undefined) {
      const laid = recordText(n.content, { box: keep.box, options: keep.options, measurer: this.#d.text, matrix: ctx.matrix, canvas: ctx.size });
      ({ node, bounds } = laid);
    }
    const audit = this.#d.audit;
    if (audit !== undefined) {
      const site = this.#site(n) ?? NO_SITE;
      if (ctx.picture === undefined && !ctx.inMask) audit.offCanvas.text(`text ${JSON.stringify(n.content.slice(0, 24))}`, { bounds, matrix: ctx.matrix, unboxed: facts.unboxed, site });
      audit.text.text(node, { bounds, matrix: ctx.matrix, seen: !ctx.inMask, site });
    }
    return node;
  }

  #place(n: Extract<SceneNode, { kind: "place" }>, ctx: ResolveContext): void {
    const v = n.picture;
    const unlit = this.#unlit(ctx);
    const site = this.#site(n);
    if (unlit !== undefined && v.kind === "picture" && hasOpenLight(v.children)) this.#d.notes.warnAt(`${unlit} place ${v.key}`, { message: lightWarning(unlit, `place ${versionName(v)}: its light`), line: site?.line });
    const audit = this.#d.audit;
    if (audit === undefined) return;
    const matrix = mul(ctx.matrix, [1, 0, 0, 1, n.x, n.y]);
    if (v.kind === "picture" && !ctx.inMask) audit.text.placed(v.children, matrix);
    if (ctx.picture === undefined && !ctx.inMask && !(ctx.lit > 0 && (n.material?.castsShadow ?? false) !== false)) audit.offCanvas.place(`place ${versionName(v)}`, { version: v, matrix, site });
    if (ctx.picture === undefined && v.kind === "picture") this.#d.notes.placed(v, { matrix: ctx.matrix, line: site?.line });
  }
}
