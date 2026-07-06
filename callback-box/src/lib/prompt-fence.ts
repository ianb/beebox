/**
 * Fenced-block wrapping for untrusted content that crosses into an agent
 * prompt — the masquerade floor. When a card body, a referenced file, or any
 * external text is embedded in a prompt inside a ``` ``` ``` code fence, a run
 * of backticks in that content could otherwise close the fence early and let
 * the remainder pose as prompt structure ("out of the fence, in the
 * instructions"). {@link fenceForPrompt} emits a fence strictly longer than any
 * backtick run in the content, so the content cannot break out.
 *
 * Scope (from the trust-marking research, Track I): fencing stops
 * masquerade-as-structure, NOT instruction-following — a model that decides to
 * obey text inside a correctly-fenced block is a separate problem, addressed by
 * least-privilege tool access, not by this function. This is the CommonMark
 * dynamic-fence rule (one more backtick than the longest run), hand-rolled
 * because no adoptable library exists.
 *
 * Design stances:
 *  - **Minimum length 3** — CommonMark's floor for a fenced code block.
 *  - **No upper cap.** The fence is `max(3, longestRun + 1)`. A cap would
 *    reintroduce the hole it exists to close: content whose backtick run
 *    reaches the cap could close the fence. Output length is bounded by input
 *    length (a pathological run of N backticks yields an N+1 fence and nothing
 *    worse), so there is no unbounded blow-up to defend against — capping trades
 *    a security property for a bound we don't need.
 *  - **Backtick fences only.** Tilde runs in the content are ignored: a backtick
 *    fence cannot be closed by a tilde line (CommonMark requires the closing
 *    fence to use the same character), so tilde-fenced content nests safely
 *    inside without inflating our fence.
 *  - **Closing fence on its own line.** A trailing newline is ensured before the
 *    closing fence (added when the content lacks one — which also covers a bare
 *    `\r` ending). Empty content yields a valid empty block (open fence, newline,
 *    close fence) rather than a degenerate one.
 *  - **No info string.** We emit a bare fence; the info string is the callers'
 *    business (headers around the block), and an info string cannot carry
 *    backticks anyway.
 */

/**
 * Prompt text proven safe to embed as-is: any untrusted content it carries has
 * been fenced so it cannot masquerade as prompt structure. Produced ONLY by
 * {@link fenceForPrompt} — this is the sole producer, so a bare
 * `as PromptSafeText` is scrutiny-worthy under the `as` convention. The brand is
 * runtime-erased (a JSON round-trip or any re-cast launders it), so re-establish
 * it by re-fencing at each boundary rather than trusting a carried value.
 */
declare const promptSafeBrand: unique symbol;
export type PromptSafeText = string & { readonly [promptSafeBrand]: true };

/** Length of the longest run of consecutive backticks in `content` (0 if none). */
function longestBacktickRun(content: string): number {
  const runs = content.match(/`+/g);
  if (runs === null) return 0;
  let longest = 0;
  for (const run of runs) {
    if (run.length > longest) longest = run.length;
  }
  return longest;
}

/**
 * Wrap `content` in a code fence long enough that no backtick run inside it can
 * close the fence, returning the branded fenced block. See the module comment
 * for the length, newline, and tilde stances.
 */
export function fenceForPrompt(content: string): PromptSafeText {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  // The closing fence must begin its own line; ensure a trailing newline unless
  // the content is empty (an empty block has no interior line at all).
  const body = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
  return `${fence}\n${body}${fence}` as PromptSafeText;
}
