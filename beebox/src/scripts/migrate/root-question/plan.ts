/**
 * `root-question-2026-10` decision: given the text of a box's seeded root
 * question card, what to write.
 *
 * Boxes made before the fix hold two stock lines: a `learning.ref` without the
 * leading `/` (which `bbx validate` resolves against the card's own directory
 * and reports as broken) and a template `learning.proposal` with an unfilled
 * slot. The ref is corrected on a card in any state. The proposal is replaced
 * only while the question is still pending: an answered, dismissed, or expired
 * question keeps the text it was shown. Only a line that matches the stock text
 * exactly is touched, so a card a person or agent edited is left alone. Pure,
 * so the test reaches every case without a box.
 */

const OLD_REF_LINE = "  ref: _content/briefing.briefing.card";
// Pinned, not imported from the seed: the migration writes what it wrote when it shipped.
const NEW_REF_LINE = "  ref: /_content/briefing.briefing.card";
const OLD_PROPOSAL_LINE = "  proposal: This box is for <what the person said>.";
const NEW_PROPOSAL_LINE = "  proposal: The box does not know yet what it is for.";
const LIFECYCLE_LINE = /^(answered-at|dismissed-at|expired-at):/m;

export type RootQuestionPlan = { kind: "current" } | { kind: "write"; text: string; changes: string[] };

/**
 * Splits card text at its frontmatter block: the opening `---` through the
 * closing `---` line, and everything after it (the body, kept byte for byte).
 * Null when the text has no closed frontmatter block.
 */
function splitFrontmatter(text: string): { head: string; body: string } | null {
  if (!text.startsWith("---\n")) return null;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return null;
  const end = text.indexOf("\n", close + 1);
  const cut = end === -1 ? text.length : end;
  return { head: text.slice(0, cut), body: text.slice(cut) };
}

function replaceLine(head: string, { from, to }: { from: string; to: string }): string | null {
  const lines = head.split("\n");
  const index = lines.indexOf(from);
  if (index === -1) return null;
  lines[index] = to;
  return lines.join("\n");
}

export function planRootQuestion({ text }: { text: string }): RootQuestionPlan {
  const split = splitFrontmatter(text);
  if (split === null) return { kind: "current" };
  let head = split.head;
  const changes: string[] = [];
  const ref = replaceLine(head, { from: OLD_REF_LINE, to: NEW_REF_LINE });
  if (ref !== null) {
    head = ref;
    changes.push("learning.ref made root-relative");
  }
  if (!LIFECYCLE_LINE.test(head)) {
    const proposal = replaceLine(head, { from: OLD_PROPOSAL_LINE, to: NEW_PROPOSAL_LINE });
    if (proposal !== null) {
      head = proposal;
      changes.push("learning.proposal replaced");
    }
  }
  return changes.length === 0 ? { kind: "current" } : { kind: "write", text: head + split.body, changes };
}
