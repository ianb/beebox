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
  /**
   * For one member of an `:is()` or `:where()` list: the member, tested in
   * place of its list. A dead hook in a list otherwise hides behind the live
   * members beside it.
   */
  member: string | null;
  /** For a member, the key of its whole selector's target. */
  whole: string | null;
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

/** The `:is()` and `:where()` lists in a selector, outside `:not()`, nested ones included. */
function selectorLists(selector: string): { start: number; end: number; members: string[] }[] {
  const lists: { start: number; end: number; members: string[] }[] = [];
  const pattern = /:(is|where|not)\(/g;
  for (let m = pattern.exec(selector); m !== null; m = pattern.exec(selector)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < selector.length; end++) {
      if (selector[end] === "(") depth++;
      if (selector[end] === ")" && --depth === 0) break;
    }
    if (m[1] === "not") { pattern.lastIndex = end + 1; continue; }
    lists.push({ start: m.index, end, members: splitSelectorList(selector.slice(m.index + m[0].length, end)) });
  }
  return lists;
}

/**
 * Each member of a selector's `:is()`/`:where()` lists that names a theme
 * hook (`bbx-`), with the selector it stands in: its list replaced by the
 * member alone. A member scoped to a theme not under test is left out.
 */
export function listMembers(selector: string, { themes }: { themes: readonly string[] }): { member: string; selector: string }[] {
  const out: { member: string; selector: string }[] = [];
  for (const { start, end, members } of selectorLists(selector)) {
    if (members.length < 2) continue;
    for (const member of members) {
      if (!member.includes("bbx-")) continue;
      const named = themesNamed(member);
      if (named.length > 0 && !named.some((name) => themes.includes(name))) continue;
      out.push({ member, selector: `${selector.slice(0, start)}:is(${member})${selector.slice(end + 1)}` });
    }
  }
  return out;
}

/** Print styles apply to paper, which the studio does not render. */
export function isPrintOnly(media: readonly string[]): boolean {
  return media.some((m) => /\bprint\b/.test(m) && !/\bnot\s+print\b/.test(m));
}

/**
 * The selectors to look for: each top-level selector of a rule that names
 * one of `themes`, outside print media and not exempt, and each hook member
 * of its `:is()` lists (`listMembers`). Duplicates (the same selector under
 * the same media in the same sheet) collapse to one.
 */
export function ruleTargets(rules: readonly PageRule[], { themes, exemptions }: { themes: readonly string[]; exemptions: readonly RuleExemption[] }): RuleTarget[] {
  const targets = new Map<string, RuleTarget>();
  for (const rule of rules) {
    if (isPrintOnly(rule.media)) continue;
    for (const original of splitSelectorList(rule.selector)) {
      if (!themesNamed(original).some((name) => themes.includes(name))) continue;
      if (exemptions.some((e) => original.includes(e.selector))) continue;
      const key = `${rule.sheet}\n${rule.media.join(" and ")}\n${original}`;
      if (targets.has(key)) continue;
      targets.set(key, { key, sheet: rule.sheet, original, selector: reduceSelector(original), media: rule.media, member: null, whole: null });
      for (const { member, selector } of listMembers(original, { themes })) {
        if (exemptions.some((e) => member.includes(e.selector))) continue;
        targets.set(`${key}\n${member}`, { key: `${key}\n${member}`, sheet: rule.sheet, original, selector: reduceSelector(selector), media: rule.media, member, whole: key });
      }
    }
  }
  return [...targets.values()];
}

export function describeUncoveredRule(target: RuleTarget, { unparsable }: { unparsable: boolean }): string {
  const media = target.media.length === 0 ? "" : ` in @media ${target.media.join(" and ")}`;
  if (target.member !== null) {
    return unparsable
      ? `rule selector could not be tested: ${target.member} in ${target.original}${media} (${target.sheet})`
      : `list member matches nothing in the studio: ${target.member} in ${target.original}${media} (${target.sheet})`;
  }
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
