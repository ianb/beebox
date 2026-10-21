/**
 * Rule coverage: every theme CSS rule scoped to a theme under test must match
 * something in the theme studio at one of the screens checked, so each place
 * a theme can fail is in a capture. A rule that matches nothing is a missing
 * specimen (render it in ThemeStudioHarness.tsx), dead CSS (delete it), or a
 * state the studio cannot show (exempt it, with a reason). The browser half
 * is in rules-page.ts.
 */

import { COLLECT_RULES_SCRIPT, matchRulesScript, type PageRule, type RuleProbe } from "./rules-page.js";

export type { PageRule, RuleProbe } from "./rules-page.js";

export interface RuleExemption {
  /** Matched against the selector as the browser serializes it. */
  selector: string;
  reason: string;
}

/** One selector of a theme rule, reduced to what the studio can show. */
export interface RuleTarget extends RuleProbe {
  key: string;
  sheet: string;
  /** As written, for the report. */
  original: string;
}

/** Split a selector list at its top-level commas. */
export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of list) {
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

/** The theme names a selector scopes itself to, in the forms theme CSS uses. */
export function themesNamed(selector: string): string[] {
  return [...selector.matchAll(/\[data-(?:chrome|card)-theme="([^"]+)"]/g)].map((m) => m[1] ?? "");
}

const USER_ACTION = /:(?:hover|focus-visible|focus-within|focus|active)\b/g;

/** Drop user-action arguments from each `:not(…)`, and a `:not()` left empty. */
function withoutNegatedActions(selector: string): string {
  let out = "";
  let i = 0;
  for (let at = selector.indexOf(":not(", i); at !== -1; at = selector.indexOf(":not(", i)) {
    let depth = 0;
    let end = at + 4;
    for (; end < selector.length; end++) {
      if (selector[end] === "(") depth++;
      if (selector[end] === ")" && --depth === 0) break;
    }
    const args = splitSelectorList(selector.slice(at + 5, end)).map(withoutNegatedActions)
      .filter((arg) => arg.replace(USER_ACTION, "").trim() !== "");
    out += selector.slice(i, at) + (args.length === 0 ? "" : `:not(${args.join(", ")})`);
    i = end + 1;
  }
  return out + selector.slice(i);
}

/**
 * The selector without what only a person's action or a pseudo-element adds,
 * so `document.querySelector` finds the element the rule styles: `:hover`,
 * `:focus`, `:focus-visible`, `:focus-within` and `:active` hold of any
 * element (and their negations too), and `::before`, `::placeholder` and the
 * like style a part of their element.
 */
export function reduceSelector(selector: string): string {
  return withoutNegatedActions(selector)
    .replace(USER_ACTION, ":where(*)")
    .replace(/::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter)\b/g, "")
    .replace(/\s*([+>~])\s*$/, "")
    .trim();
}

/** Print styles apply to paper, which the studio does not render. */
export function isPrintOnly(media: readonly string[]): boolean {
  return media.some((m) => /\bprint\b/.test(m) && !/\bnot\s+print\b/.test(m));
}

/**
 * The selectors to look for: each top-level selector of a rule that names
 * one of `themes`, outside print media and not exempt. Duplicates (the same
 * selector under the same media in the same sheet) collapse to one.
 */
export function ruleTargets(rules: readonly PageRule[], { themes, exemptions }: { themes: readonly string[]; exemptions: readonly RuleExemption[] }): RuleTarget[] {
  const targets = new Map<string, RuleTarget>();
  for (const rule of rules) {
    if (isPrintOnly(rule.media)) continue;
    for (const original of splitSelectorList(rule.selector)) {
      if (!themesNamed(original).some((name) => themes.includes(name))) continue;
      if (exemptions.some((e) => original.includes(e.selector))) continue;
      const key = `${rule.sheet}\n${rule.media.join(" and ")}\n${original}`;
      if (!targets.has(key)) targets.set(key, { key, sheet: rule.sheet, original, selector: reduceSelector(original), media: rule.media });
    }
  }
  return [...targets.values()];
}

export function describeUncoveredRule(target: RuleTarget, { unparsable }: { unparsable: boolean }): string {
  const media = target.media.length === 0 ? "" : ` in @media ${target.media.join(" and ")}`;
  return unparsable
    ? `rule selector could not be tested: ${target.original}${media} (${target.sheet})`
    : `rule matches nothing in the studio: ${target.original}${media} (${target.sheet})`;
}

export interface RuleAuditPage {
  eval(expression: string): Promise<string>;
}

function parseJson(stdout: string): unknown {
  const once: unknown = JSON.parse(stdout.trim());
  // agent-browser prints eval results as JSON; a string result is JSON again.
  return typeof once === "string" ? JSON.parse(once) : once;
}

export async function collectRules(page: RuleAuditPage): Promise<PageRule[]> {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: COLLECT_RULES_SCRIPT builds exactly this shape in the page
  return parseJson(await page.eval(COLLECT_RULES_SCRIPT)) as PageRule[];
}

/** For each target: matched (true), not matched (false), or unparsable (null). */
export async function matchRules(page: RuleAuditPage, targets: readonly RuleTarget[]): Promise<(boolean | null)[]> {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: matchRulesScript returns one entry per probe
  return parseJson(await page.eval(matchRulesScript(targets.map(({ selector, media }) => ({ selector, media }))))) as (boolean | null)[];
}
