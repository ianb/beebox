/**
 * `bin/quota-room` — each weekly window's use against the clock, the Codex
 * reviewer `bin/cross-model-run --hard` would pick now, and the measured cost of a
 * review by model. Logic lives in `bin/lib/quota-room.ts`.
 */

import { collectAgentQuotas } from "../workstreams-app/src/server/main/quota-collect.js";
import {
  ledgerPath,
  pickCodexReviewModel,
  readReviewCosts,
  summarizeCosts,
  windowRoom,
} from "./lib/quota-room.js";

const now = new Date();
const quotas = await collectAgentQuotas({});
const lines: string[] = [];
for (const quota of quotas) {
  if (quota.status !== "available") {
    lines.push(`${quota.provider}: unavailable (${quota.message ?? "no reason given"})`);
    continue;
  }
  if (quota.stale === true) {
    lines.push(`${quota.provider}: stale reading from ${quota.fetchedAt}; room below is computed from it (${quota.message ?? "refresh pending"})`);
  }
  for (const window of quota.windows) {
    const room = windowRoom(window, now);
    if (room === null) continue;
    const signed = room.room >= 0 ? `+${room.room.toFixed(0)}` : room.room.toFixed(0);
    const pace = room.projectedPercent === null ? "pace unknown yet" : `pace ${room.projectedPercent.toFixed(0)}% at reset`;
    lines.push(
      `${quota.provider.padEnd(6)} ${room.label.padEnd(24)} used ${room.usedPercent.toFixed(0).padStart(3)}%`
      + `  elapsed ${room.elapsedPercent.toFixed(0).padStart(3)}%  room ${signed.padStart(4)}  ${pace}`
      + `  resets ${room.resetsAt.slice(0, 16).replace("T", " ")}Z`,
    );
  }
}
const codex = quotas.find((quota) => quota.provider === "codex");
if (codex !== undefined) {
  const pick = pickCodexReviewModel(codex, now);
  lines.push("", `cross-model codex reviewer for a --hard review: ${pick.model} (${pick.reason})`);
}
const costs = summarizeCosts(readReviewCosts(ledgerPath()));
lines.push("", costs.length === 0
  ? "review cost: no measured reviews yet"
  : `review cost, mean Codex 7-day points per review: ${costs.map((c) => `${c.model} ${c.meanPoints.toFixed(2)} (${c.runs} runs)`).join(", ")}`);
process.stdout.write(`${lines.join("\n")}\n`);
