// End to end in the real app with a fake mic device: flag on, tap the mic,
// dictate synthetic speech ending in a spoken "send message", capture evidence.
// node --experimental-strip-types e2e.ts <profile> <port> <wav> <outDir> [base]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.ts";
const [profile, port, wav, outDir, base = "http://localhost:3210/browser-live-stt/test1", flag = "browser"] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
const key = /^BBX_BROWSE_API_KEY=(.*)$/m.exec(readFileSync(new URL("../../../beebox/.env", import.meta.url), "utf8"))?.[1];
const page = await launch({ profile: profile!, url: "http://localhost:8931/blank.html", port: Number(port), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav!}%noloop`, "--disable-features=AudioServiceSandbox", "--window-size=1000,800"] });
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Network.setCookie", { name: "bbx_browse_key", value: key, url: "http://localhost:3210/", path: "/" });
await page.send("Page.navigate", { url: `${base}/chats` });
const shot = async (name: string) => {
  const r = (await page.send("Page.captureScreenshot", { format: "png" })) as { result: { data: string } };
  writeFileSync(`${outDir!}/${name}.png`, Buffer.from(r.result.data, "base64"));
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i++) {
  if (await page.eval<boolean>(`!!document.getElementById("bbx-composer-mic")`)) break;
  await pause(1000);
}
if (flag === "browser") {
  await page.eval(`localStorage.setItem("bbx:live-engine", "browser")`);
  await page.send("Page.reload");
  await pause(1500);
  for (let i = 0; i < 60; i++) {
    if (await page.eval<boolean>(`!!document.getElementById("bbx-composer-mic")`)) break;
    await pause(500);
  }
}
await pause(1500);
await shot("0-before");
const t0 = Date.now();
await page.eval(`document.getElementById("bbx-composer-mic").click()`);
const seen: { t: number; composer: string }[] = [];
const read = `(() => { const c = document.querySelector('textarea, [contenteditable=true]'); return (c ? (c.value || c.textContent) : '') + ' || ' + document.body.innerText.slice(-400); })()`;
let shotAt = [4000, 9000];
const secs = Number(process.env.E2E_SECONDS ?? 24);
while (Date.now() - t0 < secs * 1000) {
  const v = await page.eval<string>(read);
  if (seen.at(-1)?.composer !== v) seen.push({ t: Date.now() - t0, composer: v });
  if (shotAt[0] !== undefined && Date.now() - t0 > shotAt[0]) { await shot(`1-live-${String(shotAt[0])}`); shotAt = shotAt.slice(1); }
  await pause(150);
}
await shot("2-after");
const logs = page.events.filter((e) => e.method === "Runtime.consoleAPICalled").map((e) => (e.params as { type: string; args: { value?: string }[] })).filter((p) => p.args.some((a) => String(a.value).includes("realtime-transcription"))).map((p) => p.args.map((a) => a.value).join(" "));
const sockets = page.events.filter((e) => e.method === "Network.webSocketCreated").map((e) => (e.params as { url: string }).url);
const posts = page.events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => (e.params as { request: { url: string; method: string } }).request).filter((r) => r.method === "POST" || /deepgram|voxtral|realtime|transcri/.test(r.url)).map((r) => r.url.replace(/^.*\/test1/, "")).filter((u) => /voice|transcri|chat|deepgram/.test(u) && !u.includes("/src/") && !u.includes("/@fs/"));
const out = { seen, logs, sockets, posts: [...new Set(posts)] };
writeFileSync(`${outDir!}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await page.close();
