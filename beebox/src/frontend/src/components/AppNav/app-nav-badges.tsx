/**
 * The app bar's attention badges, with the console error count read from the
 * debug log. The drawing is `AttentionBadgesFace` (app-bar-faces/), which the
 * theme studio renders with fixed counts.
 */

import { useErrorCount, clearErrorCount, hasDebugLogBeenOpened } from "../DebugLog";
import { AttentionBadgesFace } from "../app-bar-faces/AttentionBadgesFace";
import { useQuestionToggle } from "../questions/question-tab";

export function AttentionBadges({ onToggleDebugLog, ...counts }: {
  base: string;
  pendingQuestions: number;
  onPlateTodos: number;
  /** Of `onPlateTodos`, how many are past due. */
  escalatedTodos: number;
  onToggleDebugLog: () => void;
}) {
  const errorCount = useErrorCount();
  const questionToggle = useQuestionToggle();
  // A developer affordance: the count accumulates from the first error, but the
  // badge stays hidden until the person has opened the debug log at least once
  // in this browser, so a first-run screen never leads with one. The profile
  // menu's "Debug Log" item is the always-reachable path in.
  return <AttentionBadgesFace {...counts} questionToggle={questionToggle} errorCount={hasDebugLogBeenOpened() ? errorCount : 0}
    onOpenErrors={() => { clearErrorCount(); onToggleDebugLog(); }} />;
}

