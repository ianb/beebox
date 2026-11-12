/**
 * Posting to the box's own browser routes (`POST /<slug>/api/browser/<route>`),
 * for `bbx browser` and `bbx webpage save --browser`.
 */

import { z } from "zod";
import { loopbackHeaders } from "./loopback-headers.js";

const ERROR_BODY = z.object({ error: z.string() });

export type PostOutcome = { ok: true; json: unknown; text: string } | { ok: false; message: string };

/** Post `body` to the box's own server; every failure becomes one message for stderr. */
export async function postToBox(route: string, body: unknown): Promise<PostOutcome> {
  const serverUrl = process.env.BBX_SERVER_URL;
  const boxName = process.env.BBX_BOX_NAME;
  if (serverUrl === undefined || serverUrl === "" || boxName === undefined || boxName === "") {
    return { ok: false, message: "bbx browser: BBX_SERVER_URL and BBX_BOX_NAME must be set (run it from a box agent's shell)" };
  }
  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/browser/${route}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: loopbackHeaders(), body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, message: `bbx browser: the box server did not answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    // Not JSON: reported raw below.
  }
  if (res.status !== 200) {
    const error = ERROR_BODY.safeParse(json);
    return { ok: false, message: `${error.success ? error.data.error : text} (HTTP ${String(res.status)})` };
  }
  return { ok: true, json, text };
}
