/**
 * `scroll --selector` target resolution: the page-side script, its result
 * parser, and the command that runs them.
 */

import { run, runPassthrough } from "agent-browser-typed";

/** The attribute that marks the scroll target for upstream while `scroll --selector` runs. */
export const SCROLL_TARGET_ATTR = "data-browse-scroll-target";

/**
 * In-page resolution for `scroll --selector <css>`. Upstream scrolls the first
 * DOM match even when it is hidden or 0x0 (a hidden tab panel ahead of the
 * visible one), and prints `Done`. This picks the first match that is shown and
 * has a box, as a click would, and marks it with {@link SCROLL_TARGET_ATTR} so
 * upstream can be pointed at exactly that element. Results: `{ ok: true }` when
 * it marked one, `{ ok: false, reason: "no-match" }` when the selector matches
 * nothing (upstream words that error), `{ ok: false, reason: "bad-selector" }`
 * for a non-CSS selector (also left to upstream), `{ ok: false, reason: "none-visible", detail }`
 * when every match is hidden or zero-size.
 */
export function scrollTargetScript(selector: string): string {
  return `(() => {
  const selector = ${JSON.stringify(selector)};
  const attr = ${JSON.stringify(SCROLL_TARGET_ATTR)};
  let matches;
  try { matches = Array.from(document.querySelectorAll(selector)); } catch (e) { return JSON.stringify({ ok: false, reason: 'bad-selector' }); }
  if (matches.length === 0) return JSON.stringify({ ok: false, reason: 'no-match' });
  for (const old of Array.from(document.querySelectorAll('[' + attr + ']'))) old.removeAttribute(attr);
  const shown = (el) => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const target = matches.find(shown);
  if (target === undefined) return JSON.stringify({ ok: false, reason: 'none-visible', detail: String(matches.length) + (matches.length === 1 ? ' element matches' : ' elements match') + ' ' + selector + ', and every one is hidden or has no box' });
  target.setAttribute(attr, '');
  return JSON.stringify({ ok: true, skipped: matches.indexOf(target) });
})()`;
}

export type ScrollTarget =
  | { kind: "marked"; skipped: number }
  | { kind: "upstream" }
  | { kind: "refuse"; detail: string };

/** Parses what `eval` printed for {@link scrollTargetScript}. Anything unreadable goes to upstream unchanged. */
export function parseScrollTarget(printed: string): ScrollTarget {
  try {
    let v: unknown = JSON.parse(printed.trim());
    if (typeof v === "string") v = JSON.parse(v);
    if (typeof v !== "object" || v === null || !("ok" in v)) return { kind: "upstream" };
    const o = v as { ok: unknown; skipped?: unknown; reason?: unknown; detail?: unknown };
    if (o.ok === true) return { kind: "marked", skipped: typeof o.skipped === "number" ? o.skipped : 0 };
    if (o.reason === "none-visible") return { kind: "refuse", detail: typeof o.detail === "string" ? o.detail : "every match is hidden" };
  } catch {
    // Unreadable: let upstream have it.
  }
  return { kind: "upstream" };
}

/**
 * `scroll … --selector <css>`: upstream scrolls the first DOM match even when
 * it is hidden. Resolve the first visible match in the page, point upstream at
 * it, and refuse when every match is hidden or zero-size.
 */
export async function scrollWithSelector(args: readonly string[]): Promise<number> {
  const at = args.findIndex((a) => a === "-s" || a === "--selector");
  const selector = at === -1 ? undefined : args[at + 1];
  if (selector === undefined) return runPassthrough(["scroll", ...args]);
  let resolved: ScrollTarget = { kind: "upstream" };
  try {
    resolved = parseScrollTarget((await run(["eval", scrollTargetScript(selector)])).stdout);
  } catch {
    // The check could not run; upstream's scroll still can.
  }
  if (resolved.kind === "refuse") {
    process.stdout.write(`✗ scroll --selector refused: ${resolved.detail}; pick a selector for the visible pane\n`);
    return 1;
  }
  if (resolved.kind === "upstream") return runPassthrough(["scroll", ...args]);
  if (resolved.skipped > 0) process.stderr.write(`browse: scrolled the first visible match of ${selector} (${String(resolved.skipped)} hidden before it)\n`);
  const rewritten = args.map((a, i) => (i === at + 1 ? `[${SCROLL_TARGET_ATTR}]` : a));
  try {
    return await runPassthrough(["scroll", ...rewritten]);
  } finally {
    try {
      await run(["eval", `document.querySelectorAll('[${SCROLL_TARGET_ATTR}]').forEach((e) => e.removeAttribute('${SCROLL_TARGET_ATTR}'))`]);
    } catch {
      // A leftover marker is harmless: the next scroll clears it first.
    }
  }
}
