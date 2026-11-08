/**
 * The lines `bbx browser screenshot --card` prints after the image path
 * (docs/plans/agent-self-view.md, Track C): whether the image holds the whole
 * card, what inside it is wider than its box, and any view error it shows.
 * Pure, so the wording is tested without a browser.
 */

import type { FoundMeasure } from "./measure.js";

export interface CardShot {
  readonly cardPath: string;
  readonly imagePath: string;
  readonly measure: FoundMeasure;
}

function px(n: number): string {
  return `${String(Math.round(n))}px`;
}

/** "whole card (366×2027)", or what part of the card the image shows. */
export function fitLine(m: FoundMeasure): string {
  const missing: string[] = [];
  if (m.painted.y > 0.5 || m.painted.height < m.card.height - 0.5) {
    missing.push(`the image shows ${px(m.painted.height)} of the card's ${px(m.card.height)} height, from ${px(m.painted.y)} down`);
  }
  if (m.painted.x > 0.5 || m.painted.width < m.card.width - 0.5) {
    missing.push(`it shows ${px(m.painted.width)} of the card's ${px(m.card.width)} width`);
  }
  if (missing.length === 0) return `whole card (${String(Math.round(m.card.width))}×${String(Math.round(m.card.height))})`;
  return `partial: ${missing.join("; ")}`;
}

export function formatCardShot(shot: CardShot): string {
  const m = shot.measure;
  const lines = [
    `✓ Screenshot saved to ${shot.imagePath}`,
    `card: ${shot.cardPath} at ${px(m.viewport.width)} wide — ${fitLine(m)}`,
    ...m.overflow.map((o) => `overflow: <${o.tag}> "${o.text}" is ${px(o.excess)} wider than its box`),
    ...(m.errorText === null ? [] : [`view error: ${m.errorText}`]),
  ];
  return `${lines.join("\n")}\n`;
}
