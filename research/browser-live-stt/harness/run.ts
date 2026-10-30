// node --experimental-strip-types run.ts <profile> <port> <outFile> <args-json> [chrome flags...]
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.ts";
import { liveLatency, wer, type Ev } from "./score.ts";
const [profile, port, outFile, argsJson, ...flags] = process.argv.slice(2);
const args = JSON.parse(argsJson!) as { src: string; meta?: string; audioDir?: string };
const page = await launch({ profile: profile!, url: "http://localhost:8931/run.html", port: Number(port), args: flags.filter((f) => f !== "--headed"), headed: flags.includes("--headed") });
await page.eval(`(async()=>{ while(!window.ready) await new Promise(r=>setTimeout(r,50)); })()`);
const result = await page.eval<{ stats: unknown; finals: string[]; events: (Ev & { error?: string })[] }>(`runFile(${argsJson})`, { timeoutMs: 3_600_000 });
await page.close();
writeFileSync(outFile!, JSON.stringify(result));
const summary: Record<string, unknown> = { stats: result.stats, nEvents: result.events.length, errors: result.events.filter((e) => e.type === "error").map((e) => `${String(e.t)}:${e.error ?? ""}`) };
if (args.meta) {
  const meta = JSON.parse(readFileSync(args.meta, "utf8")) as { refs: string[]; bounds: number[] };
  summary.wer = wer(meta.refs.join(" "), result.finals.join(" "));
  if (meta.bounds.length) summary.latency = liveLatency(result.events, meta.refs, meta.bounds);
}
console.log(JSON.stringify(summary, null, 1));
