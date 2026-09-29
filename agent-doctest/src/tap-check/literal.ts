/**
 * Expected-literal normalization for check() (plan Track B1).
 *
 * An author can write an object result as a JS literal (`{ kind: "box" }`)
 * or compact JSON (`{"kind":"box"}`) when the actual value serializes as
 * indented JSON. On a failed text match, check() parses the expected text
 * here and re-serializes it the way the default serializer would, then runs
 * the ordinary text match again. There is no structural comparison.
 *
 * Grammar: JSON5-style literals only — objects, arrays, single- or
 * double-quoted strings, numbers, true/false/null, unquoted keys, trailing
 * commas. No expressions. A bare `«…»` wildcard in value or key position is
 * carried through as a placeholder and restored in the output; a wildcard
 * inside a quoted string needs nothing, since JSON.stringify keeps `«»` as is.
 */

import { parseWildcardToken } from "./wildcards.js";

// Private-use code points: JSON.stringify leaves them unescaped and real
// expected text does not contain them.
const VALUE_MARK = "";
const KEY_MARK = "";
const END_MARK = "";

/** Wildcard types whose values serialize as JSON strings, so a bare token needs quotes. */
const STRING_TYPES = new Set(["date", "uuid"]);

/**
 * Parse `expected` as a literal and serialize it as `JSON.stringify(v, null, 2)`,
 * with wildcards restored. Null when the text is not a literal.
 */
export function normalizeLiteral(expected: string): string | null {
  const parser = new LiteralParser(expected);
  const value = parser.parseDocument();
  if (value === FAIL) return null;
  const json = JSON.stringify(value, null, 2);
  return json.replace(new RegExp(`"([${VALUE_MARK}${KEY_MARK}]\\d+)${END_MARK}"`, "g"), (_m, ref: string) => {
    const token = parser.wildcards[Number(ref.slice(1))] ?? "«*»";
    if (ref.startsWith(KEY_MARK)) return `"${token}"`;
    const { type } = parseWildcardToken(token.slice(1, -1));
    return STRING_TYPES.has(type) ? `"${token}"` : token;
  });
}

const FAIL = Symbol("fail");
type Parsed = unknown;

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

class LiteralParser {
  private pos = 0;
  readonly wildcards: string[] = [];

  constructor(private readonly text: string) {}

  parseDocument(): Parsed {
    const value = this.value();
    this.ws();
    return value === FAIL || this.pos !== this.text.length ? FAIL : value;
  }

  private ws(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] ?? "")) this.pos++;
  }

  private value(): Parsed {
    this.ws();
    const c = this.text[this.pos];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string(c);
    if (c === "«") return this.wildcard(VALUE_MARK);
    const word = /^(?:true|false|null)\b/.exec(this.text.slice(this.pos));
    if (word) {
      this.pos += word[0].length;
      return word[0] === "null" ? null : word[0] === "true";
    }
    const num = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    return FAIL;
  }

  private wildcard(mark: string): Parsed {
    const end = this.text.indexOf("»", this.pos);
    if (end === -1) return FAIL;
    this.wildcards.push(this.text.slice(this.pos, end + 1));
    this.pos = end + 1;
    return `${mark}${this.wildcards.length - 1}${END_MARK}`;
  }

  private string(quote: string): Parsed {
    let out = "";
    this.pos++;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos++] ?? "";
      if (c === quote) return out;
      if (c === "\n") return FAIL;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const esc = this.text[this.pos++] ?? "";
      if (esc === "u") {
        const hex = /^[\dA-Fa-f]{4}/.exec(this.text.slice(this.pos));
        if (!hex) return FAIL;
        out += String.fromCodePoint(parseInt(hex[0], 16));
        this.pos += 4;
      } else {
        out += ESCAPES[esc] ?? esc;
      }
    }
    return FAIL;
  }

  private key(): Parsed {
    this.ws();
    const c = this.text[this.pos];
    if (c === '"' || c === "'") return this.string(c);
    if (c === "«") return this.wildcard(KEY_MARK);
    const ident = /^(?:[$A-Z_a-z][\w$]*|\d+)/.exec(this.text.slice(this.pos));
    if (!ident) return FAIL;
    this.pos += ident[0].length;
    return ident[0];
  }

  private object(): Parsed {
    this.pos++;
    const obj: Record<string, unknown> = {};
    for (;;) {
      this.ws();
      if (this.eat("}")) return obj;
      const key = this.key();
      this.ws();
      if (typeof key !== "string" || !this.eat(":")) return FAIL;
      const value = this.value();
      if (value === FAIL) return FAIL;
      // defineProperty so a "__proto__" key is data, as in a JS literal's JSON.
      Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
      this.ws();
      if (!this.eat(",")) {
        this.ws();
        return this.eat("}") ? obj : FAIL;
      }
    }
  }

  private array(): Parsed {
    this.pos++;
    const arr: unknown[] = [];
    for (;;) {
      this.ws();
      if (this.eat("]")) return arr;
      const value = this.value();
      if (value === FAIL) return FAIL;
      arr.push(value);
      this.ws();
      if (!this.eat(",")) {
        this.ws();
        return this.eat("]") ? arr : FAIL;
      }
    }
  }

  private eat(c: string): boolean {
    if (this.text[this.pos] !== c) return false;
    this.pos++;
    return true;
  }
}
