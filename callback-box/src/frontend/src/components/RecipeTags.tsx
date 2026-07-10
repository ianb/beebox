/**
 * Recipe-vocabulary tag components.
 *
 * Six tags moved from the XML recipe schema's children (`<ing>`, `<step>`,
 * `<yield>`, `<section>`) plus two new concepts (`{% substitution %}`,
 * `{% subrecipe %}`) — see `markdoc-tags-plan.md` Track 1.
 *
 * **Scaling lives here**, not in the recipe view. The recipe view
 * provides a `RecipeScaleContext` with the current multiplier; each
 * `IngredientInline`/`IngredientBlock` instance reads it and scales
 * its `amount`. Out-of-recipe usage (e.g. a doc that mentions an
 * ingredient inline) gets scale 1 by default — same display, no
 * surprises.
 *
 * **Step numbering** is left to CSS. The Step component renders a
 * styled block; the recipe view wraps the body in a container with
 * `counter-reset: recipe-step` and a `.recipe-body` class that adds
 * the `::before { content: counter(recipe-step) ". "; }` rule. Out
 * of a recipe context, the Step block renders without a number — the
 * counter just never increments. (React-side counter pattern was
 * attempted first; ref-during-render rules made it brittle.)
 */

import { createContext, useContext, type ReactNode } from "react";
// eslint-disable-next-line import-x/no-named-as-default
import Fraction from "fraction.js";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

export interface RecipeLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}

/** Current scale multiplier (1 = unscaled). Provided by RecipeView. */
export const RecipeScaleContext = createContext<number>(1);

const UNIT_ABBREV: Record<string, string> = {
  teaspoon: "t", teaspoons: "t", tsp: "t",
  tablespoon: "T", tablespoons: "T", tbsp: "T",
  cup: "c", cups: "c",
  milliliter: "mL", milliliters: "mL",
  ounce: "oz", ounces: "oz",
  liter: "L", liters: "L",
  kilogram: "kg", kilograms: "kg",
};

const UNICODE_FRACTIONS: Record<string, string> = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔",
  "1/4": "¼", "3/4": "¾",
  "1/5": "⅕", "2/5": "⅖", "3/5": "⅗", "4/5": "⅘",
  "1/6": "⅙", "5/6": "⅚",
  "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
};

function abbreviateUnit(unit: string): string {
  return UNIT_ABBREV[unit.toLowerCase()] ?? unit;
}

function formatFraction(f: Fraction): ReactNode {
  const sign = f.s < 0 ? "−" : "";
  const n = Number(f.n);
  const d = Number(f.d);
  if (d === 1) return `${sign}${n}`;
  const whole = Math.floor(n / d);
  const remN = n % d;
  if (remN === 0) return `${sign}${whole}`;
  const fracKey = `${remN}/${d}`;
  // Most fracKeys have no Unicode glyph; the frontend tsconfig lacks
  // noUncheckedIndexedAccess, so a plain index read would type this as
  // always-defined. Object.hasOwn keeps the miss case honest.
  const unicodeFrac = Object.hasOwn(UNICODE_FRACTIONS, fracKey) ? UNICODE_FRACTIONS[fracKey] : undefined;
  if (unicodeFrac !== undefined) {
    return whole > 0 ? `${sign}${whole} ${unicodeFrac}` : `${sign}${unicodeFrac}`;
  }
  const fracEl = (
    <span className="text-[0.8em] tracking-tight">
      {remN}<span className="mx-px">/</span>{d}
    </span>
  );
  return whole > 0 ? <>{sign}{whole}{" "}{fracEl}</> : <>{sign}{fracEl}</>;
}

function scaleAmount(raw: string, scale: number): ReactNode {
  const range = raw.match(/^(.+?)\s*-\s*(.+)$/);
  if (range !== null) {
    return <>{scaleAmount(range[1] as string, scale)}{"–"}{scaleAmount(range[2] as string, scale)}</>;
  }
  try {
    const f = new Fraction(raw).mul(scale);
    return formatFraction(f);
  } catch (_e) {
    // raw isn't a parseable fraction (e.g. "to taste") — leave it unscaled.
    return raw;
  }
}

function refToViewTarget(sourceRef: string): ViewTarget {
  const noFrag = sourceRef.split("#")[0] ?? sourceRef;
  const path = noFrag.replace(/^\/+/, "");
  return { path, viewer: null, params: {} };
}

function AmountUnit({ amount, unit }: { amount?: string; unit?: string }): ReactNode {
  const scale = useContext(RecipeScaleContext);
  if (amount === undefined || amount === "") return null;
  const scaled = scaleAmount(amount, scale);
  return (
    <span className="font-medium">
      {scaled}{unit !== undefined && unit !== "" ? ` ${abbreviateUnit(unit)}` : ""}
    </span>
  );
}

export function makeRecipeComponents(linkCtx: RecipeLinkContext) {
  function IngredientInline({
    amount,
    unit,
    children,
  }: {
    amount?: string;
    unit?: string;
    children?: ReactNode;
  }) {
    const showAmount = amount !== undefined && amount !== "";
    return (
      <span>
        {showAmount ? <><AmountUnit amount={amount} unit={unit} />{" "}</> : null}
        {children}
      </span>
    );
  }

  function IngredientBlock({
    amount,
    unit,
    children,
  }: {
    amount?: string;
    unit?: string;
    children?: ReactNode;
  }) {
    return (
      <div className="flex gap-2 my-1">
        <span className="min-w-[5rem] text-right shrink-0">
          <AmountUnit amount={amount} unit={unit} />
        </span>
        <span className="text-warm-800">{children}</span>
      </div>
    );
  }

  function Step({ children }: { children?: ReactNode }) {
    // The `recipe-step` class is the CSS counter hook. When the body is
    // wrapped in a `recipe-body` container (RecipeView does this), each
    // step renders its number via `::before`; otherwise the class is a
    // no-op and the step just renders as a styled block.
    return (
      <div className="recipe-step my-3 leading-relaxed text-warm-800 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </div>
    );
  }

  function RecipeYield({
    amount,
    children,
  }: {
    amount?: string;
    children?: ReactNode;
  }) {
    return (
      <div className="my-2 text-sm text-warm-600">
        <span className="font-medium uppercase tracking-wide text-xs">Yield</span>
        {amount !== undefined && amount !== "" ? (
          <span className="text-warm-400 ml-1 text-xs">(base {amount})</span>
        ) : null}
        <span className="ml-2">{children}</span>
      </div>
    );
  }

  function Substitution({
    forIngredient,
    children,
  }: {
    forIngredient?: string;
    children?: ReactNode;
  }) {
    return (
      <div className="my-2 border-l-2 border-warm-300 bg-warm-50/50 pl-3 py-1 text-sm">
        <span className="text-warm-500 text-xs uppercase tracking-wide font-medium">
          Substitution
        </span>
        {forIngredient !== undefined && forIngredient !== "" ? (
          <span className="text-warm-500 ml-1 text-xs italic">
            for {forIngredient}
          </span>
        ) : null}
        <div className="text-warm-700">{children}</div>
      </div>
    );
  }

  function Subrecipe({
    sourceRef,
    children,
  }: {
    sourceRef?: string;
    children?: ReactNode;
  }) {
    const refValue = sourceRef === undefined ? "" : sourceRef;
    const display = refValue === ""
      ? "(missing ref)"
      : refValue.split("/").pop()?.replace(/\.[^.]+\.card$/, "").replace(/[_-]+/g, " ") ?? refValue;
    return (
      <div className="my-3 border-l-2 border-info-300 bg-info-50/40 pl-3 py-2">
        <button
          type="button"
          onClick={() => linkCtx.onNavigate(refToViewTarget(refValue), { label: display })}
          className="text-info-700 hover:text-info-900 underline-offset-2 hover:underline cursor-pointer font-medium text-sm"
        >
          → {display}
        </button>
        <div className="text-warm-700 text-sm mt-1 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          {children}
        </div>
      </div>
    );
  }

  function RecipeSection({
    name,
    children,
  }: {
    name?: string;
    children?: ReactNode;
  }) {
    return (
      <section className="my-4">
        {name !== undefined && name !== "" ? (
          <h2 className="text-lg font-semibold text-warm-800 mb-2">{name}</h2>
        ) : null}
        {children}
      </section>
    );
  }

  return {
    IngredientInline,
    IngredientBlock,
    Step,
    RecipeYield,
    Substitution,
    Subrecipe,
    RecipeSection,
  };
}
