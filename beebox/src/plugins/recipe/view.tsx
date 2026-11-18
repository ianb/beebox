/**
 * The recipe plugin's view for `recipe` cards: header, scale control, then the
 * body through the `Markdown` widget with the recipe tags. A box activates it
 * with a stub at `src/views/recipe.tsx` that re-exports this component as its
 * default and declares `rendersCardTypes = ["recipe"]` with a `dependencies`
 * glob covering `**\/*.recipe.card`.
 *
 * The card this view renders is the anchor card: the host sets `params.path`
 * to the card's own path and the stub's `dependencies` glob brings it into
 * `cards`. This module imports only `react`, `beebox/view-widgets`, `fraction.js`,
 * `@markdoc/markdoc` (through `./tags.js`) and its own `view/` siblings, so it
 * can be bundled for a box.
 */

import { useState } from "react";
import { CardLink, Markdown, type ViewCard, type ViewProps } from "beebox/view-widgets";
import { recipeTags } from "./tags.js";
import { makeRecipeComponents, RecipeScaleContext } from "./view/tags.js";
import "./view/recipe.css";

const SCALE_OPTIONS = [0.5, 1, 1.5, 2, 3];

const components = makeRecipeComponents();

function RecipeView({ cards, params }: ViewProps) {
  const card = cards.find((c) => c.path === params["path"]);
  if (card === undefined) {
    // `params.path` comes from the URL; a stale link can name a card the
    // dependencies glob no longer selects.
    return <div className="max-w-2xl mx-auto p-6"><p>This recipe card is not available.</p></div>;
  }
  return <RecipeCard card={card} />;
}

function RecipeCard({ card }: { card: ViewCard }) {
  const [scale, setScale] = useState(1);

  const frontmatter = card.frontmatter ?? {};
  const title = typeof frontmatter["title"] === "string" ? frontmatter["title"] : "Untitled";
  const description = typeof frontmatter["description"] === "string" ? frontmatter["description"] : undefined;
  const sources = recipeSources(frontmatter["sources"]);
  const tags = Array.isArray(frontmatter["tags"])
    ? frontmatter["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  const body = card.body ?? "";

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>

      {description !== undefined ? (
        <p className="text-card-soft mb-4">{description}</p>
      ) : null}

      {sources.length > 0 ? (
        <p className="text-sm text-card-soft mb-4">
          Source:{" "}
          {sources.map((source, i) => (
            <span key={i}>
              {i > 0 ? ", " : null}
              <SourceLink source={source} />
              {source.note === null ? null : ` (${source.note})`}
            </span>
          ))}
        </p>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex gap-1 mb-4 flex-wrap">
          {tags.map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-card-tint text-card-soft rounded">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 mb-6 p-3 bg-card-tint rounded-lg">
        <span className="text-sm text-card-ink">Scale:</span>
        {SCALE_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`px-3 py-1 text-sm rounded ${
              scale === s
                ? "bg-card-pen text-card-paper shadow-sm"
                : "bg-card-sheet text-card-ink hover:bg-card-tint"
            }`}
            onClick={() => setScale(s)}
          >
            {s === 1 ? "1x" : `${String(s)}x`}
          </button>
        ))}
      </div>

      <RecipeScaleContext.Provider value={scale}>
        <div className="bbx-recipe-body">
          <Markdown card={card} tags={recipeTags} components={components}>
            {body}
          </Markdown>
        </div>
      </RecipeScaleContext.Provider>
    </div>
  );
}

interface RecipeSource {
  /** The entry's label; null shows the ref's card title or the URL. */
  label: string | null;
  /** An http(s) URL: opens in a new tab. */
  href: string | null;
  /** An in-box ref (relative to the card, `attach/…`, or box-absolute): opens in the app. */
  ref: string | null;
  note: string | null;
}

const WEB_URL = /^https?:\/\//i;

/**
 * Each usable `sources` entry. A `ref` that is a web URL links like an `href`;
 * an in-box `ref` goes to `CardLink`, which resolves it against the card.
 */
function recipeSources(value: unknown): RecipeSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): RecipeSource[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const str = (key: string): string | null => {
      const field: unknown = Reflect.get(entry, key);
      return typeof field === "string" && field.trim() !== "" ? field : null;
    };
    const rawRef = str("ref");
    const webRef = rawRef !== null && WEB_URL.test(rawRef) ? rawRef : null;
    const source = { label: str("label"), href: str("href") ?? webRef, ref: webRef === null ? rawRef : null, note: str("note") };
    return source.label === null && source.href === null && source.ref === null ? [] : [source];
  });
}

function SourceLink({ source }: { source: RecipeSource }) {
  if (source.ref !== null) return <CardLink cardRef={source.ref}>{source.label ?? undefined}</CardLink>;
  if (source.href !== null && WEB_URL.test(source.href)) {
    return <a href={source.href} target="_blank" rel="noreferrer" className="underline">{source.label ?? source.href}</a>;
  }
  return source.label ?? source.href;
}

/** Named alias for the box stub to re-export beside the default. */
export const recipeView = RecipeView;

export default RecipeView;
