/**
 * Dev-only route (/dev/speech) hosting the speech menu test harness. Thin
 * wrapper so the harness UI lives under a components/ dir (exempt from the
 * page className restriction). See SpeechTestHarness for details.
 */

import { SpeechTestHarness } from "./components/SpeechTestHarness";

export function SpeechTestPage() {
  return <SpeechTestHarness />;
}
