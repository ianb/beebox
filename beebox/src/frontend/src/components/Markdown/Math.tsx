/**
 * A TeX formula from a `$…$` or `$$…$$` span (`@shared/markdoc-config/parse/
 * math-rule.ts`), rendered by KaTeX.
 *
 * KaTeX loads on the first formula a page shows (`math-render.ts`, its own
 * chunk). Until then, and when the TeX does not parse or the chunk does not
 * load, the formula shows its source in code style, delimiters included, so
 * the reader sees what was written; the title says why it is not a formula.
 * Once loaded, later formulas render on their first paint.
 */

import { useEffect, useMemo, useState } from "react";
// Type-only: erased at build, so KaTeX stays out of this chunk.
import type * as MathRenderModule from "./math-render";
import type { MathResult } from "./math-render";

type MathRenderer = typeof MathRenderModule;

let renderer: MathRenderer | null = null;
let loading: Promise<MathRenderer> | null = null;

function loadMathRenderer(): Promise<MathRenderer> {
  loading ??= import("./math-render").then(
    (module) => {
      renderer = module;
      return module;
    },
    (error: unknown) => {
      // A later formula tries again (a deploy can replace the chunk mid-session).
      loading = null;
      throw error;
    },
  );
  return loading;
}

type LoadState = "loading" | "loaded" | "failed";

function useMathRenderer(): LoadState {
  const [state, setState] = useState<LoadState>(renderer === null ? "loading" : "loaded");
  useEffect(() => {
    if (state !== "loading") return;
    let live = true;
    loadMathRenderer().then(
      () => {
        if (live) setState("loaded");
      },
      (error: unknown) => {
        console.error("Math renderer did not load", error);
        if (live) setState("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [state]);
  return state;
}

/**
 * `block` is a math block on its own lines; `display` is display mode, which a
 * `$$…$$` span inside a paragraph also has.
 */
export function MathFormula({ tex, display, block }: { tex: string; display?: boolean; block?: boolean }) {
  const load = useMathRenderer();
  const isDisplay = display === true || block === true;
  const result = useMemo<MathResult | null>(
    () => (load === "loaded" && renderer !== null ? renderer.renderTex(tex, isDisplay) : null),
    [load, tex, isDisplay],
  );
  const Wrapper = block === true ? "div" : "span";
  if (result !== null && "html" in result) {
    return (
      <Wrapper
        className={isDisplay ? "block overflow-x-auto overflow-y-hidden" : undefined}
        data-math={isDisplay ? "display" : "inline"}
        // KaTeX escapes the TeX and, with `trust: false`, emits no links,
        // scripts or raw HTML (math-render.ts).
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    );
  }
  const delimiter = isDisplay ? "$$" : "$";
  const title = result !== null ? `Formula did not render: ${result.error}` : load === "failed" ? "The formula renderer did not load." : undefined;
  return (
    <Wrapper data-math="source">
      <code title={title}>{`${delimiter}${tex}${delimiter}`}</code>
    </Wrapper>
  );
}
