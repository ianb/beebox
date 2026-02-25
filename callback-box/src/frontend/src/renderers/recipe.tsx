/**
 * Recipe card renderer — formatted recipe with scaling controls.
 */

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// eslint-disable-next-line import-x/no-named-as-default
import Fraction from "fraction.js";
import type { RendererProps } from "./index";
import { registerCardRenderer } from "./index";
import type { ElementNode } from "../api";

// --- Element parser ---

interface ParsedRecipe {
  title: string;
  description?: string;
  source?: string;
  yieldAmount: number;
  yieldText: string;
  notes?: string;
  tags: string[];
  sections: RecipeSection[];
}

interface RecipeSection {
  name?: string;
  notes?: string;
  ingredients: ParsedIngredient[];
  steps: string[];
}

interface ParsedIngredient {
  name: string;
  /** Raw amount string from the card — may be a number, fraction, or range */
  amount?: string;
  unit?: string;
}

function parseRecipeElement(el: ElementNode): ParsedRecipe {
  const children = el.children ?? [];
  const text = (tag: string) => children.find(c => c.tagName === tag)?.text?.trim();
  const yieldEl = children.find(c => c.tagName === "yield");
  const tagsEl = children.find(c => c.tagName === "tags");
  const sectionEls = children.filter(c => c.tagName === "section");

  return {
    title: text("title") ?? "Untitled",
    description: text("description"),
    source: text("source"),
    yieldAmount: yieldEl ? parseFloat(yieldEl.attrs.amount ?? "1") : 1,
    yieldText: yieldEl?.text?.trim() ?? "",
    notes: text("notes"),
    tags: (tagsEl?.children ?? []).map(c => c.text?.trim() ?? "").filter(Boolean),
    sections: sectionEls.map(parseSection),
  };
}

function parseSection(el: ElementNode): RecipeSection {
  const children = el.children ?? [];
  const ingsEl = children.find(c => c.tagName === "ingredients");
  const stepsEl = children.find(c => c.tagName === "steps");
  const notesEl = children.find(c => c.tagName === "notes");

  return {
    name: el.attrs.name,
    notes: notesEl?.text?.trim(),
    ingredients: (ingsEl?.children ?? []).map(ing => ({
      name: ing.text?.trim() ?? "",
      amount: ing.attrs.amount?.trim() || undefined,
      unit: ing.attrs.unit,
    })),
    steps: (stepsEl?.children ?? []).map(s => s.text?.trim() ?? ""),
  };
}

// --- Formatting ---

/** Common unit abbreviations for compact display */
const UNIT_ABBREV: Record<string, string> = {
  teaspoon: "t", teaspoons: "t", tsp: "t",
  tablespoon: "T", tablespoons: "T", tbsp: "T",
  cup: "c", cups: "c",
  milliliter: "mL", milliliters: "mL",
  ounce: "oz", ounces: "oz",
  liter: "L", liters: "L",
  kilogram: "kg", kilograms: "kg",
};

function abbreviateUnit(unit: string): string {
  return UNIT_ABBREV[unit.toLowerCase()] ?? unit;
}

/** Parse @{ingredient}{quantity} references into markdown bold */
function renderIngredientRefs(text: string): string {
  return text
    .replace(/@{([^}]+)}{([^}]+)}/g, "**$1** ($2)")
    .replace(/@{([^}]+)}/g, "**$1**")
    .replace(/@(\w+)/g, "**$1**");
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "1/2": "\u00BD", "1/3": "\u2153", "2/3": "\u2154",
  "1/4": "\u00BC", "3/4": "\u00BE",
  "1/5": "\u2155", "2/5": "\u2156", "3/5": "\u2157", "4/5": "\u2158",
  "1/6": "\u2159", "5/6": "\u215A",
  "1/8": "\u215B", "3/8": "\u215C", "5/8": "\u215D", "7/8": "\u215E",
};

/** Format a Fraction as a ReactNode with nice fraction display */
function formatFraction(f: Fraction): ReactNode {
  const s = f.s;
  const n = Number(f.n);
  const d = Number(f.d);
  const sign = s < 0 ? "\u2212" : "";

  if (d === 1) return `${sign}${n}`;

  const whole = Math.floor(n / d);
  const remN = n % d;

  if (remN === 0) return `${sign}${whole}`;

  const fracKey = `${remN}/${d}`;
  const unicodeFrac = UNICODE_FRACTIONS[fracKey];

  if (unicodeFrac) {
    return whole > 0 ? `${sign}${whole}\u200A${unicodeFrac}` : `${sign}${unicodeFrac}`;
  }
  // No Unicode char — render as styled fraction with numerator/slash/denominator
  const fracEl = <span className="text-[0.8em] tracking-tight">{remN}<span className="mx-px">/</span>{d}</span>;
  return whole > 0 ? <>{sign}{whole}{"\u200A"}{fracEl}</> : <>{sign}{fracEl}</>;
}

/** Scale an amount string by a multiplier and format as a nice fraction */
function scaleAmount(raw: string, scale: number): ReactNode {
  // Handle ranges like "2-3"
  const range = raw.match(/^(.+?)\s*-\s*(.+)$/);
  if (range) {
    return <>{scaleAmount(range[1], scale)}{"\u2013"}{scaleAmount(range[2], scale)}</>;
  }
  try {
    const f = new Fraction(raw).mul(scale);
    return formatFraction(f);
  } catch {
    return raw;
  }
}

// --- Components ---

function RecipeSectionView({ section, scale }: { section: RecipeSection; scale: number }) {
  return (
    <div className="mb-6">
      {section.name ? <h2 className="text-lg font-semibold mb-3">{section.name}</h2> : null}

      {section.notes ? (
        <div className="mb-3 text-sm text-warm-700 italic">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.notes}</ReactMarkdown>
        </div>
      ) : null}

      {section.ingredients.length > 0 ? (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-warm-600 uppercase tracking-wide mb-2">
            Ingredients
          </h3>
          <ul className="space-y-1">
            {section.ingredients.map((ing, i) => (
              <li key={i} className="flex gap-2">
                {ing.amount != null ? (
                  <span className="font-medium min-w-[5rem] text-right shrink-0">
                    {scaleAmount(ing.amount, scale)}{ing.unit ? ` ${abbreviateUnit(ing.unit)}` : ""}
                  </span>
                ) : (
                  <span className="min-w-[5rem] shrink-0" />
                )}
                <span>{ing.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.steps.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-warm-600 uppercase tracking-wide mb-2">
            Steps
          </h3>
          <ol className="list-decimal list-inside space-y-2">
            {section.steps.map((step, i) => (
              <li key={i} className="leading-relaxed">
                <span className="prose prose-sm inline max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => children as React.ReactElement }}>
                    {renderIngredientRefs(step)}
                  </ReactMarkdown>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function RecipeDetailView({ data }: RendererProps) {
  const [scale, setScale] = useState(1);

  if (!data.element) return <div className="p-4 text-warm-600">No recipe data</div>;

  const recipe = parseRecipeElement(data.element);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">{recipe.title}</h1>

      {recipe.description ? (
        <p className="text-warm-700 mb-4">{recipe.description}</p>
      ) : null}

      {recipe.source ? (
        <p className="text-sm text-warm-500 mb-4">Source: {recipe.source}</p>
      ) : null}

      {recipe.tags.length > 0 ? (
        <div className="flex gap-1 mb-4">
          {recipe.tags.map(tag => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-warm-100 text-warm-700 rounded">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {/* Scaling controls */}
      {recipe.yieldAmount > 0 ? (
        <div className="flex items-center gap-2 mb-6 p-3 bg-iris-50 rounded-lg">
          <span className="text-sm text-warm-700">Scale:</span>
          {[0.5, 1, 1.5, 2, 3].map(s => (
            <button
              key={s}
              className={`px-3 py-1 text-sm rounded ${
                scale === s
                  ? "bg-plum text-white shadow-sm"
                  : "bg-white text-warm-700 hover:bg-warm-100"
              }`}
              onClick={() => setScale(s)}
            >
              {s === 1 ? "1x" : `${s}x`}
            </button>
          ))}
          {recipe.yieldText ? (
            <span className="text-sm text-warm-600 ml-2">
              {scale === 1
                ? recipe.yieldText
                : <>{scaleAmount(String(recipe.yieldAmount), scale)} servings</>}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Sections */}
      {recipe.sections.map((section, i) => (
        <RecipeSectionView key={i} section={section} scale={scale} />
      ))}

      {recipe.notes ? (
        <div className="mt-6 p-4 bg-amber-50 rounded-lg">
          <h3 className="font-medium text-amber-800 mb-1">Notes</h3>
          <div className="prose prose-sm max-w-none text-amber-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{recipe.notes}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Register the recipe renderer
registerCardRenderer("recipe", {
  name: "Recipe",
  Component: RecipeDetailView,
  priority: 100,
});
