/**
 * `/capture` deep link.
 *
 * Capture is no longer a standalone page — it's a mode of the chat composer
 * (see components/capture/CaptureOverlay). This route survives as a deep link
 * (home-screen shortcuts, the box-selection tiles) that redirects into the chat
 * with capture mode auto-open via `?capture=1`, which ChatPage consumes once.
 */

import { Navigate, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";

export function CapturePage() {
  const { boxSlug } = useParams({ strict: false });
  return <Navigate to={href(`/${boxSlug ?? ""}/chat`)} search={toSearch({ capture: "1" })} replace />;
}
