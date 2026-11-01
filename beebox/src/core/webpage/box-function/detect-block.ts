/**
 * Does this response look like a site refusing the box, and not the page?
 * (docs/plans/webpage-capture-tools.md.) A page that matches makes no card.
 *
 * It can miss a block: a site can send a long sign-in page with a 200. A box
 * adds those cases to its own `webpage.ts`, which can refuse any page.
 */

/** The statuses that mean "not for you". Other failures are reported as themselves. */
const BLOCK_STATUSES: ReadonlySet<number> = new Set([401, 403, 407, 429, 451, 503]);

/** A longer page that happens to quote one of these phrases is an article about them. */
const SHORT_PAGE_BYTES = 20 * 1024;

const SHORT_PAGE_PHRASES = [
  "verify you are human",
  "verifying you are human",
  "are you a robot",
  "are you human",
  "access denied",
  "unusual traffic",
  "enable javascript and cookies",
];

/**
 * Keyed to the title, never to a script: real pages on protected sites carry the
 * vendor's script too, and a small one would be refused (found on a Minnesota
 * state site by a box that made that mistake).
 */
const CHALLENGE_TITLES: readonly { title: string; detail: string }[] = [
  { title: "just a moment", detail: "a Cloudflare challenge" },
  { title: "attention required", detail: "a Cloudflare block page" },
  { title: "radware captcha page", detail: "a Radware challenge" },
  { title: "radware bot manager captcha", detail: "a Radware challenge" },
];

/** The page's words: a phrase inside a script or a style is not on the page. */
function visibleText(html: string): string {
  return html.replace(/<(script|style)\b[\S\s]*?<\/\1\s*>/gi, " ");
}

export interface BlockInput {
  /** Null when the source does not report one (the box browser). */
  readonly status: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
}

/** Why this looks refused, or null. */
export function detectBlock({ status, headers, html }: BlockInput): string | null {
  if (headers["cf-mitigated"] === "challenge") return "a Cloudflare challenge (cf-mitigated header)";
  if (headers["x-datadome"] !== undefined) return "a DataDome challenge (x-datadome header)";
  const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim().toLowerCase() ?? "";
  const challenge = CHALLENGE_TITLES.find((candidate) => title.startsWith(candidate.title));
  if (challenge !== undefined) return `the page is ${challenge.detail}`;
  const lower = visibleText(html).toLowerCase();
  const isShort = Buffer.byteLength(lower) < SHORT_PAGE_BYTES;
  const phrase = isShort ? SHORT_PAGE_PHRASES.find((candidate) => lower.includes(candidate)) : undefined;
  if (phrase !== undefined) return `a short page that says "${phrase}"`;
  // A status alone may be a block or a page that is gone, so the reason says so.
  if (status !== null && BLOCK_STATUSES.has(status)) return `the site answered HTTP ${String(status)}, with no challenge page seen: it may be blocking the box, or the page may not exist`;
  return null;
}
