/**
 * Detection helpers for the `<context-directory>` auto-seed sent when
 * a chat is started from a landmark. Lives in lib/ so it can be unit
 * tested without pulling in React.
 *
 * The matcher is intentionally strict: it only fires when the user
 * message is *exactly* one `<context-directory ref="...">…</context-directory>`
 * directive. A real user message that happens to mention the tag in
 * passing should NOT render as a context chip.
 */

const TYPED_OPEN = /<typed[^>]*>/gi;
const TYPED_CLOSE = /<\/typed>/gi;
const SPEECH_OPEN = /<speech[^>]*>/gi;
const SPEECH_CLOSE = /<\/speech>/gi;

// Negative lookahead in the body forces the match to stop at the FIRST
// </context-directory>; combined with `\s*$` afterwards, that means a
// second adjacent directive (or any trailing content) makes the whole
// match fail. A lazy `[\S\s]*?` would happily backtrack past the first
// closer to satisfy `\s*$`, capturing only the first ref but accepting
// inputs that aren't a single directive.
const CONTEXT_DIRECTORY_RE =
  /^\s*<context-directory\s+ref="([^"]+)"\s*>(?:(?!<\/context-directory>)[\S\s])*<\/context-directory>\s*$/;

function stripWrapper(text: string): string {
  return text
    .replace(TYPED_OPEN, "")
    .replace(TYPED_CLOSE, "")
    .replace(SPEECH_OPEN, "")
    .replace(SPEECH_CLOSE, "");
}

/**
 * If the joined user-message text consists of exactly one
 * `<context-directory>` directive (optionally inside a `<typed>` /
 * `<speech>` wrapper), return its `ref`. Otherwise null.
 *
 * @param texts - The text segments of a user message; joined with
 *   newlines after stripping outer typed/speech wrappers.
 */
export function parseContextDirective(texts: string[]): { dir: string } | null {
  const combined = texts.map(stripWrapper).join("\n").trim();
  const match = combined.match(CONTEXT_DIRECTORY_RE);
  if (!match) return null;
  return { dir: match[1] };
}
