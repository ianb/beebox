// Install a language pack in the isolated profile and time it.
import { launch } from "./cdp.ts";
const [profile, lang = "en-US"] = process.argv.slice(2);
const page = await launch({ profile: profile!, url: "http://localhost:8931/blank.html", port: 9331 });
const out = await page.eval(`(async () => {
  const SR = window.SpeechRecognition; const o = { langs: [${JSON.stringify(lang)}], processLocally: true };
  const before = await SR.available(o); const s = performance.now();
  const ok = await SR.install(o).catch(e => String(e));
  return { before, ok, ms: Math.round(performance.now() - s), after: await SR.available(o) };
})()`);
console.log(JSON.stringify(out));
await page.close();
