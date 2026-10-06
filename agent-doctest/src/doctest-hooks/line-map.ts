/**
 * From generated-module lines back to `.doctest.md` lines.
 *
 * The generator knows which markdown line each generated line came from; it
 * records that in a line map. Two consumers read it: the loader, to place an
 * esbuild parse error on the markdown line, and the source map attached to
 * the transformed module, so a runtime stack trace names the markdown line
 * instead of a line of generated code that the author has never seen.
 */

/** One generated line and the markdown line it came from (null: generated). */
export interface GenLine {
  text: string;
  md: number | null;
  /** Characters the generator added before the author's text on this line. */
  col: number;
}

/** Generated line index (0-based) → markdown line (1-based) and column shift. */
export interface LineMap {
  md: Array<number | null>;
  col: number[];
}

export function buildLineMap(lines: GenLine[]): LineMap {
  return { md: lines.map((l) => l.md), col: lines.map((l) => l.col) };
}

// ── Base64 VLQ ───────────────────────────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

function encodeVlq(values: number[]): string {
  let out = "";
  for (const v of values) {
    let n = v < 0 ? (-v << 1) | 1 : v << 1;
    do {
      let digit = n & 31;
      n >>>= 5;
      if (n > 0) digit |= 32;
      out += B64[digit];
    } while (n > 0);
  }
  return out;
}

interface RawSourceMap {
  mappings: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
}

/**
 * Rewrite a source map whose original positions are generated-module lines
 * so that they are markdown lines instead. Segments on generated-only lines
 * (helpers, test headers) are dropped: a stack frame there is the runner's,
 * and mapping it to some nearby markdown line would look authoritative and
 * be wrong.
 */
export function remapSourceMap(map: RawSourceMap, opts: { lineMap: LineMap; markdown: string }): RawSourceMap {
  const { lineMap } = opts;
  let prevLine = 0;
  let prevCol = 0;
  let outPrevLine = 0;
  let outPrevCol = 0;
  const outLines = map.mappings.split(";").map((line) => {
    let genCol = 0;
    let outPrevGenCol = 0;
    const segs: string[] = [];
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      genCol += v[0] ?? 0;
      if (v.length < 4) continue;
      prevLine += v[2] ?? 0;
      prevCol += v[3] ?? 0;
      const md = lineMap.md[prevLine];
      if (md === null || md === undefined) continue;
      const mdLine = md - 1;
      const mdCol = Math.max(0, prevCol - (lineMap.col[prevLine] ?? 0));
      segs.push(encodeVlq([genCol - outPrevGenCol, 0, mdLine - outPrevLine, mdCol - outPrevCol]));
      outPrevGenCol = genCol;
      outPrevLine = mdLine;
      outPrevCol = mdCol;
    }
    return segs.join(",");
  });
  return {
    ...map,
    sources: [map.sources[0] ?? ""],
    sourcesContent: [opts.markdown],
    mappings: outLines.join(";"),
  };
}

const INLINE_MAP_RE = /\/\/# sourceMappingURL=data:application\/json;base64,([\d+/=A-Za-z]+)\s*$/;

/** Replace an esbuild inline source map with one that points at markdown lines. */
export function rewriteInlineSourceMap(code: string, opts: { lineMap: LineMap; markdown: string }): string {
  const match = INLINE_MAP_RE.exec(code);
  if (!match?.[1]) return code;
  const map = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as RawSourceMap;
  const remapped = remapSourceMap(map, opts);
  const encoded = Buffer.from(JSON.stringify(remapped)).toString("base64");
  return `${code.slice(0, match.index)}//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}
