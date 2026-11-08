/**
 * `bbx browser screenshot --card`: capture the card open in the box browser
 * whole, not the viewport (docs/plans/agent-self-view.md, Track C).
 *
 * The app shows a card inside a panel that scrolls on its own, and a browser
 * screenshot holds only what it painted. So: find the card, scroll its panel to
 * the top, measure; if part is unpainted, make the viewport taller (up to
 * `MAX_CAPTURE_HEIGHT`) and measure again; capture the card element; crop the
 * image to the painted part, so no blank area passes for content; put the
 * viewport back. The fit line comes from the measures, never the image size.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boxRelativePath } from "../../../shared/box-path.js";
import { controlAddress } from "../../../shared/ui-scan/control-address.js";
import type { ExecReply } from "../command-socket.js";
import { appBasePath } from "../app-url.js";
import { type CardShot, formatCardShot } from "./format.js";
import { type FoundMeasure, measureScript, parseMeasure } from "./measure.js";

/** The tallest viewport a capture uses. A taller card is reported partial. */
export const MAX_CAPTURE_HEIGHT = 8000;
/** Room for the app's own chrome above and below the card. */
const MARGIN = 40;

export interface CardShotIo {
  /** An ordinary agent-browser command. */
  readonly send: (args: readonly string[]) => Promise<ExecReply>;
  /** The same with whole output, for `eval`. */
  readonly sendFull: (args: readonly string[]) => Promise<ExecReply>;
}

export type CardShotResult = { ok: true; output: string; shot: CardShot } | { ok: false; message: string };

/** The card a box page URL shows: `/<slug>/views/<path>` or `/<slug>/chat?card=<path>`; null otherwise. */
export function cardPathFromUrl(pageUrl: string, box: { base: URL; slug: string }): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch (_e) {
    // about:blank or junk: not a box page.
    return null;
  }
  const prefix = `${appBasePath(box.base)}${box.slug}/`;
  if (url.origin !== box.base.origin || !url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length);
  if (rest.startsWith("views/")) {
    const raw = rest.slice("views/".length).split("/").map((part) => decodeURIComponent(part)).join("/");
    return raw === "" ? null : boxRelativePath(raw);
  }
  const card = rest === "chat" ? url.searchParams.get("card") : null;
  return card === null || card === "" ? null : boxRelativePath(card);
}

/** The panel id the app gives an open card (`workspacePanelId` in the frontend). */
export function cardPanelId(cardPath: string): string {
  return controlAddress("bbx-workspace-panel", cardPath);
}

async function measure(io: CardShotIo, panelId: string): Promise<{ ok: true; m: FoundMeasure } | { ok: false; message: string }> {
  const reply = await io.sendFull(["eval", measureScript(panelId)]);
  const m = reply.exitCode === 0 ? parseMeasure(reply.stdout) : null;
  if (m === null) return { ok: false, message: `bbx browser: could not measure the card: ${reply.stderr.trim() || reply.stdout.slice(0, 200)}` };
  if (!m.found) return { ok: false, message: `bbx browser: no open card was found on ${m.url} ("${m.title}"); open one with bbx browser open /views/<card path>` };
  return { ok: true, m };
}

async function command(io: CardShotIo, args: readonly string[]): Promise<string | null> {
  const reply = await io.send(args);
  return reply.exitCode === 0 ? null : `bbx browser: ${args.slice(0, 2).join(" ")} failed: ${reply.stderr.trim() || `exit code ${String(reply.exitCode)}`}`;
}

/** Crop the image to the painted part of the card, in device pixels. */
async function cropToPainted(imagePath: string, m: FoundMeasure): Promise<void> {
  // Loaded on use, as elsewhere: a native module most engine paths never need.
  const { default: Sharp } = await import("sharp");
  const image = Sharp(await fs.readFile(imagePath));
  const meta = await image.metadata();
  const scale = meta.width / m.card.width || m.dpr;
  const left = Math.max(0, Math.round(m.painted.x * scale));
  const top = Math.max(0, Math.round(m.painted.y * scale));
  const width = Math.min(meta.width - left, Math.round(m.painted.width * scale));
  const height = Math.min(meta.height - top, Math.round(m.painted.height * scale));
  if (width <= 0 || height <= 0) return;
  await fs.writeFile(imagePath, await image.extract({ left, top, width, height }).png().toBuffer());
}

function wholeCard(m: FoundMeasure): boolean {
  return m.painted.x <= 0.5 && m.painted.y <= 0.5 && m.painted.width >= m.card.width - 0.5 && m.painted.height >= m.card.height - 0.5;
}

/** Capture the open card. `outDir` is where the image goes. */
export async function captureCard(io: CardShotIo, box: { base: URL; slug: string; outDir: string }): Promise<CardShotResult> {
  const urlReply = await io.send(["get", "url"]);
  const pageUrl = urlReply.stdout.trim();
  const cardPath = cardPathFromUrl(pageUrl, box);
  if (cardPath === null) {
    return { ok: false, message: `bbx browser: --card works on this box's card pages; the browser is on ${pageUrl || "no page"}. Open one with bbx browser open /views/<card path>` };
  }
  const panelId = cardPanelId(cardPath);
  const first = await measure(io, panelId);
  if (!first.ok) return first;
  const { viewport } = first.m;
  let m = first.m;
  let resized = false;
  try {
    const missing = m.card.height - m.painted.height;
    if (missing > 0.5) {
      const height = Math.min(Math.ceil(viewport.height + missing + MARGIN), MAX_CAPTURE_HEIGHT);
      const failed = await command(io, ["set", "viewport", String(viewport.width), String(height)]);
      if (failed !== null) return { ok: false, message: failed };
      resized = true;
      const again = await measure(io, panelId);
      if (!again.ok) return again;
      m = again.m;
    }
    await fs.mkdir(box.outDir, { recursive: true });
    const stem = path.basename(cardPath).replace(/[^\w.-]/g, "_").slice(0, 60);
    const imagePath = path.join(box.outDir, `card-${stem}-${String(viewport.width)}px.png`);
    const failed = await command(io, ["screenshot", `#${panelId} > article`, imagePath]);
    if (failed !== null) return { ok: false, message: failed };
    if (!wholeCard(m)) await cropToPainted(imagePath, m);
    const shot: CardShot = { cardPath, imagePath, measure: m };
    return { ok: true, output: formatCardShot(shot), shot };
  } finally {
    if (resized) await io.send(["set", "viewport", String(viewport.width), String(viewport.height)]);
  }
}
