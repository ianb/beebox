// A device opted in with no language pack: tap the mic and read the notice,
// then download the pack from Voice settings and confirm dictation goes live.
// node --experimental-strip-types e2e-pack.ts <freshProfile> <port> <wav> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.ts";
const [profile, port, wav, outDir] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
const base = "http://localhost:3210/browser-live-stt/test1";
const key = /^BBX_BROWSE_API_KEY=(.*)$/m.exec(readFileSync(new URL("../../../beebox/.env", import.meta.url), "utf8"))?.[1];
const page = await launch({ profile: profile!, url: "http://localhost:8931/blank.html", port: Number(port), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav!}`, "--disable-features=AudioServiceSandbox", "--window-size=1000,800"] });
await page.send("Network.enable");
await page.send("Page.enable");
await page.send("Network.setCookie", { name: "bbx_browse_key", value: key, url: "http://localhost:3210/", path: "/" });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const has = (id: string) => page.eval<boolean>(`!!document.getElementById(${JSON.stringify(id)})`);
const until = async (check: () => Promise<boolean>, seconds: number) => {
  for (let i = 0; i < seconds * 2; i++) {
    if (await check()) return true;
    await pause(500);
  }
  return false;
};
const shot = async (name: string) => {
  const r = (await page.send("Page.captureScreenshot", { format: "png" })) as { result: { data: string } };
  writeFileSync(`${outDir!}/${name}.png`, Buffer.from(r.result.data, "base64"));
};
const text = () => page.eval<string>(`document.body.innerText`);
const clickText = (t: string) => page.eval(`[...document.querySelectorAll('[role=menuitem],button')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`);
await page.send("Page.navigate", { url: `${base}/chats` });
await until(() => has("bbx-composer-mic"), 90);
await page.eval(`localStorage.setItem("bbx:live-engine", "browser")`);
await page.send("Page.reload");
await pause(1500);
await until(() => has("bbx-composer-mic"), 60);
await pause(1500);
await page.eval(`document.getElementById("bbx-composer-mic").click()`);
const noticed = await until(async () => (await text()).includes("on-device speech isn't downloaded"), 15);
console.log("notice shown:", noticed);
await shot("1-notice");
await page.eval(`document.getElementById("bbx-composer-mic").click()`);
await pause(1500);
await page.eval(`[...document.querySelectorAll('button')].find((e) => /voice|speech|narrat/i.test(e.getAttribute('aria-label') ?? '')).click()`);
await pause(500);
await clickText("Voice settings");
const row = await until(() => has("bbx-voice-browser-speech-download"), 10);
console.log("download row:", row);
await shot("2-row");
await page.eval(`document.getElementById("bbx-voice-browser-speech-download").click()`);
await pause(1000);
await shot("3-downloading");
const ready = await until(async () => (await text()).includes("On-device speech is ready"), 400);
console.log("ready:", ready);
await shot("4-ready");
await page.send("Page.reload");
await pause(1500);
await until(() => has("bbx-composer-mic"), 60);
await pause(1500);
await page.eval(`document.getElementById("bbx-composer-mic").click()`);
const live = await until(() => page.eval<boolean>(`(document.querySelector('textarea')?.value ?? '').split(' ').length > 3`), 25);
console.log("live text after download:", live, await page.eval<string>(`document.querySelector('textarea')?.value ?? ''`));
await shot("5-live");
await page.close();
