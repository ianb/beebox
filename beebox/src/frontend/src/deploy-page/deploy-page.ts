/**
 * Browser entry for the deploy page. Not part of the SPA: the page is served
 * by nginx while the hub is stopped, so `scripts/build-deploy-page.ts` bundles
 * this file on its own and inlines it into `dist/deploy-page.html`.
 *
 * It rewrites the server-rendered UTC text in the reader's local time, keeps
 * the elapsed time current, and reloads once the site answers without the
 * `X-Beebox-Deploy` header nginx puts on this page. Elapsed time is measured
 * against the server's clock (each poll's `Date` header), so a visitor whose
 * clock is wrong still reads a true "3 minutes ago".
 */
import { deployPageText } from "@shared/deploy-page-text";

const POLL_MS = 15_000;

interface DeployData {
  startedMs: number;
  typicalSeconds: number | null;
}

function readData(): DeployData | null {
  const raw = document.getElementById("bbx-deploy")?.textContent;
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("startedMs" in parsed) || !("typicalSeconds" in parsed)) return null;
  const { startedMs, typicalSeconds } = parsed;
  if (typeof startedMs !== "number") return null;
  if (typicalSeconds !== null && typeof typicalSeconds !== "number") return null;
  return { startedMs, typicalSeconds };
}

function start(): void {
  const data = readData();
  const headline = document.getElementById("bbx-headline");
  const detail = document.getElementById("bbx-detail");
  if (!data || !headline || !detail) return;
  const startedLabel = new Date(data.startedMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let clockOffsetMs = 0;

  const render = (): void => {
    const text = deployPageText({ ...data, nowMs: Date.now() + clockOffsetMs, startedLabel });
    headline.textContent = text.headline;
    detail.textContent = text.detail;
  };

  const poll = async (): Promise<void> => {
    try {
      const response = await fetch(location.href, { method: "HEAD", cache: "no-store" });
      if (!response.headers.has("X-Beebox-Deploy")) {
        location.reload();
        return;
      }
      const serverDate = Date.parse(response.headers.get("Date") ?? "");
      if (!Number.isNaN(serverDate)) clockOffsetMs = serverDate - Date.now();
    } catch (error) {
      // Offline or the edge is unreachable: keep showing the last state and
      // try again on the next tick.
      console.warn("deploy page: status poll failed", error);
    }
    render();
  };

  render();
  void poll();
  setInterval(() => void poll(), POLL_MS);
}

start();
