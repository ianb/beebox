/**
 * Finds skill invocations (`/finish`, `$finish`) in a briefing's prose. A
 * briefing is the first message of a launched session, and both sigils are
 * invocation syntax there: a Codex session briefed "land only through
 * $finish" ran finish on its first turn (2026-09-20). Fenced code blocks are
 * skipped; inline code spans are not, because that incident's sigil sat
 * inside backticks and a code span is still read as an instruction.
 *
 * Only names that are skill directories count, so paths (`bin/finish-verify`,
 * `.claude/skills/finish/`) and URLs (`:3210/browse/`) do not match.
 */

export interface SigilHit {
  /** The offending token as written, e.g. `$finish`. */
  token: string;
  /** 1-based line number in the briefing. */
  line: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Replaces every character except newlines with a space, keeping offsets. */
function blank(text: string): string {
  return text.replaceAll(/[^\n]/g, " ");
}

/** Blanks fenced code blocks (an unclosed fence runs to the end, as in CommonMark). */
function blankFences(text: string): string {
  const lines = text.split("\n");
  let fence: { char: string; length: number } | null = null;
  return lines
    .map((line) => {
      if (fence) {
        const close = FENCE_CLOSE.exec(line)?.[1] ?? "";
        if (close.startsWith(fence.char) && close.length >= fence.length) fence = null;
        return blank(line);
      }
      const open = FENCE_OPEN.exec(line);
      if (open?.[1]) {
        fence = { char: open[1].charAt(0), length: open[1].length };
        return blank(line);
      }
      return line;
    })
    .join("\n");
}


/** Strips code and returns prose with the original character offsets. */
function proseOnly(text: string): string {
  return blankFences(text);
}

// A sigil starts a token: not after a word character or a path/URL/variable
// character. The name ends at a word boundary that is not a path (`/`), a
// longer name (`-`), or a file extension (`.md`).
const SIGIL = /(?<![\w$./:@\\~-])([$/])([\da-z][\w-]*)(?![\w/-]|\.\w)/gi;

/** Skill sigils in the prose of `text`, in order, for names in `skills`. */
export function findSkillSigils(text: string, skills: ReadonlySet<string>): SigilHit[] {
  const prose = proseOnly(text);
  const hits: SigilHit[] = [];
  for (const m of prose.matchAll(SIGIL)) {
    const name = m[2] ?? "";
    if (!skills.has(name)) continue;
    const line = prose.slice(0, m.index).split("\n").length;
    hits.push({ token: `${m[1] ?? ""}${name}`, line });
  }
  return hits;
}
