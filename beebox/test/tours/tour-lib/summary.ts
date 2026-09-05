/**
 * Render a tour run as a markdown summary. Each checkpoint becomes a
 * section with both viewport screenshots inlined side-by-side and the
 * axe violations listed in order of impact. Findings (soft assertions)
 * are listed at the top so you see them first when opening the file.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheckpointRecord, Finding, TourDefinition, TourResult } from "./types.js";

interface SummaryInput {
  tour: TourDefinition;
  startedAt: string;
  durationMs: number;
  artifactsDir: string;
  checkpoints: CheckpointRecord[];
  findings: Finding[];
}

export async function writeSummary(input: SummaryInput): Promise<TourResult> {
  const summaryPath = path.join(input.artifactsDir, "summary.md");
  const body = renderSummary(input);

  await writeFile(summaryPath, body, "utf8");
  return {
    tour: input.tour,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    artifactsDir: input.artifactsDir,
    checkpoints: input.checkpoints,
    findings: input.findings,
    summaryPath,
  };
}

function renderSummary(input: SummaryInput): string {
  const { tour, startedAt, durationMs, checkpoints, findings, artifactsDir } = input;
  const out: string[] = [];
  out.push(`# Tour: ${tour.name}`);
  out.push("");
  out.push(tour.description);
  out.push("");
  out.push(`- Run started: ${startedAt}`);
  out.push(`- Duration: ${(durationMs / 1000).toFixed(1)}s`);
  out.push(`- Checkpoints: ${checkpoints.length}`);
  const totalViolations = checkpoints.reduce(
    (sum, cp) => sum + cp.artifacts.reduce((s, a) => s + a.axeViolationCount, 0),
    0,
  );
  out.push(`- axe violations across all checkpoints: ${totalViolations}`);
  out.push(`- Findings (soft assertions): ${findings.length}`);
  out.push("");

  if (findings.length > 0) {
    out.push("## Findings");
    out.push("");
    for (const f of findings) {
      const marker = f.severity === "fail" ? "❌" : f.severity === "warn" ? "⚠️" : "ℹ️";
      out.push(`- ${marker} **${f.checkpoint}** [${f.viewport}] — ${f.message}`);
    }
    out.push("");
  }

  for (const cp of checkpoints) {
    out.push(`## Checkpoint: ${cp.name}`);
    out.push("");
    out.push(`- URL: ${cp.url}`);
    out.push(`- Title: ${cp.title}`);
    out.push("");
    for (const a of cp.artifacts) {
      const rel = path.relative(artifactsDir, a.screenshotPath);
      out.push(`### ${a.viewport} (${a.axeViolationCount} axe violations)`);
      out.push("");
      out.push(`![${cp.name} ${a.viewport}](${rel})`);
      out.push("");
      out.push(`- AX tree: \`${path.basename(a.axSnapshotPath)}\``);
      out.push(`- axe report: \`${path.basename(a.axeReportPath)}\``);
      out.push("");
    }
  }

  return out.join("\n");
}
