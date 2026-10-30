/**
 * The one phase to `Badge` tone map, for every surface that shows a commit's
 * `Phase` trailer (commit list, commit detail, dashboard activity). Phases
 * not listed render neutral.
 */

import type { BadgeTone } from "../ui/Badge";

const PHASE_TONE: Record<string, BadgeTone> = {
  intake: "info",
  transcribe: "info",
  "describe-images": "info",
  triage: "info",
  refresh: "info",
  summarize: "warning",
  "plan-extraction": "warning",
  assemble: "warning",
  extract: "warning",
  analyze: "warning",
  archive: "success",
  brief: "success",
};

export function phaseTone(phase: string): BadgeTone {
  return Object.hasOwn(PHASE_TONE, phase) ? PHASE_TONE[phase] ?? "neutral" : "neutral";
}
