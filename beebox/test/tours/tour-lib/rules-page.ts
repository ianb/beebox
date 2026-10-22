/**
 * Browser half of the rule coverage check, as script text for `bin/browse
 * eval` (see contrast-page.ts for why it is a string). `COLLECT_RULES_SCRIPT`
 * lists every style rule in the page's stylesheets with its sheet and the
 * `@media` conditions around it; `matchRulesScript` reports which of the
 * reduced selectors match an element at the current screen. The reduction
 * between them is pure, in rules.ts.
 */

export interface PageRule {
  /** The stylesheet's file name. */
  sheet: string;
  /** The rule's full selector list, as the browser serializes it. */
  selector: string;
  /** The `@media` conditions the rule sits in, outermost first. */
  media: string[];
}

export interface RuleProbe {
  selector: string;
  media: string[];
}

/** Evaluates to a JSON string of `PageRule[]`. */
export const COLLECT_RULES_SCRIPT = String.raw`JSON.stringify((() => {
  const out = [];
  const sheetName = (sheet) => {
    const node = sheet.ownerNode;
    const source = (node && node.dataset && node.dataset.viteDevId) || sheet.href || "inline";
    return source.split("/").pop().split("?")[0];
  };
  const visit = (rules, sheet, media) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) out.push({ sheet, selector: rule.selectorText, media });
      else if (rule instanceof CSSMediaRule) visit(rule.cssRules, sheet, [...media, rule.media.mediaText]);
      else if (rule instanceof CSSSupportsRule || rule instanceof CSSLayerBlockRule || rule instanceof CSSContainerRule) visit(rule.cssRules, sheet, media);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    visit(rules, sheetName(sheet), []);
  }
  return out;
})())`;

/**
 * Evaluates to a JSON array, one entry per probe: whether its selector
 * matches an element now, or null when the browser cannot parse it. A probe
 * whose media depends on the screen's size and does not hold at this one is
 * not tested here (false).
 */
export function matchRulesScript(probes: readonly RuleProbe[]): string {
  return String.raw`JSON.stringify(((probes) => probes.map(({ selector, media }) => {
  const sized = media.filter((m) => /width|height|aspect-ratio|orientation/.test(m));
  if (!sized.every((m) => matchMedia(m).matches)) return false;
  try { return document.querySelector(selector) !== null; } catch { return null; }
}))(${JSON.stringify(probes)}))`;
}
