/**
 * Dev-only route (/dev/composer-states) hosting the composer-states gallery.
 * Thin wrapper so the harness UI lives under a components/ dir (exempt from
 * the page className restriction). See ComposerStatesHarness for details.
 */

import { ComposerStatesHarness } from "./components/ComposerStatesHarness";

export function ComposerStatesPage() {
  return <ComposerStatesHarness />;
}
