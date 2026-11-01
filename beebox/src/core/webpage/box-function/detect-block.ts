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

const CHALLENGE_MARKERS: readonly { marker: string; detail: string }[] = [
  { marker: "cf-chl", detail: "a Cloudflare challenge" },
  { marker: "<title>just a moment", detail: "a Cloudflare challenge" },
  { marker: "<title>attention required", detail: "a Cloudflare block page" },
  { marker: "captcha-delivery.com", detail: "a DataDome challenge" },
  { marker: "/_incapsula_resource", detail: "an Imperva challenge" },
];

export interface BlockInput {
  /** Null when the source does not report one (the box browser). */
  readonly status: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
}

/** Why this looks refused, or null. */
export function detectBlock({ status, headers, html }: BlockInput): string | null {
  if (status !== null && BLOCK_STATUSES.has(status)) return `the site answered HTTP ${String(status)}`;
  if (headers["cf-mitigated"] === "challenge") return "a Cloudflare challenge (cf-mitigated header)";
  if (headers["x-datadome"] !== undefined) return "a DataDome challenge (x-datadome header)";
  const lower = html.toLowerCase();
  const isShort = Buffer.byteLength(html) < SHORT_PAGE_BYTES;
  if (!isShort) return null;
  for (const { marker, detail } of CHALLENGE_MARKERS) {
    if (lower.includes(marker)) return `the page is ${detail}`;
  }
  const phrase = SHORT_PAGE_PHRASES.find((candidate) => lower.includes(candidate));
  return phrase === undefined ? null : `a short page that says "${phrase}"`;
}
