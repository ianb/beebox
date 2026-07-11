/**
 * Parsing + validation of the box-identity meta tag emitted by the box
 * frontend (callback-box useBoxIdentityMeta): JSON {slug, title, boxUrl}
 * in <meta name="callback-box">.
 *
 * Spoof guard: any web page could emit this meta with a foreign boxUrl,
 * phishing the user into routing saves to an attacker's server. The
 * identity is only accepted when boxUrl shares the tab's origin.
 */

import type { EnabledBox } from "./config.js";
import { isRecord } from "./is-record.js";

export const BOX_IDENTITY_META_NAME = "callback-box";

export interface BoxIdentitySource {
  metaContent: string;
  tabUrl: string;
}

/** Returns null for anything that isn't a well-formed, same-origin identity. */
export function parseBoxIdentity(source: BoxIdentitySource): EnabledBox | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.metaContent);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  if (!isRecord(parsed)) return null;
  const record = parsed;
  if (typeof record.slug !== "string" || record.slug === "") return null;
  if (typeof record.title !== "string" || record.title === "") return null;
  if (typeof record.boxUrl !== "string") return null;

  let boxUrl: URL;
  let tabOrigin: string;
  try {
    boxUrl = new URL(record.boxUrl);
    tabOrigin = new URL(source.tabUrl).origin;
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
  if (boxUrl.protocol !== "http:" && boxUrl.protocol !== "https:") return null;
  if (boxUrl.origin !== tabOrigin) return null;

  return {
    boxUrl: boxUrl.href.replace(/\/$/, ""),
    slug: record.slug,
    title: record.title,
  };
}
