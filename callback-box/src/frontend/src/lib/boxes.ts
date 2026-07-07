/**
 * Fetch the list of available boxes from the server.
 */
import { withBase } from "../api.js";
import { withMobileAuth } from "./mobile-auth";

export interface BoxesResult {
  boxes: Array<{ slug: string; name: string }>;
  authRequired?: boolean;
}

export async function fetchBoxes(): Promise<BoxesResult> {
  try {
    const resp = await fetch(withBase("/api/boxes"), withMobileAuth());
    if (!resp.ok) return { boxes: [] };
    const data = await resp.json();
    return { boxes: data.boxes ?? [], authRequired: data.authRequired };
  } catch (_e) {
    return { boxes: [] };
  }
}
