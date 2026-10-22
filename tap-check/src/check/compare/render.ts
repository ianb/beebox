/**
 * Values printed as TypeScript source: the two sides of a failure diff, and
 * the suggested expected value an agent pastes into `t.check`.
 *
 * Objects and arrays always print one entry per line, so a line diff points
 * at the entry that differs.
 */

/** Text printed verbatim: a pattern's source, or a marker. */
export class Source {
  constructor(readonly text: string) {}
}

/** A call printed as `name(arg)`, e.g. `unordered([...])`. */
export class Call {
  constructor(
    readonly name: string,
    readonly arg: unknown,
  ) {}
}

/** The display key for an expected object's `[others]` entry, printed as `[others]: <pattern>`. */
export const OTHERS_KEY: unique symbol = Symbol("[others]");

const IDENT = /^[$A-Z_a-z][\w$]*$/;

function key(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

function stringLiteral(value: string): string {
  if (!value.includes("\n")) return JSON.stringify(value);
  return `\`${value.replace(/[\\`]/g, "\\$&").replace(/\${/g, "\\${")}\``;
}

/** Print `value` as TypeScript source at the given indent. */
export function render(value: unknown, indent = ""): string {
  return new Renderer().render(value, indent);
}

class Renderer {
  private readonly seen = new Set<object>();

  render(value: unknown, indent: string): string {
    if (value instanceof Source) return value.text;
    if (value instanceof Call) return `${value.name}(${this.render(value.arg, indent)})`;
    if (typeof value === "string") return stringLiteral(value);
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (typeof value === "symbol") return value.toString();
    if (Object.is(value, -0)) return "-0";
    if (value === null || typeof value !== "object") return String(value);
    if (value instanceof Date) return `new Date(${JSON.stringify(Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString())})`;
    if (value instanceof RegExp) return String(value);
    if (this.seen.has(value)) return "[Circular]";
    this.seen.add(value);
    try {
      return this.renderObject(value, indent);
    } finally {
      this.seen.delete(value);
    }
  }

  private lines(entries: string[], frame: { open: string; close: string; indent: string }): string {
    const { open, close, indent } = frame;
    if (entries.length === 0) return `${open}${close}`;
    const inner = `${indent}  `;
    return `${open}\n${entries.map((e) => `${inner}${e},`).join("\n")}\n${indent}${close}`;
  }

  private renderObject(value: object, indent: string): string {
    const inner = `${indent}  `;
    if (Array.isArray(value)) return this.lines(value.map((v) => this.render(v, inner)), { open: "[", close: "]", indent });
    if (value instanceof Map) {
      const entries = [...value].map(([k, v]) => `[${this.render(k, inner)}, ${this.render(v, inner)}]`);
      return entries.length === 0 ? "new Map()" : this.lines(entries, { open: "new Map([", close: "])", indent });
    }
    if (value instanceof Set) {
      const entries = [...value].map((v) => this.render(v, inner));
      return entries.length === 0 ? "new Set()" : this.lines(entries, { open: "new Set([", close: "])", indent });
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const items = Array.from(value as unknown as ArrayLike<number>, String);
      return `new ${value.constructor.name}([${items.join(", ")}])`;
    }
    const entries = Object.entries(value).map(([k, v]) => `${key(k)}: ${this.render(v, inner)}`);
    const rest: unknown = (value as { [OTHERS_KEY]?: unknown })[OTHERS_KEY];
    if (rest !== undefined) entries.push(`[others]: ${this.render(rest, inner)}`);
    return this.lines(entries, { open: "{", close: "}", indent });
  }
}
