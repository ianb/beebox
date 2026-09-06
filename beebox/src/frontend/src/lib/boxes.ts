/**
 * Fetch the list of available boxes from the server.
 *
 * Failures propagate: three call sites (`AppLayout`, `AppNav`, `BoxRedirect`)
 * distinguish "no boxes" from "couldn't ask", and swallowing the error here
 * used to make `AppLayout`'s `.catch` unreachable — an unreachable box server
 * read as "this box doesn't exist". Callers go through `useBoxes` so the three
 * of them share one request.
 */
import { withBase } from "../api.js";
import { RequestError } from "./errors";
import { withMobileAuth } from "./mobile-auth";
import type { CardSymbolData } from "@shared/card-symbol";

export interface KnownBox {
  slug: string;
  name: string;
  /** Symbol text (emoji); empty when the box uses an image or has no mark. */
  /** The box's mark, `src` resolved to a box-relative path; null when it has none. */
  symbol?: CardSymbolData | null;
}

export interface BoxesResult {
  boxes: KnownBox[];
  authRequired?: boolean;
}

export async function fetchBoxes(): Promise<BoxesResult> {
  const resp = await fetch(withBase("/api/boxes"), withMobileAuth());
  if (!resp.ok) {
    const detail = `GET /api/boxes failed: ${resp.status} ${resp.statusText}`;
    throw new RequestError(detail);
  }
  const data = await resp.json();
  return { boxes: data.boxes ?? [], authRequired: data.authRequired };
}
