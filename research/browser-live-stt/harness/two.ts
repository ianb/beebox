// node --experimental-strip-types two.ts <profile> <port> <wav> <args-json> : fake capture device feeds the wav.
import { launch } from "./cdp.ts";
const [profile, port, wav, argsJson] = process.argv.slice(2);
const page = await launch({ profile: profile!, url: "http://localhost:8931/run.html", port: Number(port), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav!}`, "--disable-features=AudioServiceSandbox"] });
await page.eval(`(async()=>{ while(!window.ready) await new Promise(r=>setTimeout(r,50)); })()`);
console.log(JSON.stringify(await page.eval(`twoConsumers(${argsJson})`)));
await page.close();
