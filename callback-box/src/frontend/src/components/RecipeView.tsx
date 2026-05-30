/**
 * Recipe card renderer — header + scale controls + Markdoc-rendered body.
 *
 * Recipe schema migrated from XML (`<ing>`, `<step>`, …) to a Phase-2
 * frontmatter + Markdoc body (`{% ingredient %}`, `{% step %}`, …) in
 * `markdoc-tags-design.md` Track 1. This view:
 *
 * - reads `title` / `description` / `source` / `tags` / `hero-image`
 *   from the frontmatter;
 * - provides the scale-multiplier control and pipes it into the body
 *   via `RecipeScaleContext` (each `{% ingredient %}` reads it);
 * - wraps the body in a `.recipe-body` container so CSS step counters
 *   (defined in the global stylesheet) increment per `{% step %}`;
 * - renders the body via the shared `<Markdown>` component — every
 *   recipe tag is a normal Markdoc tag with a React component.
 */

import { useState } from "react";
import { Markdown } from "./Markdown";
import { RecipeScaleContext } from "./RecipeTags";
import type { RendererProps } from "../renderers";

const SCALE_OPTIONS = [0.5, 1, 1.5, 2, 3];

export function RecipeView({ data, onNavigate }: RendererProps) {
  const [scale, setScale] = useState(1);

  const frontmatter = data.frontmatter ?? {};
  const title = typeof frontmatter["title"] === "string" ? frontmatter["title"] : "Untitled";
  const description = typeof frontmatter["description"] === "string" ? frontmatter["description"] : undefined;
  const source = typeof frontmatter["source"] === "string" ? frontmatter["source"] : undefined;
  const tags = Array.isArray(frontmatter["tags"]) ? frontmatter["tags"] as string[] : [];
  const body = data.body ?? "";

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>

      {description !== undefined ? (
        <p className="text-warm-700 mb-4">{description}</p>
      ) : null}

      {source !== undefined ? (
        <p className="text-sm text-warm-500 mb-4">Source: {source}</p>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex gap-1 mb-4 flex-wrap">
          {tags.map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-warm-100 text-warm-700 rounded">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 mb-6 p-3 bg-info-50 rounded-lg">
        <span className="text-sm text-warm-700">Scale:</span>
        {SCALE_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`px-3 py-1 text-sm rounded ${
              scale === s
                ? "bg-primary text-white shadow-sm"
                : "bg-white text-warm-700 hover:bg-warm-100"
            }`}
            onClick={() => setScale(s)}
          >
            {s === 1 ? "1x" : `${s}x`}
          </button>
        ))}
      </div>

      <RecipeScaleContext.Provider value={scale}>
        <div className="recipe-body">
          <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>
            {body}
          </Markdown>
        </div>
      </RecipeScaleContext.Provider>
    </div>
  );
}
