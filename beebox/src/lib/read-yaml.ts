/**
 * Read-only YAML parsing: text to plain values, as the `yaml` package reads
 * it, but faster.
 *
 * js-yaml is 4–7× faster than `yaml` on box cards
 * (`docs/implemented-plans/yaml-read-parser.md`), so it parses first. Where the two could
 * read the same text differently, `yaml` parses instead, so every result and
 * every error is `yaml`'s:
 *
 * - js-yaml throws: an unknown tag, a duplicate key, malformed text. `yaml`
 *   then returns its own value or throws its own error, with its wording.
 * - The text has a construct js-yaml resolves differently or does not limit
 *   ({@link YAML_ONLY}), or a flow collection continued on the next line
 *   ({@link hasOpenFlowLine}).
 *
 * `pnpm perf:yaml-read` checks the two agree on a box's files.
 *
 * Writing and editing YAML stays on `yaml`: `stringify`, and `parseDocument`
 * for edits that keep a block's comments and quoting; js-yaml has no document
 * model.
 */

import { CORE_SCHEMA, load } from "js-yaml";
import { parse } from "yaml";

/**
 * Text that js-yaml reads differently from `yaml`'s YAML 1.2 core schema, or
 * without `yaml`'s alias-expansion limit. A match only sends the text to the
 * slower parser, so the patterns may over-match quoted text. Each repetition
 * starts at most once per run of the characters it repeats over, so the test
 * stays linear on long frontmatter (an earlier pattern took seconds on a 77 KB
 * card).
 *
 * - an anchor (`&a`), so aliases expand under `yaml`'s limit
 * - a tag (`!foo`, `!!binary`)
 * - a directive (`%YAML 1.1` switches `yaml` to the 1.1 schema), or a line
 *   starting `---` or `...`, which js-yaml takes as a document marker even in
 *   a key (`---x: v`)
 * - a bare carriage return, which `yaml` rejects
 * - a signed `0x`/`0o`/`0b`, a signed zero, or a signed leading-dot float
 *   (`-0x1`, `-0`, `+.5`), and an unsigned `0b` literal
 * - a number that may overflow to `Infinity`, which js-yaml reads as a
 *   string: a three-digit exponent (`1e999`), or 300 digits
 * - a null key (`~:`, `null:`) or an empty key in a flow collection
 *   (`{: a}`), which `yaml` reads as `""`; js-yaml rejects an empty block key,
 *   so that one reaches `yaml` through the catch
 * - a collection as a key (`[a]: b`, `{a: 1}: b`, `{[1, 2]: v}`): a closing
 *   bracket followed by a key's colon, or an explicit `? ` key
 */
const YAML_ONLY = [
  /(?:^|[\s,:[{-])[!&]\S|^%|^(?:-{3}|\.{3})|\r(?!\n)/m,
  /(?:^|[\s,:[{])(?:[+-](?:0(?:[box]|(?=[\s,\]}]|$))|\.\d)|0b)/m,
  /(?:^|[\s,:[{])[+-]?(?:\d+(?:\.\d*)?|\.\d+)[Ee][+-]?\d{3,}(?=[\s,:\]}]|$)|(?<![\dA-Fa-f])(?:\d{300}|0x[\dA-Fa-f]{250})/m,
  /^[\t ]*(?:-[\t ]+)?(?:~|null|Null|NULL)[\t ]*:|[,[{](?![,[{])[\t ]*(?:~|null|Null|NULL)[\t ]*:|[,[{](?![,[{])[\t ]*:/m,
  /[\]}](?![\]}])[\t ]*:(?:[\t ]|$)|^[\t ]*(?:-[\t ]+)?\?(?:[\t ]|$)/m,
];

/**
 * Whether a line opens more flow brackets (`[`, `{`) than it closes: a flow
 * collection that continues on the next line. js-yaml accepts some
 * continuation lines that `yaml` rejects as under-indented. Brackets inside
 * quotes count too, so this over-matches.
 */
function hasOpenFlowLine(text: string): boolean {
  let open = 0;
  for (const char of text) {
    if (char === "[" || char === "{") open++;
    else if (char === "]" || char === "}") open--;
    else if (char === "\n") {
      if (open > 0) return true;
      open = 0;
    }
  }
  return false;
}

/** YAML text as plain values. Empty or comment-only text is `null`. */
export function parseYaml(text: string): unknown {
  if (YAML_ONLY.some((pattern) => pattern.test(text)) || hasOpenFlowLine(text)) return parse(text);
  try {
    return load(text, { schema: CORE_SCHEMA }) ?? null;
  } catch (_e) {
    // `yaml` decides: its value where it accepts the text, else its error.
    return parse(text);
  }
}
