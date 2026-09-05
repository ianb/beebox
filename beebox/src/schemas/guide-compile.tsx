/**
 * Compile a parsed guide into concise actionable markdown for
 * job-processing agents — strips evidence metadata, concluded experiments,
 * and past context, keeping only what an agent needs to act.
 */

import { type ParsedGuide } from "./guide-elements.js";

/**
 * Compile a parsed guide into concise actionable markdown.
 *
 * Strips evidence metadata, concluded experiments, past context.
 * Keeps only what a job-processing agent needs.
 */
export function compileGuide(parsed: ParsedGuide, guideName: string): string {
  const lines: string[] = [];
  const title = guideName.charAt(0).toUpperCase() + guideName.slice(1);
  lines.push(`# ${title} Guide`);
  lines.push("");

  if (parsed.appliesTo) {
    lines.push(parsed.appliesTo);
    lines.push("");
  }

  // Triage rules (skip hypothesis-level)
  const significantRules = parsed.triageRules.filter(
    (r) => r.confidence !== "hypothesis"
  );
  if (significantRules.length > 0 || parsed.defaultAction) {
    lines.push("## Triage Rules");
    lines.push("");
    for (const rule of significantRules) {
      const actionLabel = rule.action ? `**${rule.action}**` : "**Note**";
      lines.push(`- ${actionLabel}: ${rule.text}`);
    }
    if (parsed.defaultAction) {
      const text = parsed.defaultAction.text
        ? ` — ${parsed.defaultAction.text}`
        : "";
      lines.push(`- **Default → ${parsed.defaultAction.action}**${text}`);
    }
    lines.push("");
  }

  // Actions
  if (parsed.actions.length > 0) {
    lines.push("## Actions");
    lines.push("");
    for (const action of parsed.actions) {
      lines.push(`### ${action.name}`);
      if (action.when) {
        lines.push(`**When:** ${action.when}`);
      }
      if (action.instructions) {
        lines.push(action.instructions);
      }
      lines.push("");
    }
  }

  // Active experiments only (proposed or active)
  const activeExperiments = parsed.experiments.filter(
    (e) => e.status === "active" || e.status === "proposed"
  );
  if (activeExperiments.length > 0) {
    lines.push("## Active Experiments");
    lines.push("");
    for (const exp of activeExperiments) {
      const status = exp.status === "proposed" ? " (proposed)" : "";
      const hypothesis = exp.hypothesis ? `: ${exp.hypothesis}` : "";
      lines.push(`- **${exp.id}**${status}${hypothesis}`);
      if (exp.approach) {
        lines.push(`  Approach: ${exp.approach}`);
      }
    }
    lines.push("");
  }

  // Context (ongoing and temporary only)
  const currentContext = parsed.contextNotes.filter(
    (c) => c.duration !== "past"
  );
  if (currentContext.length > 0) {
    lines.push("## Context");
    lines.push("");
    for (const note of currentContext) {
      const label = note.duration === "temporary" ? " (temporary)" : "";
      lines.push(`- ${note.text}${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
