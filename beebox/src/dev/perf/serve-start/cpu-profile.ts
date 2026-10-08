/**
 * Summarizes a V8 `.cpuprofile` by self time, grouped by where the code came
 * from.
 *
 * `dist/cli.mjs` is one bundled file, so a raw profile attributes most time to
 * "cli.mjs:<line>". Its source map (`dist/cli.mjs.map`) maps each frame back
 * to the original file, which this groups by owner: a package under
 * node_modules, or a source directory under src/. Node's own frames (module
 * compilation, file reads) and V8's (GC) are grouped as such.
 */
import * as fs from "node:fs/promises";
import { SourceMap } from "node:module";
import { z } from "zod";

const profileSchema = z.object({
  nodes: z.array(z.object({ id: z.number(), children: z.array(z.number()).optional(), callFrame: z.object({ functionName: z.string(), url: z.string(), lineNumber: z.number(), columnNumber: z.number() }) })),
  samples: z.array(z.number()),
  timeDeltas: z.array(z.number()),
});

export interface ProfileSummary {
  totalMs: number;
  /** Self time by owner (package, src/<dir>, node internals, gc). */
  byOwner: { owner: string; ms: number }[];
  /**
   * Like `byOwner`, but time spent in Node internals or native code (module
   * compilation, file reads) is charged to the nearest calling frame that has
   * an owner: what loading or running that package or directory cost.
   */
  attributed: { owner: string; ms: number }[];
  /** Self time by function. */
  byFunction: { name: string; ms: number }[];
}

function ownerOf(file: string): string {
  const nm = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(file);
  if (nm) return `npm:${nm[1] ?? file}`;
  if (file.endsWith(".mjs") || file.endsWith(".js")) {
    if (!file.includes("/src/")) return `${file.split("/").slice(-2).join("/")} (no source map entry)`;
  }
  const at = file.lastIndexOf("src/");
  if (at === -1) return file;
  const parts = file.slice(at).split("/");
  return parts.slice(0, Math.min(3, parts.length - 1)).join("/");
}

function frameOwner(frame: { url: string; lineNumber: number; columnNumber: number; functionName: string }, maps: Map<string, SourceMap>): { owner: string; name: string } {
  if (frame.url === "") return { owner: frame.functionName.startsWith("(") ? frame.functionName : "(native)", name: frame.functionName };
  if (frame.url.startsWith("node:")) return { owner: "(node internals)", name: `${frame.functionName} ${frame.url}` };
  const map = maps.get(frame.url);
  const entry = map?.findEntry(frame.lineNumber, frame.columnNumber);
  const original = entry && "originalSource" in entry ? entry.originalSource : undefined;
  const file = original ?? frame.url.replace(/^file:\/\//, "");
  return { owner: ownerOf(file), name: `${frame.functionName || "(anonymous)"} ${file.split("/").slice(-2).join("/")}` };
}

/** `maps`: bundle file URL → its source map file path. */
export async function summarizeProfile(profilePath: string, maps: Record<string, string>): Promise<ProfileSummary> {
  const profile = profileSchema.parse(JSON.parse(await fs.readFile(profilePath, "utf-8")));
  const sourceMaps = new Map<string, SourceMap>();
  for (const [url, mapPath] of Object.entries(maps)) sourceMaps.set(url, new SourceMap(JSON.parse(await fs.readFile(mapPath, "utf-8"))));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (const [i, id] of profile.samples.entries()) selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
  const ownerCache = new Map<number, { owner: string; name: string }>();
  const ownerOfNode = (id: number): { owner: string; name: string } | undefined => {
    const node = nodes.get(id);
    if (!node) return undefined;
    const cached = ownerCache.get(id) ?? frameOwner(node.callFrame, sourceMaps);
    ownerCache.set(id, cached);
    return cached;
  };
  const isUnowned = (owner: string): boolean => owner.startsWith("(");
  const attributedOwner = (id: number): string => {
    const self = ownerOfNode(id)?.owner ?? "(unknown)";
    if (!isUnowned(self) || self === "(idle)" || self === "(garbage collector)" || self === "(program)") return self;
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) {
      const owner = ownerOfNode(p)?.owner;
      if (owner !== undefined && !isUnowned(owner)) return owner;
    }
    return self;
  };
  const byOwner = new Map<string, number>();
  const attributed = new Map<string, number>();
  const byFunction = new Map<string, number>();
  let total = 0;
  for (const [id, us] of selfUs) {
    const frame = ownerOfNode(id);
    if (!frame) continue;
    byOwner.set(frame.owner, (byOwner.get(frame.owner) ?? 0) + us);
    const charged = attributedOwner(id);
    attributed.set(charged, (attributed.get(charged) ?? 0) + us);
    byFunction.set(frame.name, (byFunction.get(frame.name) ?? 0) + us);
    total += us;
  }
  const ranked = (m: Map<string, number>): [string, number][] => [...m].toSorted((a, b) => b[1] - a[1]);
  return {
    totalMs: Math.round(total / 1000),
    byOwner: ranked(byOwner).map(([owner, us]) => ({ owner, ms: Math.round(us / 100) / 10 })),
    attributed: ranked(attributed).map(([owner, us]) => ({ owner, ms: Math.round(us / 100) / 10 })),
    byFunction: ranked(byFunction).map(([name, us]) => ({ name, ms: Math.round(us / 100) / 10 })),
  };
}
