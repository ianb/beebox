/**
 * Filler for DOCS in `guide.md` (`{{engine_source_note}}`): the sentence
 * offering the engine's source as the fallback reference, present only when
 * the source ships beside the package docs (a checkout; a packed install
 * ships only `dist`).
 */

export function engineSourceNote(engineSourcePresent: boolean): string {
  return engineSourcePresent ?
    " When a doc doesn't settle it, the engine's source is at `node_modules/beebox/src/`." :
    "";
}
