/**
 * The composer's attachment tokens — the statement of record for their grammar.
 *
 * An attachment the user adds to a message is anchored *in the text* by a
 * token: `[image#1]`, `[file#2]`, `[selection#3]`. The token is what lets a
 * photo sit mid-sentence instead of being appended in an arbitrary order, and
 * it is the join between the two halves of a composition — the text and the
 * attachment list — which are stored separately and edited by four different
 * writers (the Add-files menu, paste, the bulk-upload fold, draft restoration).
 *
 * **Write the current form; read both.** The `#` was added 2026-08-25 (it makes
 * a token easier to pick out of a sentence and to edit around). Everything that
 * already exists carries the older `[image1]` form: every stored transcript on
 * every box, every persisted composer draft in `localStorage` and on a phone,
 * and every installed iOS build until it updates. So {@link composerToken} is
 * the ONE writer, and every reader spells the id part `#?(\d+)` so it matches
 * either form — grep `#?(\\d+)]` to find them all. They are deliberately
 * literal regexes at their call sites rather than built from a source string
 * here: each reader wraps the token in its own surrounding grammar (whitespace
 * it absorbs, a trailing `: <path>` in the `<attachments>` block), and a
 * literal reads plainly and keeps its own `lastIndex`.
 *
 * Readers, as of this writing: `input/emission-store.ts` (strip on removal),
 * `lib/selection/serialize.ts` (fold a selection into the body),
 * `components/chat/message-parsing.ts` (hide sent tokens; parse the
 * `<attachments>` block), `shared/chat-content-blocks.ts` (split text into
 * image blocks), `core/chat/session/accepted-messages.ts` and
 * `core/chat/session/state.ts`.
 *
 * Pure TypeScript, no React/DOM/Node — same convention as
 * `chat-content-blocks.ts`, which imports this and is used by both ends. The
 * iOS composer cannot import it and holds its own copy
 * (`ios-app/BeeBox/Models/ComposerToken.swift`);
 * `docs/mobile-contract.md` is the cross-platform statement of record.
 */

/** The three things a composer token can anchor. */
export type ComposerTokenKind = "image" | "file" | "selection";

/** The token for `id`, in the current form: `composerToken("image", 1)` → `[image#1]`. */
export function composerToken(kind: ComposerTokenKind, id: number): string {
  return `[${kind}#${String(id)}]`;
}

/**
 * The token for this attachment **as `text` actually spells it**, or null when
 * `text` does not anchor it at all.
 *
 * Returning the spelling rather than a boolean is what keeps one message
 * internally consistent: the `<attachments>` block a send writes must label
 * each file the way the body refers to it, and a body restored from a
 * pre-rename draft still says `[file1]`. A caller that only needs presence can
 * compare against null.
 */
export function composerTokenIn(text: string, target: { kind: ComposerTokenKind; id: number }): string | null {
  const { kind, id } = target;
  const current = composerToken(kind, id);
  if (text.includes(current)) return current;
  const legacy = `[${kind}${String(id)}]`;
  return text.includes(legacy) ? legacy : null;
}

/**
 * Rewrite every legacy `[image1]` token in `text` to the current `[image#1]`
 * form, leaving everything else — including a lookalike the user typed for an
 * attachment that does not exist — exactly as it is.
 *
 * Applied where a composition written before the rename re-enters a live
 * composer (restoring a persisted draft), so what the user is handed back reads
 * like a freshly-attached one, and so the `<attachments>` block a later send
 * writes matches the tokens in its own body.
 */
export function normalizeComposerTokens(text: string): string {
  return text
    .replace(/\[image#?(\d+)]/g, (_m, digits: string) => composerToken("image", parseInt(digits, 10)))
    .replace(/\[file#?(\d+)]/g, (_m, digits: string) => composerToken("file", parseInt(digits, 10)))
    .replace(/\[selection#?(\d+)]/g, (_m, digits: string) => composerToken("selection", parseInt(digits, 10)));
}
