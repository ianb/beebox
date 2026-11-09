/**
 * A short name for a shell command, for an activity line that has nothing
 * plainer to say: `bbx view check --json x && git status` → `bbx view check`,
 * one more. The full command stays in the expanded line.
 */

export interface CommandShorthand {
  /** The first command's leading words: `bbx view check`. */
  head: string;
  /** How many more commands the line ran (joined by `&&`, `||`, or `;`). */
  more: number;
}

const MAX_WORDS = 3;
/**
 * A word worth showing: a program or subcommand name, not a flag, path, or
 * quoted value. A program name may hold a dot (`python3.12`); a later word
 * with one is a file name (`notes.md`) and ends the shorthand.
 */
const PROGRAM = /^[A-Za-z][\w.:-]*$/;
const SUBCOMMAND = /^[A-Za-z][\w:-]*$/;
const ASSIGNMENT = /^[A-Z_a-z]\w*=/;

/**
 * Split a command line into commands on `&&`, `||`, `;`, and newlines outside
 * quotes, keeping only each command's first pipeline stage. Returns each
 * command's words; quoted text becomes one word with its quotes kept, so it
 * never reads as a bare word.
 */
function commands(line: string): string[][] {
  const result: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let piped = false;
  const endWord = () => {
    if (word !== "" && !piped) words.push(word);
    word = "";
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) result.push(words);
    words = [];
    piped = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote !== null) {
      word += c;
      if (c === "\\" && quote === '"') word += line.charAt(++i);
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      word += c;
    } else if (c === "\\") {
      word += c + line.charAt(++i);
    } else if ((c === "&" || c === "|") && line.charAt(i + 1) === c) {
      endCommand();
      i++;
    } else if (c === ";" || c === "\n") {
      endCommand();
    } else if (c === "|") {
      endWord();
      piped = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      word += c;
    }
  }
  endCommand();
  return result;
}

/** A command's showable leading words, after `VAR=x` prefixes; a path keeps its last part. */
function leadingWords(words: string[]): string[] {
  const rest = words.slice(words.findIndex((w) => !ASSIGNMENT.test(w)));
  const shown: string[] = [];
  for (const [i, raw] of rest.entries()) {
    const w = i === 0 && raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
    if (!(i === 0 ? PROGRAM : SUBCOMMAND).test(w) || shown.length === MAX_WORDS) break;
    shown.push(w);
  }
  return shown;
}

/**
 * The shorthand for a command line, or null when its first real command has
 * no showable leading word (it starts with a quote, `$(`, or a subshell).
 * `cd <dir>` commands only set up the next one, so they are skipped unless
 * they are all there is.
 */
export function commandShorthand(line: string): CommandShorthand | null {
  const all = commands(line).filter((words) => words.some((w) => !ASSIGNMENT.test(w)));
  const work = all.filter((words) => leadingWords(words)[0] !== "cd");
  const list = work.length > 0 ? work : all;
  const first = list[0];
  if (first === undefined) return null;
  const head = leadingWords(first);
  if (head.length === 0) return null;
  return { head: head.join(" "), more: list.length - 1 };
}
