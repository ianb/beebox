// node --experimental-strip-types models.ts <profile> <port> <fn> <args-json> <meta.json>
import { readFileSync } from "node:fs";
import { launch } from "./cdp.ts";
import { wer } from "./score.ts";
const [profile, port, fn, argsJson, metaFile] = process.argv.slice(2);
const page = await launch({ profile: profile!, url: "http://localhost:8931/models.html", port: Number(port), args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=metal"] });
await page.eval(`(async()=>{ while(!window.ready) await new Promise(r=>setTimeout(r,50)); })()`);
const meta = JSON.parse(readFileSync(metaFile!, "utf8")) as { refs: string[]; bounds: number[] };
const a = JSON.parse(argsJson!) as Record<string, unknown>;
if (fn === "tjs") a.bounds = meta.bounds;
const r = await page.eval<{ text: string } & Record<string, unknown>>(`${fn!}(${JSON.stringify(a)})`, { timeoutMs: 1_800_000 }).catch((e: unknown) => ({ text: "", failed: String(e) }));
const { text, timeline: _t, ...rest } = r;
const n = (fn === "whistleStream" && typeof a.seconds === "number") ? null : wer(meta.refs.join(" "), text);
console.log(JSON.stringify({ ...rest, wer: n, sample: text.slice(0, 300) }));
await page.close();
