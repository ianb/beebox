/**
 * Read-only YAML parsing: text to plain values, as the `yaml` package reads
 * it, but faster.
 *
 * js-yaml is 4–7× faster than `yaml` on box cards
 * (`docs/plans/yaml-read-parser.md`), so it parses first. Where the two could
 * read the same text differently, `yaml` parses instead, so every result and
 * every error is `yaml`'s:
 *
 * - js-yaml throws: an unknown tag, a duplicate key, malformed text. `yaml`
 *   then returns its own value or throws its own error, with its wording.
 * - The text has a construct js-yaml resolves differently or does not limit
 *   ({@link YAML_ONLY}).
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
 * slower parser, so the patterns may over-match quoted text. Every
 * repetition starts after a fixed character and stops at a line end, so the
 * test stays linear on long frontmatter (`[\s,]\s*` and `[^\n]*` took seconds
 * on a 77 KB card).
 *
 * - an anchor (`&a`), so aliases expand under `yaml`'s limit
 * - a tag (`!foo`, `!!binary`)
 * - a directive (`%YAML 1.1` switches `yaml` to the 1.1 schema)
 * - a signed `0x`/`0o`/`0b`/zero or a signed leading-dot float (`-0x1`,
 *   `+.5`, `-0`), and an unsigned `0b` literal
 * - a null key (`~:`, `null:`) or an empty key in a flow collection
 *   (`{: a}`), which `yaml` reads as `""`; js-yaml rejects an empty block key,
 *   so that one reaches `yaml` through the catch
 * - a collection as a key (`[a]: b`, `{a: 1}: b`, `{[1, 2]: v}`): a closing
 *   bracket followed by a key's colon, or an explicit `? ` key
 */
const YAML_ONLY =
  /(?:^|[\s,:[{-])[!&]\S|^%|(?:^|[\s,:[{])(?:[+-](?:0|\.\d)|0b)|^[\t ]*(?:-[\t ]+)?(?:~|null|Null|NULL)[\t ]*:|[,[{][\t ]*(?:~|null|Null|NULL)?[\t ]*:|[\]}][\t ]*:(?:[\t ]|$)|^[\t ]*(?:-[\t ]+)?\?(?:[\t ]|$)/m;

/** YAML text as plain values. Empty or comment-only text is `null`. */
export function parseYaml(text: string): unknown {
  if (YAML_ONLY.test(text)) return parse(text);
  try {
    return load(text, { schema: CORE_SCHEMA }) ?? null;
  } catch (_e) {
    // `yaml` decides: its value where it accepts the text, else its error.
    return parse(text);
  }
}
