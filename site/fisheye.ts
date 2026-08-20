// Fisheye / telescopic presentation (plan Track F): expand-in-place depth.
// This module owns the authoring vocabulary (the Markdoc tags), the disclosure
// CSS, and the tiny inline script. Two orthogonal tags, one concept each:
//
//   {% expand label="trigger text" %}…{% /expand %}
//     Pure disclosure. Inline (mid-sentence) it renders a button + a
//     hidden=until-found span, so collapsed depth stays find-in-page
//     searchable; block-level it renders native <details>/<summary>, the
//     platform primitive (which browsers likewise auto-open on find).
//
//   {% nugget slug="…" /%}
//     Embeds a committed nugget (site/nuggets/<slug>.md) with provenance.
//     Rendered as a placeholder element here and substituted by
//     embedNuggets() in nuggets.ts — this module stays nugget-free so the
//     import graph stays acyclic (render → fisheye; nuggets → render).
//
// All text ships in the page; the .md twin is the flat form. Depth cues stay
// in the shell's near-monochrome palette: unfolded inline text gets a faint
// wash that darkens one step per nesting level, block depth reads by left
// hairline + indent.

import Markdoc from "@markdoc/markdoc";
import type { Config, Node, RenderableTreeNode } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { Tag } = Markdoc;

function expandInline(label: string, children: RenderableTreeNode[]): RenderableTreeNode {
  // The leading space keeps revealed text from running into the trigger word.
  return new Tag("span", { class: "fx" }, [
    new Tag("button", { type: "button", class: "fx-t", "aria-expanded": "false" }, [label]),
    new Tag("span", { class: "fx-b", hidden: "until-found" }, [" ", ...children]),
  ]);
}

function expandBlock(label: string, children: RenderableTreeNode[]): RenderableTreeNode {
  // Still a native <details> (free toggle, no script), but the chrome is
  // erased: the summary reads exactly like an inline trigger sitting in
  // prose, and the revealed children live in a washed panel (.fx-c).
  return new Tag("details", { class: "fx" }, [
    new Tag("summary", {}, [label]),
    new Tag("div", { class: "fx-c" }, children),
  ]);
}

// Categorized asides: each kind is a voice with visible provenance. The
// marker emoji are placeholders for character drawings. `author` content is
// the boxholder's words only (a marked placeholder until real words arrive);
// `bee` frames a naive question whose answer, like `generated`, is machine
// text that regenerates and grows over time.
const ASIDE_KINDS = {
  bee: { marker: "🐝", provenance: "generated" },
  author: { marker: "✍️", provenance: "the author's words" },
  generated: { marker: "⚙️", provenance: "generated from the repository" },
} as const;

type AsideKind = keyof typeof ASIDE_KINDS;

function isAsideKind(kind: string): kind is AsideKind {
  return kind in ASIDE_KINDS;
}

/**
 * Markdoc tag definitions for the fisheye vocabulary — merged into the
 * transform config by render.ts.
 */
export const fisheyeTags: NonNullable<Config["tags"]> = {
  aside: {
    attributes: { kind: { type: String, required: true }, label: { type: String, required: true } },
    selfClosing: false,
    transform(node: Node, config: Config): RenderableTreeNode {
      const attrs = node.transformAttributes(config);
      const kind = String(attrs["kind"] ?? "");
      const label = String(attrs["label"] ?? "");
      if (!isAsideKind(kind)) {
        throw new Error(`aside "${label}" has unknown kind "${kind}" (expected ${Object.keys(ASIDE_KINDS).join("/")})`);
      }
      const spec = ASIDE_KINDS[kind];
      return new Tag("details", { class: `fx aside-${kind}` }, [
        new Tag("summary", {}, [new Tag("span", { class: "aside-m", "aria-hidden": "true" }, [`${spec.marker} `]), label]),
        new Tag("div", { class: "fx-c" }, [
          ...node.transformChildren(config),
          new Tag("p", { class: "aside-prov" }, [spec.provenance]),
        ]),
      ]);
    },
  },
  expand: {
    attributes: { label: { type: String, required: true } },
    selfClosing: false,
    transform(node: Node, config: Config): RenderableTreeNode {
      const label = String(node.transformAttributes(config)["label"] ?? "");
      const children = node.transformChildren(config);
      return node.inline ? expandInline(label, children) : expandBlock(label, children);
    },
  },
  nugget: {
    attributes: { slug: { type: String, required: true } },
    selfClosing: true,
    transform(node: Node, config: Config): RenderableTreeNode {
      const slug = String(node.transformAttributes(config)["slug"] ?? "");
      // A nugget renders as a <figure>; splicing one into a sentence would
      // put block content inside <p>, which browsers repair unpredictably.
      if (node.inline) {
        throw new Error(`nugget "${slug}" is embedded mid-sentence — place {% nugget /%} on its own line`);
      }
      // Placeholder element; embedNuggets() (nuggets.ts) substitutes the real
      // rendered nugget and fails the build on an unknown slug.
      return new Tag("x-nugget", { slug }, []);
    },
  },
};

// Depth treatment, spare register: the trigger reads as text with a dotted
// underline and a trailing ellipsis; once opened the underline goes solid and
// the revealed text carries a faint wash, one step darker per nesting level.
// Block depth uses <details> with a left hairline + indent (nesting indents
// naturally). Nuggets render as quiet figures with provenance captions.
export const FISHEYE_CSS = `
.fx-t {
  font: inherit; color: inherit; background: none; border: none; padding: 0;
  cursor: pointer; border-bottom: 1px dotted #8a8a82;
}
.fx-t::after { content: "\\2009\\2026"; color: #8a8a82; }
.fx-t:hover, details.fx > summary:hover { background: #f2f2ee; border-radius: 2px; }
.fx-t[aria-expanded="true"] { border-bottom-style: solid; }
.fx-t[aria-expanded="true"]::after { content: ""; }
.fx-b {
  background: #f2f2ee; border-radius: 2px; padding: 0 0.15em;
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
/* hidden=until-found hides via content-visibility, which does NOT apply to
   non-atomic inlines — without this rule the "collapsed" text renders fully
   visible. Collapse for real: an atomic zero-size inline-block, explicit
   content-visibility for the until-found search/beforematch path, and
   width/overflow as the fallback where content-visibility is unsupported. */
.fx-b[hidden="until-found"] {
  display: inline-block; content-visibility: hidden;
  width: 0; height: 0; padding: 0; overflow: clip; vertical-align: baseline;
}
.fx-b .fx-b { background: #e9e9e1; }
.fx-b .fx-b .fx-b { background: #dfdfd6; }
/* Block folds share the inline trigger's affordance — one vocabulary for
   "this goes deeper" whatever the scale of the reveal. No marker, no border,
   no box until opened; then a quiet washed panel. */
details.fx { margin: 0.9rem 0; }
details.fx > summary {
  display: inline; cursor: pointer; list-style: none;
  border-bottom: 1px dotted #8a8a82;
}
details.fx > summary::-webkit-details-marker { display: none; }
details.fx > summary::after { content: "\\2009\\2026"; color: #8a8a82; }
details.fx[open] > summary { border-bottom-style: solid; }
details.fx[open] > summary::after { content: ""; }
.fx-c { background: #f2f2ee; border-radius: 4px; padding: 0.15rem 0.8rem; margin-top: 0.5rem; }
.aside-m { display: inline-block; }
.aside-prov { font-size: 0.75rem; color: #8a8a82; margin: 0.6rem 0 0.4rem; }
.fx-c > p:first-child { margin-top: 0.5rem; }
.fx-c .fx-c { background: #e9e9e1; }
.fx-c .fx-c .fx-c { background: #dfdfd6; }
figure.nugget { margin: 0.9rem 0; padding: 0.8rem 1rem; background: #f7f7f3; border-radius: 4px; }
figure.nugget > :first-child { margin-top: 0; }
figure.nugget figcaption { font-size: 0.8rem; color: #55554f; margin-top: 0.5rem; }
p.nugget-stale { font-size: 0.85rem; color: #8a6d3b; margin: 0.4rem 0 0; }
`.trim();

// Inline-expansion behavior. Non-load-bearing: with JS off the collapsed text
// is still in the DOM (hidden=until-found), and the .md twin is the flat form.
// beforematch fires when find-in-page lands inside a collapsed span — open it
// and keep aria state truthful.
export const FISHEYE_SCRIPT = `
document.querySelectorAll(".fx-t").forEach((t, i) => {
  const b = t.nextElementSibling;
  if (!b) return;
  if (!b.id) b.id = "fx-b-" + i;
  t.setAttribute("aria-controls", b.id);
  const open = () => { t.setAttribute("aria-expanded", "true"); b.removeAttribute("hidden"); };
  t.addEventListener("click", () => {
    if (t.getAttribute("aria-expanded") === "true") {
      t.setAttribute("aria-expanded", "false");
      b.setAttribute("hidden", "until-found");
    } else {
      open();
    }
  });
  b.addEventListener("beforematch", open);
});
`.trim();
